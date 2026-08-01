/**
 * gitStats.ts — Pipeline 1: the GitHub half of the hourly Snapshot rebuild.
 *
 * One action, `rebuild`, which fetches everything the dashboard's git Signal
 * needs from the GitHub GraphQL API and hands it to `snapshotBuild.apply` to be
 * written. It is the only module in this package that talks to the outside
 * world, and the only one that ever *sees* a private repository name.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  ADR 008 IS LAW. NO PRIVATE REPOSITORY NAME LEAVES THIS FILE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The whole reason a PAT is involved is that private contributions are only
 * visible to the user's own token — that is what makes the six-thousand-odd
 * figure available at all, and it is also what makes this file the single point
 * where the site could leak a client's repository name. So the rule is
 * structural rather than procedural:
 *
 *   • Nothing this action returns, and nothing it passes to a mutation, carries
 *     a repository name. The only `string` fields in the return type that can
 *     hold a repo-shaped value are `slug` (a Lab's own slug, written by an
 *     admin) and the `project` / `byProject[].name` labels on a calendar day,
 *     which are resolved through the two allowlists in the Attribution section
 *     below and then *asserted* by `assertNoRepoIdentifiers` before the write.
 *   • The GraphQL responses themselves *do* contain private names — GitHub has
 *     no way to answer "how many commits, in repos you may not name" — so they
 *     are read, counted and discarded inside this handler. They never reach
 *     `ctx.runMutation`, never reach a log line, and never reach the return
 *     value that `bunx convex run` prints.
 *   • A Lab whose repo resolves to a *private* repository is skipped entirely
 *     rather than refreshed. `labs` is a hand-curated allowlist of public repos
 *     "by construction", and a private one in it is a curation mistake, not an
 *     instruction to publish private numbers. The skip is reported by slug (the
 *     admin's own string), never by resolved name.
 *
 * ── The day popup, and why it needs a second data source ───────────────────
 *
 * `ContributionDay.byProject` answers "which projects, and how many commits
 * each" for one heatmap cell. Getting that right required discovering something
 * about the GitHub API that is easy to assume away, so it is written down here:
 *
 *   **`contributionsCollection.commitContributionsByRepository` NEVER itemises
 *   private repositories** — not even for the viewer's own token with full
 *   `repo` scope. Measured on this account: a 30-day window reporting 972
 *   `restrictedContributionsCount` and 15 actively-pushed private repos returns
 *   *zero* private rows from that connection. Private work is aggregated into
 *   `restrictedContributionsCount` and itemised nowhere. That is GitHub's own
 *   privacy guarantee, and it is the same guarantee ADR 008 makes.
 *
 * Since the named case studies are private repositories, the popup would have
 * been permanently empty for ~90% of Corey's commits if this file used only that
 * connection. So attribution has two sources, one per repository, never both:
 *
 *   1. **Public repos** → `commitContributionsByRepository`, which gives an
 *      exact per-day `commitCount` on GitHub's own contribution accounting.
 *   2. **Repos named in `gitRepoMap`** that source 1 did not cover (i.e. the
 *      private ones) → `repository(…).defaultBranchRef…history(author:)`, whose
 *      commit timestamps are bucketed into days here.
 *
 * The second source is what makes `QuoteCloud · 5 commits` possible, and its
 * blast radius is bounded by construction: **the only private repositories this
 * file ever asks GitHub about are the ones an operator wrote into `gitRepoMap`
 * by hand.** Nothing is enumerated, nothing is discovered, and a repo with no
 * mapping row is never named — its commits land in the neutral `Other work`
 * bucket if they were visible at all, and are simply absent otherwise.
 *
 * ── Runtime: default, not Node ─────────────────────────────────────────────
 *
 * There is no `"use node"` directive, deliberately. The only capability this
 * file needs beyond a query's is `fetch`, which the default Convex runtime
 * provides to actions (https://docs.convex.dev/functions/runtimes); `"use node"`
 * would buy nothing but a cold start on every hourly tick. No npm client is used
 * either — a GraphQL request is a POST with a JSON body, and Octokit in the
 * bundle would be ~100 KB to save the ten lines in `githubGraphQL` below.
 *
 * ── Actions cannot touch the database ──────────────────────────────────────
 *
 * `ctx.db` does not exist here. The reads this pipeline needs (the curated Lab
 * repos, and the private attribution mapping) and the one write it produces (the
 * Snapshot) go through `internal.snapshotBuild.*` and `internal.repoMap.*`.
 *
 * ── Triggering it by hand ──────────────────────────────────────────────────
 *
 *     bunx convex run gitStats:rebuild '{}'        # fetch, write, print summary
 *     bunx convex run gitStats:preview '{}'        # fetch only, write nothing
 *
 * Both are `internalAction`s and neither is callable from a browser. That is the
 * point: a *public* action here would be an unauthenticated way for anyone
 * holding the deployment URL to spend Corey's GitHub rate limit and rewrite the
 * homepage's numbers. `npx convex run` reaches internal functions because the
 * CLI authenticates with the deployment's admin key, so nothing is lost.
 */

import { ConvexError } from 'convex/values';
import { internal } from './_generated/api';
import { internalAction } from './_generated/server';
import { DAY_MS, dayMs, isoDay } from './lib/days';
import type { GitRepoMapEntry } from './repoMap';
import type { CuratedLabRepo, SnapshotBuildSummary } from './snapshotBuild';

/* ------------------------------------------------------------------ *
 * Configuration
 * ------------------------------------------------------------------ */

const GITHUB_GRAPHQL_ENDPOINT = 'https://api.github.com/graphql';

/**
 * Sent on every request. GitHub asks for it and rate-limits harder without it;
 * it also means an abuse report arrives with something to identify.
 */
const USER_AGENT = 'coreybaines.com-snapshot-cron';

// DAY_MS, isoDay and dayMs come from lib/days.ts — see that file for why this
// package keeps exactly one definition of "which UTC day is this".

/** Columns in the heatmap. `SnapshotSchema` documents the grid as 52 × 7. */
const WEEKS = 52;
const DAYS_PER_WEEK = 7;

/**
 * How many named languages reach the Snapshot before the tail becomes `Other`.
 *
 * Five plus `Other` is what the mock renders and what the panel has room for;
 * a sixth bar makes the strip unreadable at phone width.
 */
const MAX_LANGUAGES = 5;

/**
 * The neutral bucket every unattributable commit folds into.
 *
 * Spelled here as a literal because `packages/convex` cannot import
 * `@home/types` (it is bundled into Convex's own runtime — see the header of
 * `lib/validate.ts`). `OTHER_WORK_LABEL` in `packages/types/src/stats.ts` is the
 * owner of this string and documents at length what it does and does not mean;
 * the short version is that it carries **real commits the site declines to
 * name**, and is never a fallback for "the lookup failed".
 */
const OTHER_WORK = 'Other work';

/**
 * Repositories asked for per contribution window. GitHub's own ceiling is 100
 * (`ARGUMENT_LIMIT`: "Only up to 100 repositories is supported" — verified
 * against the live API, not assumed).
 *
 * Truncation here is detectable rather than silent: every window also asks for
 * `totalRepositoriesWithContributedCommits`, and the summary reports
 * `repositoriesDropped` when the two disagree. See `fetchGitStats` for what is
 * and is not done about it — the short version is that GitHub gives no way to
 * learn *which days* a dropped repo contributed on, and the contract forbids
 * inventing them.
 */
const MAX_CONTRIBUTION_REPOSITORIES = 100;

/**
 * Day-buckets fetched per repository per window. GitHub's ceiling is 100
 * (`EXCESSIVE_PAGINATION`: "exceeds the `first` limit of 100 records" —
 * likewise verified live).
 *
 * This is a ceiling that is now **impossible to hit**, and that is the point of
 * `CONTRIBUTION_WINDOW_DAYS` below. Left as an explicit constant so the
 * relationship between the two is visible at the point of use.
 */
const MAX_CONTRIBUTION_DAYS = 100;

/**
 * Length of one contribution window, in days. **Must stay below
 * `MAX_CONTRIBUTION_DAYS`.**
 *
 * This is how the per-repo breakdown is paged, and it is paging by *partition*
 * rather than by cursor for a specific reason: `contributions` is a connection
 * hanging off each element of `commitContributionsByRepository`, so a cursor
 * addresses one repository inside a list that has to be re-fetched whole to use
 * it. There is no way to ask for "page 2 of repo 7" on its own.
 *
 * Partitioning sidesteps that entirely. A window of 90 days can contain at most
 * 90 distinct days, so *no* repository can have more than 90 day-buckets in it,
 * so `first: 100` can never truncate — the limit is satisfied structurally
 * instead of being retried around. Five windows cover the year and they are all
 * aliased into the single request that already fetches the calendar, so the
 * whole thing still costs one round trip.
 *
 * Measured before and after: the previous single-year query truncated one
 * repository's day list; the windowed query truncates none. `truncatedRepos` in
 * the summary is retained as the seatbelt that proves it stays that way.
 */
