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
 *     a repository name that was not already public *and* already curated into
 *     the `labs` table by hand (ADR 014). Grep the return type: the only
 *     `string` fields that can hold a repo-shaped value are `slug` (a Lab's own
 *     slug, written by an admin) and the `project` label on a calendar day,
 *     which is resolved through the Lab allowlist below.
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
 * `ctx.db` does not exist here. The two reads this pipeline needs (the curated
 * Lab repos to fetch stats for) and the one write it produces (the Snapshot) go
 * through `internal.snapshotBuild.*` — see that file, which owns every row this
 * pipeline lands.
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
 * Repositories to ask for commit contributions in. GitHub's own ceiling is 100.
 *
 * Used for two aggregate figures (`publicCommits`, `publicRepoCount`) and for
 * per-day attribution. Repos beyond this are simply not counted, which at a
 * realistic scale (15 today) is not a live concern — but it is why the summary
 * reports `repositoriesSeen`, so the day it becomes one is visible.
 */
const MAX_CONTRIBUTION_REPOSITORIES = 100;

/**
 * Day-buckets fetched per repository. GitHub's ceiling is 100, newest first.
 *
 * Only used for attribution, and only for repos in the Lab allowlist. A Lab with
 * more than 100 active days in the window loses attribution on its *oldest*
 * days, which renders as `project: null` — a tooltip that says nothing rather
 * than one that says something false. `truncatedRepos` in the summary counts
 * how often that happened, so the cost of not paginating stays measurable.
 */
const MAX_CONTRIBUTION_DAYS = 100;

/**
 * The share of a day's contributions a single repo must account for before its
 * name is printed as that day's project.
 *
 * This is the honesty gate on the heatmap tooltip, and it is worth being precise
 * about what it is protecting. `contributionDay.project` is documented as "the
 * project receiving most of that day's commits". The calendar's `count` includes
 * restricted work whose repository this file may not name (ADR 008), so a day
 * can be 400 unnameable commits and 3 public ones. Attributing that day to the
 * public repo would be a true sentence about a false subject — the tooltip would
 * be describing 0.7% of the day.
 *
 * So a day is attributed only when one allowlisted repo accounts for a strict
 * majority of the day's *total* contribution count. Otherwise the day is `null`,
 * which the Heatmap renders as "No project activity" and which every honest
 * alternative reduces to.
 */
const ATTRIBUTION_MAJORITY = 0.5;

/* ------------------------------------------------------------------ *
 * GraphQL transport
 * ------------------------------------------------------------------ */