const CONTRIBUTION_WINDOW_DAYS = 90;

/**
 * Length of one commit-history window, in days, for the private half.
 *
 * `history` *is* cursor-pageable, so this is a throughput choice rather than a
 * correctness one: without it, the busiest mapped repository (4,604 viewer
 * commits in the trailing year) needs 47 sequential round trips at 100 commits a
 * page, once an hour, for ever. Splitting the year into 30-day windows and
 * aliasing them into one request lets all of them page *in parallel* — the
 * number of round trips becomes the pages needed by the busiest single window,
 * which is 4 rather than 47.
 *
 * Windows deliberately overlap at their boundaries (`until` of one is `since` of
 * the next) and commits are de-duplicated by `oid`, so no commit can fall
 * between two windows regardless of how GitHub treats the bounds.
 */
const HISTORY_WINDOW_DAYS = 30;

/**
 * How many pages deep the history pager will go before giving up.
 *
 * At 100 commits a page across `HISTORY_WINDOW_DAYS`-day windows this is a
 * ceiling of 1,200 commits in any 30-day window of any one repository, which is
 * roughly three times the busiest month this account has produced. A run that
 * hits it stops fetching and reports `historyPagesExhausted` rather than looping
 * — an hourly cron that can be made to run for ever by a bad cursor is a worse
 * failure than a breakdown that under-reports one repository for one hour.
 */
const MAX_HISTORY_ROUNDS = 12;

/** Commits fetched per history page. GitHub's connection ceiling is 100. */
const MAX_HISTORY_PAGE_SIZE = 100;

/**
 * Hours to add to a commit's UTC timestamp before asking which calendar day it
 * belongs to. Australia/Sydney, +10.
 *
 * ── Why this is not zero, given lib/days.ts says "UTC everywhere" ──────────
 *
 * `lib/days.ts` is right that a *day label* has no timezone. But source 2 above
 * does not hand back day labels — it hands back instants (`committedDate`), and
 * they have to be bucketed into the same days GitHub's contribution calendar
 * used, because the popup prints the breakdown beside `count` from that
 * calendar. GitHub buckets contributions in the account's own timezone, so
 * bucketing them in UTC would shift a chunk of every evening's work onto the
 * following day. This is the "converted at most once, at the edge that produced
 * the data" case that file's header describes.
 *
 * The offset was measured rather than assumed. Sweeping ±14 h over 1,342 private
 * commits against 60 days of calendar counts, and scoring by how many days the
 * breakdown *exceeded* the calendar (the contract's `sum(commits) ≤ count`
 * invariant, which a wrong offset breaks first and worst):
 *
 *     offset   +5h    +6h    +7h    +8h    +9h   +10h   +11h   +12h
 *     days      4      2      2      2      2      2      3      5
 *     excess   49     43     42     42     42     42     52     59
 *
 * +7…+10 are indistinguishable on this data and Sydney is +10, so the account's
 * real timezone is used rather than the middle of the plateau. Daylight saving
 * (Sydney is +11 in summer) costs at most an hour of boundary precision, which
 * is comfortably inside the flat region — encoding a DST calendar here would be
 * false precision on top of a measurement that cannot resolve it.
 *
 * The residual 2 days are real: they are commits GitHub's contribution graph
 * does not count as contributions at all. `clampToCount` handles them.
 */
const ATTRIBUTION_DAY_OFFSET_HOURS = 10;

/**
 * The share of a day's contributions a single repo must account for before its
 * name is printed as that day's `project`.
 *
 * This is the honesty gate on the heatmap tooltip's *one-word summary*, and it
 * is worth being precise about what it protects. `contributionDay.project` is
 * documented as "the project receiving most of that day's commits". The
 * calendar's `count` includes work this file cannot attribute — restricted
 * commits in unmapped repositories (ADR 008), and PRs, reviews and issues, which
 * are contributions but not commits — so a day can be 400 unattributable
 * contributions and 3 attributable ones. Labelling that day with the one name it
 * happens to know would be a true sentence about a false subject.
 *
 * So `project` is set only when one named project accounts for a strict majority
 * of the day's *total* contribution count. Otherwise it is `null`, which the
 * Heatmap renders as "No project activity".
 *
 * ⚠️ This gates `project` and **not** `byProject`. The breakdown is a list of
 * measured facts and each row is true on its own terms; it does not need a
 * majority to be honest, only to be labelled. That asymmetry is exactly why
 * `ContributionDaySchema` states the relationship between the two fields as
 * `project ∈ { byProject[0].name, null }` — a membership rule rather than an
 * equality — and names this constant as the reason.
 */
const ATTRIBUTION_MAJORITY = 0.5;

/* ------------------------------------------------------------------ *
 * GraphQL transport
 * ------------------------------------------------------------------ */

/** What every failure from this file carries, so a caller can tell them apart. */
export type GitStatsErrorData = {
  code: 'missing-token' | 'github-error' | 'github-unavailable' | 'attribution-leak';
  message: string;
};

function fail(data: GitStatsErrorData): never {
  throw new ConvexError<GitStatsErrorData>(data);
}

/**
 * One GraphQL request against GitHub, as the PAT's own user.
 *
 * ── Partial failures are the normal case, not an edge case ────────────────
 *
 * GitHub answers a query naming a repository that does not exist (a renamed
 * Lab, a typo, a repo made private) with **both** a populated `data` object and
 * an `errors` array — HTTP 200, `data.r3 === null`, one `NOT_FOUND` entry. If
 * this function threw on `errors`, a single stale row in `labs` would take down
 * the whole hourly snapshot, including the contribution calendar that has
 * nothing to do with it.
 *
 * So: `errors` alongside usable `data` is logged and returned; only a response
 * with no `data` at all is fatal. The callers below are written to expect nulls.
 *
 * The error text is logged rather than returned, because GitHub echoes the
 * offending name back — `"Could not resolve to a Repository with the name
 * 'owner/private-thing'"` — and that string must not reach a return value the
 * admin UI might render. A Convex log is server-side and admin-only.
 */