/** What every failure from this file carries, so a caller can tell them apart. */
export type GitStatsErrorData = {
  code: 'missing-token' | 'github-error' | 'github-unavailable';
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
 * Queries
 *
 * Written as constants rather than built per call, so the exact text
 * sent to GitHub is greppable and can be pasted into
 * https://docs.github.com/en/graphql/overview/explorer verbatim — which
 * is how the verification step in the plan ("assert the cron's git
 * totals match a manual `gh api graphql` call") is actually performed.
 * ------------------------------------------------------------------ */

/**
 * Contributions for the trailing year: the totals, the calendar, and the
 * per-repository commit breakdown that attribution is resolved from.
 *
 * `viewer` rather than `user(login:)` on purpose — the token defines whose
 * contributions these are, so there is no login constant to keep in step with
 * `siteSettings.identity.github`, and no way to accidentally publish someone
 * else's numbers. The login comes back for the summary so the operator can see
 * which account answered.
 *
 * `restrictedContributionsCount` is the ADR 008 figure: the count of
 * contributions in repositories the viewer can see but the public cannot. It is
 * a number with no accompanying names, by GitHub's design and ours.
 */
const CONTRIBUTIONS_QUERY = `
query Contributions($from: DateTime!, $to: DateTime!, $repos: Int!, $days: Int!) {
  viewer {
    login
    contributionsCollection(from: $from, to: $to) {
      totalCommitContributions
      restrictedContributionsCount
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays {
            date
            weekday
            contributionCount
            contributionLevel
          }
        }
      }
      commitContributionsByRepository(maxRepositories: $repos) {
        repository {
          nameWithOwner
          isPrivate
        }
        contributions(first: $days) {
          totalCount
          pageInfo { hasNextPage }
          nodes {
            occurredAt
            commitCount
          }
        }
      }
    }
  }
}`;

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
 * Hand-written rather than generated: four queries do not justify a
 * codegen step, and a mismatch surfaces immediately as `undefined` in
 * a number that the mutation's validator then rejects.
 * ------------------------------------------------------------------ */

/** GitHub's quartile enum on a calendar day. Maps to the contract's 0–4. */
type ContributionLevelName =
  | 'NONE'
  | 'FIRST_QUARTILE'
  | 'SECOND_QUARTILE'
  | 'THIRD_QUARTILE'
  | 'FOURTH_QUARTILE';

type ContributionsResponse = {
  viewer: {
    login: string;
    contributionsCollection: {
      totalCommitContributions: number;
      restrictedContributionsCount: number;
      contributionCalendar: {
        totalContributions: number;
        weeks: Array<{
          contributionDays: Array<{
            date: string;
            weekday: number;
            contributionCount: number;
            contributionLevel: ContributionLevelName;
          }>;
        }>;
      };
      commitContributionsByRepository: Array<{
        repository: { nameWithOwner: string; isPrivate: boolean };
        contributions: {
          totalCount: number;
          pageInfo: { hasNextPage: boolean };
          nodes: Array<{ occurredAt: string; commitCount: number }>;
        };
      }>;
    };
  };
};

type LanguagesResponse = {
  viewer: {
    repositories: {
      totalCount: number;
      nodes: Array<{
        languages: { edges: Array<{ size: number; node: { name: string } }> };
      }>;
    };
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
 * ------------------------------------------------------------------ */

/**
 * `repoFullName` (lowercased) → the Lab's display title.
 *
 * THE ALLOWLIST. A repository name that is not a key in this map can never
 * become a `project` label, which is the mechanical form of ADR 008 + ADR 014:
 * private repos are absent because they were never curated in, and public but
 * uncurated repos (`dddddd`, `test`, 2016 coursework — ADR 014's own examples)
 * are absent for the same reason they are absent from /labs.
 *
 * Keyed case-insensitively because GitHub is: `CoreyBain/Boca` and
 * `coreybain/boca` are one repository and an admin may have typed either.
 */
function buildAllowlist(labs: CuratedLabRepo[]): Map<string, string> {
  const allowed = new Map<string, string>();
  for (const lab of labs) {
    if (!lab.isPublic) continue;
    allowed.set(lab.repoFullName.toLowerCase(), lab.title);
  }
  return allowed;
}

/* ------------------------------------------------------------------ *
 * Calendar
 * ------------------------------------------------------------------ */

type CalendarDay = {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
  project: string | null;
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
 *   3. **Sunday-first.** GitHub's `weekday` is already 0 = Sunday, and its weeks
 *      already start on Sunday, so this is inherited rather than imposed — but
 *      the padding maths depends on it, hence the note.
 */
function buildCalendar(
  weeks: ContributionsResponse['viewer']['contributionsCollection']['contributionCalendar']['weeks'],
  projectByDate: Map<string, string>,
): CalendarDay[][] {
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

  if (lastDate === null) return [];

  // Extend to the Saturday of the final week so the last column is full, then
  // reach back exactly 52 × 7 days. `getUTCDay()` is 0 = Sunday.
  const lastMs = dayMs(lastDate);
  const gridEndMs = lastMs + (6 - new Date(lastMs).getUTCDay()) * DAY_MS;
  const gridStartMs = gridEndMs - (WEEKS * DAYS_PER_WEEK - 1) * DAY_MS;

  const grid: CalendarDay[][] = [];

  for (let week = 0; week < WEEKS; week++) {
    const column: CalendarDay[] = [];

    for (let weekday = 0; weekday < DAYS_PER_WEEK; weekday++) {
      const date = isoDay(gridStartMs + (week * DAYS_PER_WEEK + weekday) * DAY_MS);
      const observed = byDate.get(date);
      const count = observed?.count ?? 0;

      column.push({
        date,
        count,
        level: observed?.level ?? 0,
        // A day with no commits has no project, whatever attribution thinks.
        project: count > 0 ? (projectByDate.get(date) ?? null) : null,
      });
    }

    grid.push(column);
  }

  return grid;
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
  /** Days in the grid that carry a project label. Diagnostic, not data. */
  attributedDays: number;
  repositoriesSeen: number;
  /** Allowlisted repos whose day-buckets hit `MAX_CONTRIBUTION_DAYS`. */
  truncatedRepos: number;
};

/**
 * Fetch and reshape everything. Pure with respect to the database — it reads no
 * rows and writes none; the caller supplies the Lab list and stores the result.
 *
 * Split out from the action so that `preview` and `rebuild` cannot drift: the
 * dry run and the real run execute *this* function, and differ only in whether
 * they call `snapshotBuild.apply` afterwards.
 */
async function fetchGitStats(labs: CuratedLabRepo[]): Promise<FetchedGitStats> {
  const nowMs = Date.now();
  const toIso = new Date(nowMs).toISOString();
  // GitHub caps `contributionsCollection` at a one-year span and rejects a
  // wider one outright, so this is 365 days rather than "a year ago today".
  const fromIso = new Date(nowMs - 365 * DAY_MS).toISOString();
  const todayIso = isoDay(nowMs);

  const allowlist = buildAllowlist(labs);

  /* ---- contributions ---------------------------------------------- */

  const contributions = await githubGraphQL<ContributionsResponse>(
    CONTRIBUTIONS_QUERY,
    {
      from: fromIso,
      to: toIso,
      repos: MAX_CONTRIBUTION_REPOSITORIES,
      days: MAX_CONTRIBUTION_DAYS,
    },
  );

  const collection = contributions.viewer.contributionsCollection;
  const calendar = collection.contributionCalendar;

  // Day → total contributions, so attribution can test its majority against the
  // same number the tooltip prints.
  const totalByDate = new Map<string, number>();
  for (const week of calendar.weeks) {
    for (const day of week.contributionDays) {
      totalByDate.set(day.date, day.contributionCount);
    }
  }

  /* ---- public aggregates + attribution ----------------------------- *
   * One pass over the repository breakdown. Private entries contribute
   * to nothing here — not the counts, not the map, not a log line — and
   * their names go out of scope with the loop iteration. */

  let publicCommits = 0;
  let publicRepoCount = 0;
  let truncatedRepos = 0;

  /** date → (allowlisted project title → commits that day). */
  const namedByDate = new Map<string, Map<string, number>>();

  for (const entry of collection.commitContributionsByRepository) {
    if (entry.repository.isPrivate) continue;

    publicRepoCount += 1;
    publicCommits += entry.contributions.totalCount;

    const title = allowlist.get(entry.repository.nameWithOwner.toLowerCase());
    if (title === undefined) continue;

    if (entry.contributions.pageInfo.hasNextPage) truncatedRepos += 1;

    for (const node of entry.contributions.nodes) {
      // `occurredAt` is midnight of the contribution's own day expressed as an
      // instant, so the first ten characters are that day's label — the same
      // label `contributionCalendar` uses. Verified against live data before
      // relying on it: both sides agree for this account's timezone.
      const date = node.occurredAt.slice(0, 10);
      const perProject = namedByDate.get(date) ?? new Map<string, number>();
      perProject.set(title, (perProject.get(title) ?? 0) + node.commitCount);
      namedByDate.set(date, perProject);
    }
  }

  /** date → project title, for days one named project provably dominated. */
  const projectByDate = new Map<string, string>();
  for (const [date, perProject] of namedByDate) {
    const dayTotal = totalByDate.get(date) ?? 0;
    if (dayTotal <= 0) continue;

    let bestTitle: string | null = null;
    let bestCommits = 0;
    for (const [title, commits] of perProject) {
      if (commits > bestCommits) {
        bestTitle = title;
        bestCommits = commits;
      }
    }

    // The honesty gate — see ATTRIBUTION_MAJORITY.
    if (bestTitle !== null && bestCommits > dayTotal * ATTRIBUTION_MAJORITY) {
      projectByDate.set(date, bestTitle);
    }
  }

  const grid = buildCalendar(calendar.weeks, projectByDate);

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
    const since = new Date(nowMs - 365 * DAY_MS).toISOString();
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

  return {
    login: contributions.viewer.login,
    gitStats: {
      // The headline figure. Includes private/restricted work, which is the
      // whole reason a PAT is used (ADR 008).
      totalContributionsYear: calendar.totalContributions,
      privateContributions: collection.restrictedContributionsCount,
      // Commits in repositories anyone can see, and how many of them there are —
      // exactly the sentence GitSignal prints: "N public commits across M
      // repositories".
      publicCommits,
      publicRepoCount,
      currentStreakDays: currentStreak(grid, todayIso),
      calendar: grid,
      languages: toLanguageShares(sizes),
    },
    labStats,
    labsSkipped,
    attributedDays: grid.flat().filter((day) => day.project !== null).length,
    repositoriesSeen: collection.commitContributionsByRepository.length,
    truncatedRepos,
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
 * `slug`s and `languages[].name`.
 */
export type RebuildSummary = {
  ok: true;
  login: string;
  computedAt: string;
  totalContributionsYear: number;
  privateContributions: number;
  publicCommits: number;
  publicRepoCount: number;
  currentStreakDays: number;
  calendarWeeks: number;
  languages: Array<{ name: string; pct: number }>;
  attributedDays: number;
  repositoriesSeen: number;
  truncatedRepos: number;
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
 * Order of operations, and why it is this way round: the Lab list is read
 * *first*, in its own query, because the repo stats query is built from it — an
 * action cannot read the database, so there is no way to interleave. Then one
 * mutation writes everything at once, so a reader never observes a Snapshot with
 * this hour's calendar and last hour's Lab numbers.
 *
 * A failure anywhere before the mutation leaves the previous Snapshot in place,
 * untouched. That is the correct failure mode for a page whose header says "as
 * of <computedAt>": stale-but-consistent beats half-rebuilt, and the stale
 * timestamp is visible on the site rather than hidden in a log.
 *
 * @returns a summary for the operator: the totals that were written, and every
 *   Lab that was skipped with the reason. Numbers and slugs only — see the ADR
 *   008 note in the file header.
 */
export const rebuild = internalAction({
  args: {},
  handler: async (ctx): Promise<RebuildSummary> => {
    const labs: CuratedLabRepo[] = await ctx.runQuery(
      internal.snapshotBuild.curatedLabRepos,
      {},
    );
    const fetched = await fetchGitStats(labs);

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
      currentStreakDays: fetched.gitStats.currentStreakDays,
      calendarWeeks: fetched.gitStats.calendar.length,
      languages: fetched.gitStats.languages,

      attributedDays: fetched.attributedDays,
      repositoriesSeen: fetched.repositoriesSeen,
      truncatedRepos: fetched.truncatedRepos,

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
 * terminal is not a diagnostic, and the two numbers that matter (the grid sums
 * to the same total GitHub reported, and it is 52 columns) are asserted here.
 */
export const preview = internalAction({
  args: {},
  handler: async (ctx) => {
    const labs = await ctx.runQuery(internal.snapshotBuild.curatedLabRepos, {});
    const fetched = await fetchGitStats(labs);
    const days = fetched.gitStats.calendar.flat();

    return {
      ok: true as const,
      login: fetched.login,
      wrote: false as const,

      totalContributionsYear: fetched.gitStats.totalContributionsYear,
      privateContributions: fetched.gitStats.privateContributions,
      publicCommits: fetched.gitStats.publicCommits,
      publicRepoCount: fetched.gitStats.publicRepoCount,
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

      attributedDays: fetched.attributedDays,
      repositoriesSeen: fetched.repositoriesSeen,
      truncatedRepos: fetched.truncatedRepos,

      labStats: fetched.labStats,
      labsSkipped: fetched.labsSkipped,
    };
  },
});