async function githubGraphQL<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const token = process.env.GITHUB_PAT;
  if (token === undefined || token.length === 0) {
    fail({
      code: 'missing-token',
      message:
        'GITHUB_PAT is not set on this deployment. Set it with `bunx convex env set GITHUB_PAT <token>`; it needs `read:user` and `repo` so that restricted contributions are counted.',
    });
  }

  let response: Response;
  try {
    response = await fetch(GITHUB_GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        // GitHub accepts `bearer` for GraphQL; `token` is the REST spelling.
        authorization: `bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': USER_AGENT,
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (error) {
    fail({
      code: 'github-unavailable',
      message: `GitHub GraphQL request failed: ${String(error)}`,
    });
  }

  if (!response.ok) {
    // 401 = the PAT is wrong or expired, 403 = rate limited or scope refused.
    // Both are operational problems worth naming precisely in the log.
    fail({
      code: 'github-error',
      message: `GitHub GraphQL responded ${response.status} ${response.statusText}.`,
    });
  }

  const body = (await response.json()) as {
    data?: T | null;
    errors?: Array<{ message?: string; type?: string; path?: unknown }>;
  };

  if (body.errors !== undefined && body.errors.length > 0) {
    console.warn(
      `[gitStats] GitHub returned ${body.errors.length} GraphQL error(s):`,
      body.errors.map((e) => `${e.type ?? 'ERROR'}: ${e.message ?? ''}`).join(' | '),
    );
  }

  if (body.data === undefined || body.data === null) {
    fail({
      code: 'github-error',
      message:
        'GitHub GraphQL returned no data. See the deployment logs for the error detail (it is not repeated here because GitHub echoes repository names back in error text).',
    });
  }

  return body.data;
}

/* ------------------------------------------------------------------ *
 * Windows
 * ------------------------------------------------------------------ */

/** A closed `[from, to]` interval of instants, as GitHub wants them. */
type Window = { from: string; to: string };

/**
 * Partition `[fromMs, toMs]` into windows of at most `days` days.
 *
 * `gapMs` is what makes the two callers different, and the difference matters:
 *
 *   • The contribution windows pass `1000`, leaving a one-second gap so no
 *     contribution is counted twice across a boundary (`publicCommits` sums over
 *     windows, so double counting would inflate a published figure). Nothing
 *     falls into the gap because `occurredAt` is day-granular — GitHub returns
 *     every one of them at exactly `07:00:00Z` — and the windows are anchored to
 *     UTC midnight by the caller, so the boundaries land at `23:59:59Z`.
 *   • The history windows pass `0`, deliberately *overlapping* by an instant,
 *     because `since`/`until` bound-inclusivity on `history` is not something to
 *     bet a missing commit on. Duplicates are removed by `oid` instead, which is
 *     exact and does not require knowing the answer.
 */
function partition(fromMs: number, toMs: number, days: number, gapMs: number): Window[] {
  const windows: Window[] = [];
  const span = days * DAY_MS;

  for (let start = fromMs; start < toMs; start += span) {
    const end = Math.min(start + span - gapMs, toMs);
    windows.push({ from: new Date(start).toISOString(), to: new Date(end).toISOString() });
  }

  return windows;
}

/** The calendar day a commit instant belongs to. See `ATTRIBUTION_DAY_OFFSET_HOURS`. */
function attributionDay(instant: string): string | null {
  const ms = Date.parse(instant);
  if (Number.isNaN(ms)) return null;
  return isoDay(ms + ATTRIBUTION_DAY_OFFSET_HOURS * 60 * 60 * 1000);
}

/* ------------------------------------------------------------------ *
 * Queries
 *
 * Written as constants or as builders whose output is a single
 * template, so the exact text sent to GitHub is greppable and can be
 * pasted into https://docs.github.com/en/graphql/overview/explorer
 * verbatim — which is how the verification step in the plan ("assert
 * the cron's git totals match a manual `gh api graphql` call") is
 * actually performed.
 * ------------------------------------------------------------------ */

/**
 * Contributions for the trailing year: the totals, the calendar, and the
 * per-repository, per-day commit breakdown attribution is resolved from.
 *
 * `viewer` rather than `user(login:)` on purpose — the token defines whose
 * contributions these are, so there is no login constant to keep in step with
 * `siteSettings.identity.github`, and no way to accidentally publish someone
 * else's numbers. The login comes back for the summary so the operator can see
 * which account answered, and the node `id` because `history(author:)` in the
 * second query needs it to filter to Corey's own commits.
 *
 * `restrictedContributionsCount` is the ADR 008 figure: the count of
 * contributions in repositories the viewer can see but the public cannot. It is
 * a number with no accompanying names, by GitHub's design and ours.
 *
 * The `w{n}` aliases are the windowed breakdown — see `CONTRIBUTION_WINDOW_DAYS`
 * for why the year is partitioned rather than cursor-paged. `year` and every
 * `w{n}` are aliases of the *same* `contributionsCollection` field with
 * different arguments, which is ordinary GraphQL and costs one request.
 */
function contributionsQuery(windows: Window[]): string {
  const breakdown = windows
    .map(
      (window, index) => `
    w${index}: contributionsCollection(from: ${JSON.stringify(window.from)}, to: ${JSON.stringify(window.to)}) {
      totalRepositoriesWithContributedCommits
      commitContributionsByRepository(maxRepositories: $repos) {
        repository { nameWithOwner isPrivate }
        contributions(first: $days) {
          totalCount
          pageInfo { hasNextPage }
          nodes { occurredAt commitCount }
        }
      }
    }`,
    )
    .join('');

  return `
query Contributions($from: DateTime!, $to: DateTime!, $repos: Int!, $days: Int!) {
  viewer {
    login
    id
    year: contributionsCollection(from: $from, to: $to) {
      totalCommitContributions
      restrictedContributionsCount
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays {
            date
            contributionCount
            contributionLevel
          }
        }
      }
    }${breakdown}
  }
}`;
}

/**
 * One page of viewer-authored commits for each pending (repository, window)
 * pair. The private half of attribution.
 *
 * ── Why `author: { id: … }` ────────────────────────────────────────────────
 *
 * `history` with no author filter returns *everyone's* commits, and several of
 * these repositories are team repos where the majority of the history is
 * somebody else's work. Publishing that as Corey's day would be a straightforward
 * false claim. Filtering by the viewer's own node id — rather than by email —
 * matches exactly the commits GitHub itself attributes to the account, which is
 * the same rule the contribution calendar uses, so the two sides are counting
 * the same population. Verified: over the three busiest public repositories, the
 * filtered `history` and `commitContributionsByRepository` agree to the commit
 * (508 = 508).
 *
 * ── Why only the default branch ────────────────────────────────────────────
 *
 * `defaultBranchRef` is the only ref this walks, so work on a branch that was
 * never merged is not counted. That is the same definition `labStats.commitsYear`
 * has always used, and the same one GitHub's own contribution graph uses, so the
 * three agree. A repository with no default branch at all (created, never
 * pushed) answers `null` and is skipped.
 *
 * Aliases are flat — one `repository(...)` root field per (repo, window) pair,
 * `p{n}` — rather than nested per repository, because the pager below needs to
 * carry an independent cursor for each pair and a flat response is a flat map.
 */
function historyQuery(pairs: HistoryPair[]): string {
  const fields = pairs
    .map((pair) => {
      const after = pair.cursor === null ? '' : `, after: ${JSON.stringify(pair.cursor)}`;
      return `  ${pair.alias}: repository(owner: ${JSON.stringify(pair.owner)}, name: ${JSON.stringify(pair.name)}) {
    defaultBranchRef {
      target {
        ... on Commit {
          history(
            since: ${JSON.stringify(pair.window.from)}
            until: ${JSON.stringify(pair.window.to)}
            author: { id: $viewer }
            first: $page${after}
          ) {
            pageInfo { hasNextPage endCursor }
            nodes { oid committedDate }
          }
        }
      }
    }
  }`;
    })
    .join('\n');

  return `
query History($viewer: ID!, $page: Int!) {
${fields}
}`;
}

/**
 * Language byte counts across every repository the user owns.
 *
 * Includes private repos, and that is a considered decision rather than an
 * oversight: the output is a percentage split with no repository attached, which
 * is exactly the "aggregate totals" ADR 008 permits and the same principle as
 * `restrictedContributionsCount`. Excluding them would produce a language mix
 * that describes Corey's weekends rather than Corey's work.
 *
 * `ownerAffiliations: [OWNER]` and `isFork: false` are the honesty filters:
 * organisation repositories Corey merely has access to are not evidence of what
 * he writes, and a fork's bytes are someone else's.
 */
const LANGUAGES_QUERY = `
query Languages($repos: Int!, $languages: Int!) {
  viewer {
    repositories(
      first: $repos
      ownerAffiliations: [OWNER]
      isFork: false
      orderBy: { field: PUSHED_AT, direction: DESC }
    ) {
      totalCount
      nodes {
        languages(first: $languages, orderBy: { field: SIZE, direction: DESC }) {
          edges {
            size
            node { name }
          }
        }
      }
    }
    publicRepositories: repositories(
      first: 1
      ownerAffiliations: [OWNER]
      privacy: PUBLIC
    ) {
      totalCount
    }
  }
}`;

/**
 * Per-repo stats for the curated Labs, as one aliased query.
 *
 * Aliases (`r0`, `r1`, …) rather than N round trips: the Lab list is short and
 * fixed, and one request keeps the hourly tick inside a single rate-limit point.
 * The alias index maps back to the Lab's own slug in the caller — the resolved
 * `nameWithOwner` is deliberately *not* used as the join key, because a repo
 * that has been renamed answers under a different name than the one that was
 * asked for, and that new name may be private (it happens: a public repo moved
 * into an org and locked down still resolves for the token that owns it).
 */
function labRepoQuery(repos: Array<{ owner: string; name: string }>): string {
  const fields = repos
    .map(
      (repo, index) =>
        `  r${index}: repository(owner: ${JSON.stringify(repo.owner)}, name: ${JSON.stringify(repo.name)}) { ...RepoStats }`,
    )
    .join('\n');

  return `
query LabRepos($since: GitTimestamp!) {
${fields}
}

fragment RepoStats on Repository {
  isPrivate
  stargazerCount
  forkCount
  pushedAt
  defaultBranchRef {
    target {
      ... on Commit {
        history(since: $since) { totalCount }
      }
    }
  }
}`;
}

/* ------------------------------------------------------------------ *
 * Response shapes
 *
 * Hand-written rather than generated: a handful of queries do not
 * justify a codegen step, and a mismatch surfaces immediately as
 * `undefined` in a number that the mutation's validator then rejects.
 * ------------------------------------------------------------------ */

/** GitHub's quartile enum on a calendar day. Maps to the contract's 0–4. */
type ContributionLevelName =
  | 'NONE'
  | 'FIRST_QUARTILE'
  | 'SECOND_QUARTILE'
  | 'THIRD_QUARTILE'
  | 'FOURTH_QUARTILE';

/** One `w{n}` alias: the per-repository breakdown for one window. */
type WindowCollection = {
  totalRepositoriesWithContributedCommits: number;
  commitContributionsByRepository: Array<{
    repository: { nameWithOwner: string; isPrivate: boolean };
    contributions: {
      totalCount: number;
      pageInfo: { hasNextPage: boolean };
      nodes: Array<{ occurredAt: string; commitCount: number }>;
    };
  }>;
};

type ContributionsResponse = {
  viewer: {
    login: string;
    id: string;
    year: {
      totalCommitContributions: number;
      restrictedContributionsCount: number;
      contributionCalendar: {
        totalContributions: number;
        weeks: Array<{
          contributionDays: Array<{
            date: string;
            contributionCount: number;
            contributionLevel: ContributionLevelName;
          }>;
        }>;
      };
    };
    // The `w{n}` window aliases. Indexed rather than enumerated because the
    // window count is derived from CONTRIBUTION_WINDOW_DAYS, not fixed.
    [alias: string]: unknown;
  };
};

/** One `p{n}` alias in a `historyQuery` response. `null` when GitHub 404s. */
type HistoryNode = {
  defaultBranchRef: {
    target: {
      history?: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{ oid: string; committedDate: string }>;
      };
    } | null;
  } | null;
} | null;

type LanguagesResponse = {
  viewer: {
    repositories: {
      totalCount: number;
      nodes: Array<{
        languages: { edges: Array<{ size: number; node: { name: string } }> };
      }>;
    };
    publicRepositories: { totalCount: number };
  };
};

type RepoStats = {
  isPrivate: boolean;
  stargazerCount: number;
  forkCount: number;
  pushedAt: string | null;
  defaultBranchRef: { target: { history?: { totalCount: number } } | null } | null;
};

/* ------------------------------------------------------------------ *
 * The contract's 0–4 level
 * ------------------------------------------------------------------ */

/**
 * GitHub's quartile name → the contract's `level`.
 *
 * `ContributionDaySchema.level` is precomputed rather than derived at render
 * time "so the thresholds live in one place (the cron that writes this row)".
 * This is that one place, and the thresholds are GitHub's own: its quartiles are
 * computed against the user's own busiest day, which is exactly the relative
 * scale the heatmap wants and is better than any constant this file could pick
 * (a 40-commit day is dark green for most people and a quiet Tuesday here).
 */
const LEVEL_BY_NAME: Record<ContributionLevelName, 0 | 1 | 2 | 3 | 4> = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

/* ------------------------------------------------------------------ *
 * Attribution
 *
 * Two allowlists and one rule. Everything a repository can become is
 * decided here, and nothing downstream may widen it.
 * ------------------------------------------------------------------ */

/** What a repository is allowed to be called, and whether it may be fetched. */
type Attribution = {
  /** The public display name, or `OTHER_WORK`. Never a repository identifier. */
  displayName: string;
  /**
   * May this file ask GitHub for this repository's commit history?
   *
   * True only for `gitRepoMap` rows an operator deliberately wrote. It is what
   * bounds the private half of the pipeline to the mapping — see the file
   * header. `false` for a repo that merely turned up in the public breakdown,
   * and for `kind: 'ignore'`.
   */
  fetchHistory: boolean;
};

/**
 * `repoFullName` (lowercased) → what it may be called.
 *
 * THE ALLOWLIST, now in two layers, in priority order:
 *
 *   1. **`gitRepoMap`** — the private, no-public-query table an operator seeds by
 *      hand from a gitignored file. This is what lets a *private* repository
 *      contribute a *public* name (`QuoteCloud`) without the repository ever
 *      being named, and it is the only layer that can. `kind: 'ignore'` maps to
 *      `OTHER_WORK`: the explicit, recorded form of "I looked at this repo and it
 *      stays unsurfaced" (ADR 014's junk repos).
 *   2. **Published Labs** — a curated Lab's `repoFullName` is *already public*
 *      (it is on /labs, next to a link to the repository), so joining it to the
 *      Lab's title publishes nothing new. This layer exists so that adding a Lab
 *      does not also require a mapping row, and it is why the seed file only has
 *      to carry the private half of the world.
 *
 * **The mapping table wins on conflict**, which is what makes it a usable
 * override: a Lab curated with the wrong `repoFullName`, or one whose repo has
 * been made private since, is corrected by writing a row rather than by editing
 * the Lab.
 *
 * Anything in neither layer resolves to `OTHER_WORK`. That is not a failure
 * mode, it is the design: an unmapped repository is either a private one nobody
 * has triaged or a public one ADR 014 keeps off /labs (`dddddd`, `test`, 2016
 * coursework), and neither has any business appearing in a public tooltip.
 *
 * Keyed case-insensitively because GitHub is: `CoreyBain/Boca` and
 * `coreybain/boca` are one repository and an admin may have typed either.
 */
function buildAttributionMap(
  labs: CuratedLabRepo[],
  mapping: GitRepoMapEntry[],
): Map<string, Attribution> {
  const allowed = new Map<string, Attribution>();

  // Labs first, so that the mapping table's entries overwrite them.
  for (const lab of labs) {
    if (!lab.isPublic) continue;
    allowed.set(lab.repoFullName.trim().toLowerCase(), {
      displayName: lab.title,
      // A Lab is curated as a *public* repo "by construction" (see the file
      // header and `snapshotBuild.curatedLabRepos`). If one turns out to be
      // private, that is a curation mistake, and the existing doctrine is to
      // skip it rather than publish private numbers under it — so this layer
      // never earns a repository the right to be interrogated for history. An
      // operator who genuinely wants the private repo behind a Lab attributed
      // writes a `gitRepoMap` row with `kind: 'lab'`, which is exactly what
      // schema.ts says that kind is for.
      fetchHistory: false,
    });
  }

  for (const entry of mapping) {
    allowed.set(entry.repoFullName.trim().toLowerCase(), {
      displayName: entry.kind === 'ignore' ? OTHER_WORK : entry.displayName.trim(),
      fetchHistory: entry.kind !== 'ignore',
    });
  }

  return allowed;
}

/** The set of names this run is permitted to write. The seatbelt's whitelist. */
function permittedNames(allowed: Map<string, Attribution>): Set<string> {
  const names = new Set<string>([OTHER_WORK]);
  for (const attribution of allowed.values()) names.add(attribution.displayName);
  return names;
}

/**
 * A (repository, window) pair the history pager still has work to do on.
 *
 * `displayName` rides along rather than being looked up again on the way back,
 * because the response is keyed by alias and the alias is the only thing tying a
 * page of commits to the name it counts toward. `owner`/`name` are the private
 * halves and stay inside this type, which never leaves the module.
 */
type HistoryPair = {
  alias: string;
  owner: string;
  name: string;
  displayName: string;
  window: Window;
  cursor: string | null;
};

/* ------------------------------------------------------------------ *
 * Per-day breakdown
 * ------------------------------------------------------------------ */

/** `{ name, commits }`, mirroring `ContributionProjectSchema`. */
type ContributionProject = { name: string; commits: number };

/** date → (display name → commits on that day). The accumulator both sources feed. */
type BreakdownByDate = Map<string, Map<string, number>>;

function record(
  breakdown: BreakdownByDate,
  date: string,
  displayName: string,
  commits: number,
): void {
  if (commits <= 0) return;
  const perName = breakdown.get(date) ?? new Map<string, number>();
  perName.set(displayName, (perName.get(displayName) ?? 0) + commits);
  breakdown.set(date, perName);
}

/**
 * One day's accumulated map → the contract's `byProject` array.
 *
 * Ordering is `commits` descending, ties broken by `name` ascending — exactly
 * and only what `ContributionDaySchema` specifies. It is worth recording why
 * `OTHER_WORK` is *not* forced to the end, since that is the obvious thing to
 * want: the contract states the sort as a total order and separately promises
 * `project ∈ { byProject[0].name, null }`, so pinning the bucket last would
 * either break the stated sort or make `project` name something that is not
 * `byProject[0]`. Both are observable to the archived variants under
 * `apps/web/src/app/v/*`, which read `project` and will never grow a popup.
 *
 * The thing that was actually wanted — "the neutral bucket must never be the
 * word the tooltip leads with" — is delivered by `pickProject` instead, which
 * refuses to promote `OTHER_WORK` into `project` under any circumstances. So a
 * day dominated by unattributable work lists `Other work` first in the breakdown
 * (which is true, and is the honest thing for a breakdown to do) and carries no
 * one-word label at all.
 *
 * `localeCompare` is deliberately avoided: the contract says codepoint order, and
 * a locale-aware comparison is not stable across runtimes.
 */
function toByProject(perName: Map<string, number>): ContributionProject[] {
  return [...perName.entries()]
    .filter(([, commits]) => commits > 0)
    .map(([name, commits]) => ({ name, commits }))
    .sort((a, b) => (b.commits - a.commits) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * Enforce `sum(commits) ≤ count` by trimming, never by inflating.
 *
 * ── When this fires, and why it must exist ────────────────────────────────
 *
 * The two attribution sources count slightly different populations from the one
 * the calendar's `count` comes from. Source 2 in particular counts *commits on
 * the default branch authored by the viewer*, while `count` is GitHub's
 * *contribution* count for the day — and a commit can be the first without being
 * the second (history rewritten by a rebase after the fact, a commit authored by
 * Corey and pushed by a teammate, a repository transferred in). Measured on 60
 * days of live data: 2 days out of 60, 42 commits out of 1,342.
 *
 * `ContributionDaySchema` makes `sum(commits) ≤ count` a producer obligation, and
 * this is the producer. The three ways to satisfy it are to raise `count`, to
 * scale the entries, or to trim them, and only the last is honest:
 *
 *   • Raising `count` would desynchronise the cell's *colour* (`level` is
 *     GitHub's quartile of GitHub's count) from its number, and would mean the
 *     site publishing a contribution total GitHub does not agree with.
 *   • Scaling every entry down would corrupt the numbers that are right in order
 *     to accommodate the ones that are not, and would make `5 commits` mean "5,
 *     adjusted".
 *
 * So the excess is removed from the *smallest* entries upward: the leader keeps
 * its exact count (it is the one `project` might name and the one a reader
 * checks), and the rows that vanish are the ones a popup would have rendered as
 * a one-line footnote. The event is counted into `daysClamped` so that a change
 * in its frequency is visible rather than absorbed.
 */
function clampToCount(entries: ContributionProject[], count: number): boolean {
  let sum = 0;
  for (const entry of entries) sum += entry.commits;
  if (sum <= count) return false;

  while (entries.length > 0 && sum > count) {
    const last = entries[entries.length - 1];
    const excess = sum - count;

    if (last.commits > excess) {
      last.commits -= excess;
      sum -= excess;
    } else {
      sum -= last.commits;
      entries.pop();
    }
  }

  return true;
}

/**
 * The day's one-word label, or `null`. See `ATTRIBUTION_MAJORITY`.
 *
 * Two gates, both of which must pass, and the first is absolute: `OTHER_WORK` is
 * never returned. It is a bucket, and "most of today was work I will not name"
 * is not a project label — the tooltip says nothing instead, which is what
 * `null` renders as.
 */
function pickProject(entries: ContributionProject[], count: number): string | null {
  const leader = entries[0];
  if (leader === undefined) return null;
  if (leader.name === OTHER_WORK) return null;
  if (leader.commits <= count * ATTRIBUTION_MAJORITY) return null;
  return leader.name;
}

/* ------------------------------------------------------------------ *
 * The seatbelt
 * ------------------------------------------------------------------ */

/**
 * Refuse to write a calendar containing anything that looks like a repository.
 *
 * `tooling/privacy-check` sweeps the deployment's public responses for private
 * names and is the real regression gate, but it runs *after* a leak has been
 * stored and is only run when somebody runs it. This is the seatbelt that stops
 * the hourly cron from persisting one in the first place, and it is deliberately
 * paranoid in three independent ways:
 *
 *   1. **Whitelist, not blacklist.** Every name must be a member of
 *      `permitted` — the set built from the two allowlists plus `OTHER_WORK`.
 *      A bug that invented a name from thin air fails here even if the name
 *      looks nothing like a repository.
 *   2. **No `/`, ever.** `owner/name` is the shape ADR 008 calls a repository
 *      *identifier* and forbids unconditionally, even for a published case
 *      study. A display name has no reason to contain a slash.
 *   3. **Not a name GitHub just told us**, in either the `owner/name` or the
 *      bare `name` spelling, unless it is legitimately in `permitted` (a Lab's
 *      title may well equal its repo's bare name — `statline` does).
 *
 * ⚠️ THE THROWN MESSAGE MUST NEVER CONTAIN THE OFFENDING STRING. If this fires,
 * the offending string is by hypothesis a repository name, and a `ConvexError`
 * propagates to whatever ran the action — a terminal, the dashboard, the admin
 * UI. So the message names the *date and index* of the cell, which is enough to
 * find it in a debugger and carries nothing.
 */
function assertNoRepoIdentifiers(
  calendar: CalendarDay[][],
  permitted: Set<string>,
  observedRepos: Set<string>,
): void {
  const forbidden = new Set<string>();
  for (const full of observedRepos) {
    if (!permitted.has(full)) forbidden.add(full.toLowerCase());
    const bare = full.slice(full.indexOf('/') + 1);
    // A bare repo name is only forbidden when nothing published claims it. This
    // is the same distinction `tooling/privacy-check` draws between an
    // `identifier` (never allowed) and a `name` (allowed once published).
    if (bare.length > 0 && !permitted.has(bare)) forbidden.add(bare.toLowerCase());
  }

  const reject = (where: string, reason: string): never =>
    fail({
      code: 'attribution-leak',
      message:
        `Refusing to write the contribution calendar: ${where} ${reason}. ` +
        'The offending value is deliberately omitted from this message — it is by ' +
        'hypothesis a repository name, and this error reaches terminals and the ' +
        'admin UI (ADR 008). Look at the cell named above.',
    });

  for (const [weekIndex, week] of calendar.entries()) {
    for (const [dayIndex, day] of week.entries()) {
      const where = `week ${weekIndex}, day ${dayIndex} (${day.date})`;

      const check = (value: string, field: string): void => {
        if (value.length === 0) reject(where, `has an empty \`${field}\``);
        if (value.includes('/')) reject(where, `has a \`${field}\` containing "/"`);
        if (!permitted.has(value)) reject(where, `has a \`${field}\` that is not an allowlisted display name`);
        if (forbidden.has(value.toLowerCase())) reject(where, `has a \`${field}\` matching a repository GitHub named`);
      };

      if (day.project !== null) check(day.project, 'project');
      for (const entry of day.byProject) check(entry.name, 'byProject[].name');

      // The structural invariants from `ContributionDaySchema`, asserted at the
      // same time because this is the only pass over the finished grid.
      if (day.count === 0 && (day.byProject.length > 0 || day.project !== null)) {
        reject(where, 'is inactive but carries an attribution');
      }
      if (day.project !== null && day.project !== day.byProject[0]?.name) {
        reject(where, 'has a `project` that is not the leader of `byProject`');
      }
      const names = new Set(day.byProject.map((entry) => entry.name));
      if (names.size !== day.byProject.length) reject(where, 'has a duplicate name in `byProject`');
    }
  }
}

/* ------------------------------------------------------------------ *
 * Calendar
 * ------------------------------------------------------------------ */

type CalendarDay = {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
  project: string | null;
  byProject: ContributionProject[];
};

/**
 * GitHub's calendar → the contract's 52 × 7 grid.
 *
 * Three transformations, each of which exists because GitHub's shape and the
 * contract's shape genuinely differ:
 *
 *   1. **Partial weeks are padded.** GitHub returns 53 week objects for a
 *      one-year window, and the first and last are short (today's window starts
 *      on a Thursday and ends on a Friday, so they hold 3 and 6 days). The
 *      contract is `Array<Array<ContributionDay>>` with a `.length(7)` invariant
 *      in `ContributionWeekSchema`, and `Heatmap.tsx` indexes `week[0].date` for
 *      its month ticks and lays cells out at `row = index % 7` — a short column
 *      would shift every subsequent cell up a row. Missing days are synthesised
 *      as real dates with `count: 0`.
 *   2. **Exactly 52 columns.** The grid is trimmed from the *end*, keeping the
 *      most recent 52 weeks, because the right-hand edge is the one a reader
 *      looks at.
 *   3. **Sunday-first.** GitHub's weeks already start on Sunday, so this is
 *      inherited rather than imposed — but the padding maths depends on it,
 *      hence the note.
 *
 * The breakdown is applied here rather than earlier because the invariants it
 * has to satisfy are stated against `count`, and `count` is a property of the
 * cell: an inactive day has no attribution whatever the accumulator collected
 * for it (which happens legitimately — source 2 counts a commit GitHub did not
 * count as a contribution), and `clampToCount` needs the cell's own number.
 *
 * @returns the grid, and the two diagnostics the summary reports.
 */
function buildCalendar(
  weeks: ContributionsResponse['viewer']['year']['contributionCalendar']['weeks'],
  breakdown: BreakdownByDate,
): { calendar: CalendarDay[][]; daysClamped: number; daysDropped: number } {
  // Flatten to a date-keyed lookup first. GitHub's own week grouping is
  // discarded rather than trusted: rebuilding the grid from dates means the
  // output is correct even if a partial week arrives somewhere unexpected.
  const byDate = new Map<string, { count: number; level: 0 | 1 | 2 | 3 | 4 }>();
  let lastDate: string | null = null;

  for (const week of weeks) {
    for (const day of week.contributionDays) {
      byDate.set(day.date, {
        count: day.contributionCount,
        level: LEVEL_BY_NAME[day.contributionLevel] ?? 0,
      });
      if (lastDate === null || day.date > lastDate) lastDate = day.date;
    }
  }

  if (lastDate === null) return { calendar: [], daysClamped: 0, daysDropped: 0 };

  // Extend to the Saturday of the final week so the last column is full, then
  // reach back exactly 52 × 7 days. `getUTCDay()` is 0 = Sunday.
  const lastMs = dayMs(lastDate);
  const gridEndMs = lastMs + (6 - new Date(lastMs).getUTCDay()) * DAY_MS;
  const gridStartMs = gridEndMs - (WEEKS * DAYS_PER_WEEK - 1) * DAY_MS;

  const calendar: CalendarDay[][] = [];
  let daysClamped = 0;
  let daysDropped = 0;

  for (let week = 0; week < WEEKS; week++) {
    const column: CalendarDay[] = [];

    for (let weekday = 0; weekday < DAYS_PER_WEEK; weekday++) {
      const date = isoDay(gridStartMs + (week * DAYS_PER_WEEK + weekday) * DAY_MS);
      const observed = byDate.get(date);
      const count = observed?.count ?? 0;
      const perName = breakdown.get(date);

      // A day with no contributions has no breakdown, whatever was accumulated
      // for it — `count === 0 ⇒ byProject === [] && project === null` is the
      // contract's first invariant and this is where it is enforced.
      if (count === 0) {
        if (perName !== undefined && perName.size > 0) daysDropped += 1;
        column.push({ date, count, level: observed?.level ?? 0, project: null, byProject: [] });
        continue;
      }

      const byProject = perName === undefined ? [] : toByProject(perName);
      if (clampToCount(byProject, count)) daysClamped += 1;

      column.push({
        date,
        count,
        level: observed?.level ?? 0,
        project: pickProject(byProject, count),
        byProject,
      });
    }

    calendar.push(column);
  }

  return { calendar, daysClamped, daysDropped };
}

/**
 * Consecutive active days ending today (or yesterday).
 *
 * The grace day matters: this cron runs hourly, so it observes 00:30 UTC — a
 * time at which "today" legitimately has no commits yet and never will have had
 * any. Resetting the streak to zero every midnight and restoring it at the first
 * push would make the number an accident of when the page was rendered. So an
 * empty *today* is skipped rather than counted as a break; an empty yesterday
 * ends the streak.
 *
 * Future days (the grid is padded to Saturday) are excluded, not treated as
 * gaps.
 */
function currentStreak(calendar: CalendarDay[][], todayIso: string): number {
  const days = calendar.flat().filter((day) => day.date <= todayIso);
  if (days.length === 0) return 0;

  let index = days.length - 1;
  if (days[index].count === 0) index -= 1; // today has not happened yet

  let streak = 0;
  for (; index >= 0; index--) {
    if (days[index].count === 0) break;
    streak += 1;
  }

  return streak;
}

/* ------------------------------------------------------------------ *
 * Languages
 * ------------------------------------------------------------------ */

/**
 * Byte counts per language → whole percentages that sum to exactly 100.
 *
 * The exact-100 property is in the contract (`languages`: "sums to 100") and is
 * not achievable by rounding each share independently — five `Math.round`s of
 * 20.4% give 100, of 20.6% give 105. So this is largest-remainder apportionment:
 * floor everything, then hand the leftover whole points out to the entries with
 * the largest discarded fractions. It is the same method used to allocate seats
 * from vote shares, for the same reason.
 *
 * Everything past `MAX_LANGUAGES` is summed into `Other` *before* rounding, so
 * the tail is represented rather than silently dropped, and the total is still
 * the whole corpus. Entries that round to 0% are dropped afterwards, which
 * cannot break the sum because they contribute nothing to it.
 */
function toLanguageShares(
  sizes: Map<string, number>,
): Array<{ name: string; pct: number }> {
  const ranked = [...sizes.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return [];

  const head = ranked.slice(0, MAX_LANGUAGES);
  const tail = ranked.slice(MAX_LANGUAGES);
  const tailSize = tail.reduce((sum, [, size]) => sum + size, 0);

  const buckets: Array<[string, number]> =
    tailSize > 0 ? [...head, ['Other', tailSize]] : head;

  const total = buckets.reduce((sum, [, size]) => sum + size, 0);
  if (total <= 0) return [];

  const exact = buckets.map(([name, size]) => ({ name, share: (size * 100) / total }));
  const shares = exact.map((entry) => ({
    name: entry.name,
    pct: Math.floor(entry.share),
    remainder: entry.share - Math.floor(entry.share),
  }));

  let leftover = 100 - shares.reduce((sum, entry) => sum + entry.pct, 0);
  // Largest fractional part first; ties keep the size ordering above.
  const byRemainder = [...shares].sort((a, b) => b.remainder - a.remainder);
  for (const entry of byRemainder) {
    if (leftover <= 0) break;
    entry.pct += 1;
    leftover -= 1;
  }

  return shares
    .filter((entry) => entry.pct > 0)
    .map((entry) => ({ name: entry.name, pct: entry.pct }));
}

/* ------------------------------------------------------------------ *
 * The fetch
 * ------------------------------------------------------------------ */

/** Everything `snapshotBuild.apply` needs, plus the operator-facing summary. */
type FetchedGitStats = {
  login: string;
  gitStats: {
    totalContributionsYear: number;
    privateContributions: number;
    publicCommits: number;
    publicRepoCount: number;
    totalPublicRepoCount: number;
    currentStreakDays: number;
    calendar: CalendarDay[][];
    languages: Array<{ name: string; pct: number }>;
  };
  labStats: Array<{
    slug: string;
    stars: number;
    forks: number;
    commitsYear: number;
    lastPushedAt: string;
  }>;
  /** Labs that were asked for and not refreshed, by slug, with the reason. */
  labsSkipped: Array<{ slug: string; reason: string }>;
  /** Attribution diagnostics. Counts only — never a name, public or private. */
  attribution: AttributionSummary;
};

/**
 * How well attribution worked this run. Every field is a number, on purpose:
 * this object is returned to the operator and printed by `bunx convex run`.
 */
type AttributionSummary = {
  /** Rows read from `gitRepoMap`. Not their contents. */
  mappingRows: number;
  /** Distinct repositories the public breakdown named, across all windows. */
  repositoriesSeen: number;
  /** Repositories GitHub had but did not return, because of `maxRepositories`. */
  repositoriesDropped: number;
  /** Mapped repositories the public breakdown missed, so history was fetched. */
  historyRepositories: number;
  /** GraphQL round trips the history pager spent. */
  historyRounds: number;
  /** Commits attributed through the history route, after de-duplication. */
  historyCommits: number;
  /** (repo, window) pairs still unfinished at `MAX_HISTORY_ROUNDS`. */
  historyPagesExhausted: number;
  /** Repos whose day-buckets hit `MAX_CONTRIBUTION_DAYS`. Expected to be 0. */
  truncatedRepos: number;
  /** Grid days carrying at least one `byProject` entry. */
  daysWithBreakdown: number;
  /** Grid days carrying a one-word `project` label. */
  attributedDays: number;
  /** Days where `sum(commits)` exceeded `count` and was trimmed. */
  daysClamped: number;
  /** Days with a breakdown but `count === 0`, so it was discarded. */
  daysDropped: number;
  /** Sum of every `byProject[].commits` in the grid. */
  attributedCommits: number;
};

/**
 * Fetch and reshape everything. Pure with respect to the database — it reads no
 * rows and writes none; the caller supplies the Lab list and the mapping, and
 * stores the result.
 *
 * Split out from the action so that `preview` and `rebuild` cannot drift: the
 * dry run and the real run execute *this* function, and differ only in whether
 * they call `snapshotBuild.apply` afterwards.
 */
async function fetchGitStats(
  labs: CuratedLabRepo[],
  mapping: GitRepoMapEntry[],
): Promise<FetchedGitStats> {
  const nowMs = Date.now();
  const toIso = new Date(nowMs).toISOString();
  // GitHub caps `contributionsCollection` at a one-year span and rejects a
  // wider one outright, so this is 365 days rather than "a year ago today".
  const fromMs = nowMs - 365 * DAY_MS;
  const fromIso = new Date(fromMs).toISOString();
  const todayIso = isoDay(nowMs);

  const allowed = buildAttributionMap(labs, mapping);
  const permitted = permittedNames(allowed);

  /** date → display name → commits. Both sources write here, neither reads. */
  const breakdown: BreakdownByDate = new Map();

  /* ---- contributions ------------------------------------------------ *
   * Windows are anchored to UTC midnight so their boundaries land at
   * 23:59:59Z, which is nowhere near the 07:00:00Z that every
   * `occurredAt` carries — see `partition`. */

  const windows = partition(
    dayMs(isoDay(fromMs)),
    nowMs,
    CONTRIBUTION_WINDOW_DAYS,
    1000,
  );

  const contributions = await githubGraphQL<ContributionsResponse>(
    contributionsQuery(windows),
    {
      from: fromIso,
      to: toIso,
      repos: MAX_CONTRIBUTION_REPOSITORIES,
      days: MAX_CONTRIBUTION_DAYS,
    },
  );

  const year = contributions.viewer.year;
  const calendarWeeks = year.contributionCalendar.weeks;

  /* ---- public aggregates + the public half of attribution ----------- *
   * One pass over every window's repository breakdown. Private entries
   * never appear here at all (see the file header), so the `isPrivate`
   * guard below is a belt-and-braces assertion of GitHub's own
   * behaviour rather than the load-bearing filter it used to be. */

  let publicCommits = 0;
  let truncatedRepos = 0;
  let repositoriesDropped = 0;

  /** Every `owner/name` GitHub named this run. Feeds the seatbelt. */
  const observedRepos = new Set<string>();
  /** Lowercased, for deciding which mapped repos still need the history route. */
  const observedLower = new Set<string>();

  for (let index = 0; index < windows.length; index++) {
    const window = contributions.viewer[`w${index}`] as WindowCollection | undefined;
    if (window === undefined) continue;

    const rows = window.commitContributionsByRepository;

    // GitHub returns at most `maxRepositories` rows but always reports the true
    // total, so truncation is observable rather than silent. Nothing can be done
    // about it here beyond reporting: GitHub offers no way to learn which *days*
    // a dropped repository contributed on, and `ContributionDaySchema` forbids
    // manufacturing a remainder from `count` to cover the gap ("`OTHER_WORK`
    // carries real commits it declines to name, not a remainder"). The days
    // themselves are never dropped — they keep their full `count` and simply
    // carry a breakdown that does not add up to it, which the contract
    // explicitly permits and documents.
    repositoriesDropped += Math.max(
      0,
      window.totalRepositoriesWithContributedCommits - rows.length,
    );

    for (const entry of rows) {
      if (entry.repository.isPrivate) continue;

      const full = entry.repository.nameWithOwner;
      observedRepos.add(full);
      observedLower.add(full.toLowerCase());
      publicCommits += entry.contributions.totalCount;

      // Structurally impossible now that windows are shorter than the page
      // limit — kept as the alarm that says so if `CONTRIBUTION_WINDOW_DAYS`
      // ever drifts above `MAX_CONTRIBUTION_DAYS`.
      if (entry.contributions.pageInfo.hasNextPage) truncatedRepos += 1;

      const displayName = allowed.get(full.toLowerCase())?.displayName ?? OTHER_WORK;

      for (const node of entry.contributions.nodes) {
        // `occurredAt` is the contribution's own day expressed as an instant, and
        // its first ten characters are the same label `contributionCalendar`
        // uses. Verified against live data rather than assumed: every
        // `occurredAt` day in a three-month window is present in the calendar,
        // and every one arrives at exactly `07:00:00Z`.
        record(breakdown, node.occurredAt.slice(0, 10), displayName, node.commitCount);
      }
    }
  }

  /* ---- the private half: commit history for mapped repositories ----- *
   * Only repositories an operator wrote into `gitRepoMap`, and only the
   * ones the public breakdown did not already cover. See the file
   * header for why this route exists and what bounds it. */

  const pairs: HistoryPair[] = [];
  const historyWindows = partition(fromMs, nowMs, HISTORY_WINDOW_DAYS, 0);
  let historyRepositories = 0;

  for (const [full, attribution] of allowed) {
    if (!attribution.fetchHistory) continue;
    if (observedLower.has(full)) continue; // already counted, exactly, by source 1

    const [owner, name, ...rest] = full.split('/');
    if (owner === undefined || name === undefined || rest.length > 0 || name === '') {
      // A malformed key in the mapping file. Skipped silently rather than
      // reported, because the report would have to quote it to be useful and the
      // string is a repository name. `mappingRows` vs `historyRepositories` in
      // the summary is where the discrepancy shows up.
      continue;
    }

    historyRepositories += 1;
    for (const window of historyWindows) {
      pairs.push({
        alias: `p${pairs.length}`,
        owner,
        name,
        displayName: attribution.displayName,
        window,
        cursor: null,
      });
    }
  }

  /** Commit oids already counted, so overlapping windows cannot double count. */
  const seenCommits = new Set<string>();
  let historyRounds = 0;
  let historyCommits = 0;
  let pending = pairs;

  while (pending.length > 0 && historyRounds < MAX_HISTORY_ROUNDS) {
    const page = await githubGraphQL<Record<string, HistoryNode>>(historyQuery(pending), {
      viewer: contributions.viewer.id,
      page: MAX_HISTORY_PAGE_SIZE,
    });
    historyRounds += 1;

    const next: HistoryPair[] = [];

    for (const pair of pending) {
      // `null` is the ordinary answer for a repo that has been renamed, deleted
      // or had access revoked since the mapping row was written — GitHub reports
      // it as a `NOT_FOUND` in `errors` alongside usable data, which
      // `githubGraphQL` logs and does not throw on.
      const history = page[pair.alias]?.defaultBranchRef?.target?.history;
      if (history === undefined) continue;

      for (const node of history.nodes) {
        if (seenCommits.has(node.oid)) continue;
        seenCommits.add(node.oid);

        const date = attributionDay(node.committedDate);
        if (date === null) continue;

        record(breakdown, date, pair.displayName, 1);
        historyCommits += 1;
      }

      if (history.pageInfo.hasNextPage && history.pageInfo.endCursor !== null) {
        next.push({ ...pair, cursor: history.pageInfo.endCursor });
      }
    }

    pending = next;
  }

  /* ---- the grid ------------------------------------------------------ */

  const built = buildCalendar(calendarWeeks, breakdown);
  const grid = built.calendar;

  // THE SEATBELT. Nothing below this line may add a string to the grid.
  assertNoRepoIdentifiers(grid, permitted, observedRepos);

  /* ---- languages ---------------------------------------------------- */

  const languageResponse = await githubGraphQL<LanguagesResponse>(LANGUAGES_QUERY, {
    repos: 100,
    languages: 12,
  });

  const sizes = new Map<string, number>();
  for (const repo of languageResponse.viewer.repositories.nodes) {
    for (const edge of repo.languages.edges) {
      sizes.set(edge.node.name, (sizes.get(edge.node.name) ?? 0) + edge.size);
    }
  }

  /* ---- curated Lab repositories ------------------------------------ */

  const labStats: FetchedGitStats['labStats'] = [];
  const labsSkipped: FetchedGitStats['labsSkipped'] = [];

  // `owner/name`, split here rather than interpolated into a path, so a value
  // that is not in that shape is a reported skip and not a malformed query.
  const targets: Array<{ slug: string; owner: string; name: string }> = [];
  for (const lab of labs) {
    const [owner, name, ...rest] = lab.repoFullName.split('/');
    if (owner === undefined || name === undefined || rest.length > 0 || name === '') {
      labsSkipped.push({
        slug: lab.slug,
        reason: 'repoFullName is not in GitHub `owner/name` form',
      });
      continue;
    }
    targets.push({ slug: lab.slug, owner, name });
  }

  if (targets.length > 0) {
    const since = new Date(fromMs).toISOString();
    const repoResponse = await githubGraphQL<Record<string, RepoStats | null>>(
      labRepoQuery(targets),
      { since },
    );

    targets.forEach((target, index) => {
      const repo = repoResponse[`r${index}`];

      if (repo === null || repo === undefined) {
        // A `NOT_FOUND` in the errors array; the detail is in the log. The Lab's
        // hand-written `liveStats` is left exactly as it is — see the note in
        // snapshotBuild.applyLabStats about why a missing repo must not zero a
        // curated row.
        labsSkipped.push({
          slug: target.slug,
          reason: 'repository not found for this token (renamed, deleted, or no access)',
        });
        return;
      }

      if (repo.isPrivate) {
        // ADR 008 + ADR 014. The resolved name is NOT included in the reason.
        labsSkipped.push({
          slug: target.slug,
          reason:
            'repository resolves to a PRIVATE repo; refusing to publish its stats (ADR 008). Fix the curation in `labs`.',
        });
        return;
      }

      const history = repo.defaultBranchRef?.target?.history?.totalCount;

      labStats.push({
        slug: target.slug,
        stars: repo.stargazerCount,
        forks: repo.forkCount,
        // An empty repository has no default branch and therefore no history.
        commitsYear: history ?? 0,
        // `pushedAt` is null on a repo that has never been pushed to. The
        // mutation treats an empty string as "leave the stored timestamp".
        lastPushedAt: repo.pushedAt ?? '',
      });
    });
  }

  /* ---- assemble ----------------------------------------------------- */

  const days = grid.flat();

  return {
    login: contributions.viewer.login,
    gitStats: {
      // The headline figure. Includes private/restricted work, which is the
      // whole reason a PAT is used (ADR 008).
      totalContributionsYear: year.contributionCalendar.totalContributions,
      privateContributions: year.restrictedContributionsCount,
      // Commits in repositories anyone can see, and how many of them there are —
      // exactly the sentence GitSignal prints: "N public commits across M
      // repositories".
      publicCommits,
      publicRepoCount: observedRepos.size,
      totalPublicRepoCount: languageResponse.viewer.publicRepositories.totalCount,
      currentStreakDays: currentStreak(grid, todayIso),
      calendar: grid,
      languages: toLanguageShares(sizes),
    },
    labStats,
    labsSkipped,
    attribution: {
      mappingRows: mapping.length,
      repositoriesSeen: observedRepos.size,
      repositoriesDropped,
      historyRepositories,
      historyRounds,
      historyCommits,
      historyPagesExhausted: pending.length,
      truncatedRepos,
      daysWithBreakdown: days.filter((day) => day.byProject.length > 0).length,
      attributedDays: days.filter((day) => day.project !== null).length,
      daysClamped: built.daysClamped,
      daysDropped: built.daysDropped,
      attributedCommits: days.reduce(
        (sum, day) => sum + day.byProject.reduce((inner, entry) => inner + entry.commits, 0),
        0,
      ),
    },
  };
}

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

/**
 * What `rebuild` reports back.
 *
 * Annotated rather than inferred because this handler calls across a module
 * boundary through the generated `internal` object, which is typed from every
 * module including this one — an inferred return there is a circular reference
 * and TypeScript refuses it with TS7022. See the same note in snapshotBuild.ts.
 *
 * Read it as the ADR 008 audit surface, too: these are all the strings this
 * pipeline can emit, and the only ones with a repository-shaped value are Lab
 * `slug`s and `languages[].name`. `attribution` is numbers throughout.
 */
export type RebuildSummary = {
  ok: true;
  login: string;
  computedAt: string;
  totalContributionsYear: number;
  privateContributions: number;
  publicCommits: number;
  publicRepoCount: number;
  totalPublicRepoCount: number;
  currentStreakDays: number;
  calendarWeeks: number;
  languages: Array<{ name: string; pct: number }>;
  attribution: AttributionSummary;
  labsRefreshed: number;
  labsSkipped: Array<{ slug: string; reason: string }>;
  aiUsage: SnapshotBuildSummary['aiUsage'];
  healthDays: number;
  latestFunEntry: string | null;
  projectsScored: number;
};

/**
 * Fetch GitHub, rebuild the Snapshot. The hourly cron's entry point.
 *
 *     bunx convex run gitStats:rebuild '{}'
 *
 * Order of operations, and why it is this way round: the Lab list and the
 * attribution mapping are read *first*, in their own queries, because the repo
 * stats query and the history query are built from them — an action cannot read
 * the database, so there is no way to interleave. Then one mutation writes
 * everything at once, so a reader never observes a Snapshot with this hour's
 * calendar and last hour's Lab numbers.
 *
 * A failure anywhere before the mutation leaves the previous Snapshot in place,
 * untouched. That is the correct failure mode for a page whose header says "as
 * of <computedAt>": stale-but-consistent beats half-rebuilt, and the stale
 * timestamp is visible on the site rather than hidden in a log. It is also why
 * `assertNoRepoIdentifiers` throws rather than sanitising — a calendar that
 * failed the seatbelt is not written, and last hour's honest one stays up.
 *
 * @returns a summary for the operator: the totals that were written, every Lab
 *   that was skipped with the reason, and the attribution diagnostics. Numbers
 *   and slugs only — see the ADR 008 note in the file header.
 */
export const rebuild = internalAction({
  args: {},
  handler: async (ctx): Promise<RebuildSummary> => {
    const labs: CuratedLabRepo[] = await ctx.runQuery(
      internal.snapshotBuild.curatedLabRepos,
      {},
    );
    const mapping: GitRepoMapEntry[] = await ctx.runQuery(internal.repoMap.entries, {});
    const fetched = await fetchGitStats(labs, mapping);

    const applied: SnapshotBuildSummary = await ctx.runMutation(
      internal.snapshotBuild.apply,
      { gitStats: fetched.gitStats, labStats: fetched.labStats },
    );

    return {
      ok: true as const,
      login: fetched.login,
      computedAt: applied.computedAt,

      totalContributionsYear: fetched.gitStats.totalContributionsYear,
      privateContributions: fetched.gitStats.privateContributions,
      publicCommits: fetched.gitStats.publicCommits,
      publicRepoCount: fetched.gitStats.publicRepoCount,
      totalPublicRepoCount: fetched.gitStats.totalPublicRepoCount,
      currentStreakDays: fetched.gitStats.currentStreakDays,
      calendarWeeks: fetched.gitStats.calendar.length,
      languages: fetched.gitStats.languages,

      attribution: fetched.attribution,

      labsRefreshed: applied.labsRefreshed,
      labsSkipped: fetched.labsSkipped,

      aiUsage: applied.aiUsage,
      healthDays: applied.healthDays,
      latestFunEntry: applied.latestFunEntry,
      projectsScored: applied.projectsScored,
    };
  },
});

/**
 * Everything `rebuild` does except the write.
 *
 *     bunx convex run gitStats:preview '{}'
 *
 * This exists for the verification step in the plan — "assert the cron's git
 * totals match a manual `gh api graphql contributionsCollection` call" — which
 * needs to be able to read the pipeline's arithmetic without moving the live
 * numbers underneath the page while it is being compared. It is also the safe
 * thing to run against a deployment whose Snapshot you do not want to disturb.
 *
 * The calendar is summarised rather than returned: 364 days of JSON in a
 * terminal is not a diagnostic, and the numbers that matter are asserted here.
 * `busiestDay` is the exception — one cell, printed in full, because "does the
 * popup actually have per-project counts in it" is not a question a total can
 * answer. It is safe to print for the same reason the calendar is safe to store:
 * every string in it has been through `assertNoRepoIdentifiers`.
 */
export const preview = internalAction({
  args: {},
  handler: async (ctx) => {
    const labs = await ctx.runQuery(internal.snapshotBuild.curatedLabRepos, {});
    const mapping: GitRepoMapEntry[] = await ctx.runQuery(internal.repoMap.entries, {});
    const fetched = await fetchGitStats(labs, mapping);
    const days = fetched.gitStats.calendar.flat();

    const busiestDay = days
      .filter((day) => day.byProject.length > 0)
      .sort((a, b) => b.count - a.count)[0];

    return {
      ok: true as const,
      login: fetched.login,
      wrote: false as const,

      totalContributionsYear: fetched.gitStats.totalContributionsYear,
      privateContributions: fetched.gitStats.privateContributions,
      publicCommits: fetched.gitStats.publicCommits,
      publicRepoCount: fetched.gitStats.publicRepoCount,
      totalPublicRepoCount: fetched.gitStats.totalPublicRepoCount,
      currentStreakDays: fetched.gitStats.currentStreakDays,
      languages: fetched.gitStats.languages,

      calendarWeeks: fetched.gitStats.calendar.length,
      calendarDays: days.length,
      // The grid covers 52 of the ~52.2 weeks GitHub reported, so this is
      // expected to be slightly BELOW `totalContributionsYear` — the difference
      // is the days trimmed off the front. A grid summing to *more* than the
      // total would mean the padding invented contributions.
      calendarSum: days.reduce((sum, day) => sum + day.count, 0),
      calendarFirstDay: days[0]?.date ?? null,
      calendarLastDay: days[days.length - 1]?.date ?? null,

      attribution: fetched.attribution,
      busiestDay: busiestDay ?? null,

      labStats: fetched.labStats,
      labsSkipped: fetched.labsSkipped,
    };
  },
});
