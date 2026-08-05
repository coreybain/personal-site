/**
 * snapshotBuild.ts — the write half of the hourly rebuild (ADR 004).
 *
 * `snapshot.ts` reads the Snapshot. This file *builds* it: one internal mutation
 * that assembles the singleton row from four independent sources and lands them
 * in a single transaction, plus the one internal query the git action needs
 * because an action cannot touch `ctx.db`.
 *
 *     identity        ← siteSettings (the source of truth; the row holds a copy)
 *     gitStats        ← passed in by `gitStats.rebuild`, which fetched it
 *     aiUsage         ← folded from `aiUsageDays` (Pipeline 2, the Collector)
 *     healthStats     ← folded from `healthDays`  (Pipeline 3, the phone)
 *     latestFunEntry  ← the newest `funEntries` row, copied whole
 *     computedAt      ← now
 *
 * ── One transaction, on purpose ────────────────────────────────────────────
 *
 * Everything above is written by a single mutation, and so are the two derived
 * writes that ride along with it (`labs.liveStats`, `projects.aiBuildStats`).
 * Convex mutations are transactional, so a reader can never observe this hour's
 * contribution calendar beside last hour's AI numbers. That property is what
 * lets `computedAt` be described on the site as "the instant every relative
 * figure is measured against" — it is one instant because it is one write.
 *
 * ── The rule these folds obey ──────────────────────────────────────────────
 *
 * **A fold reports what the raw tables say, including when they say nothing.**
 * It never carries a previous value forward to keep a number looking healthy. An
 * empty `aiUsageDays` folds to zeroes and an empty `healthDays` folds to `null`,
 * because a Snapshot that quietly reprints last week's figures is worse than one
 * that admits the Collector has stopped — the site's whole claim is that the
 * numbers are measured.
 *
 * The one thing that is *not* overwritten is hand-written Lab content: a Lab
 * whose repository could not be read keeps its curated `liveStats`. Project AI
 * totals are different: they are wholly derived from `aiUsageDays`, so a project
 * absent from the current fold has its old `aiBuildStats` removed rather than
 * carrying a seeded or out-of-window number forward.
 *
 * ── Why the validators are re-declared here ────────────────────────────────
 *
 * `schema.ts` declares `snapshot.gitStats` and `contributionDay` inline and
 * exports neither, and this phase may not edit that file. They are mirrored
 * below field for field — the same thing `labs.ts` does for `labLinks` and
 * `labLiveStats`, for the same reason and with the same hazard: a field added to
 * the schema and not here is a field this pipeline cannot write.
 */

import { ConvexError, v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server';
import { DAY_MS, dayMs, isoDay } from './lib/days';
import { nowIso } from './lib/validate';

/* ------------------------------------------------------------------ *
 * Mirrored validators
 * ------------------------------------------------------------------ */

/**
 * Mirrors the (unexported) `contributionProject` in schema.ts.
 *
 * ⚠️ `name` is a DISPLAY NAME — a case-study title, a Lab title, or the neutral
 * bucket `'Other work'`. Never a repository identifier. `gitStats.ts` resolves
 * every one of these through its two allowlists and then asserts the result in
 * `assertNoRepoIdentifiers` before handing it to this mutation; this validator
 * is a shape check and is emphatically *not* that assertion.
 */
const contributionProject = v.object({
  name: v.string(),
  commits: v.number(),
});

/** Mirrors the (unexported) `contributionDay` in schema.ts. */
const contributionDay = v.object({
  date: v.string(),
  count: v.number(),
  level: v.union(
    v.literal(0),
    v.literal(1),
    v.literal(2),
    v.literal(3),
    v.literal(4),
  ),
  /**
   * ADR 008: only a named, curated project title ever arrives here, resolved
   * through the allowlists in `gitStats.ts`. `null` is the normal value.
   */
  project: v.union(v.string(), v.null()),
  /**
   * The day popup's per-project commit counts.
   *
   * **Required here, `v.optional()` in schema.ts**, and the asymmetry is
   * deliberate rather than an oversight. schema.ts has to tolerate the stored
   * `snapshot` singleton that predates the field, because Convex validates
   * existing documents on push. This validator guards the *payload* instead, and
   * the payload is produced fresh by `gitStats.rebuild` on every tick — there is
   * no legacy producer to accommodate, so requiring it here is what turns
   * "the cron forgot to send the breakdown" from a silently empty popup into a
   * rejected mutation that leaves last hour's honest row in place.
   */
  byProject: v.array(contributionProject),
});

/** Mirrors `snapshot.gitStats`. The payload `gitStats.rebuild` produces. */
export const gitStatsPayload = v.object({
  totalContributionsYear: v.number(),
  privateContributions: v.number(),
  publicCommits: v.number(),
  publicRepoCount: v.number(),
  totalPublicRepoCount: v.number(),
  currentStreakDays: v.number(),
  calendar: v.array(v.array(contributionDay)),
  languages: v.array(v.object({ name: v.string(), pct: v.number() })),
});

/**
 * One Lab's refreshed GitHub numbers, keyed by the Lab's own slug.
 *
 * Keyed by `slug` and not by `repoFullName` deliberately: the action asks GitHub
 * about a name and GitHub may answer about a *different* one (repos get renamed
 * and moved into organisations). Joining the answer back on the question is how
 * a renamed-and-since-privatised repo fails to match instead of silently
 * publishing under its old identity.
 */
const labStatPayload = v.object({
  slug: v.string(),
  stars: v.number(),
  forks: v.number(),
  commitsYear: v.number(),
  /** RFC 3339. Empty string means GitHub had none — the stored value survives. */
  lastPushedAt: v.string(),
});

/* ------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------ */

// DAY_MS, isoDay and dayMs come from lib/days.ts — see that file for why this
// package keeps exactly one definition of calendar-label arithmetic.

/** Days in `healthStats.recentDays` / the window `sevenDayAverageSteps` means. */
const HEALTH_WINDOW_DAYS = 7;

/** Projects listed in `aiUsage.topProjects`. A display-sized list. */
const MAX_TOP_PROJECTS = 5;

/**
 * `aiAgent` id → the product name the dashboard prints.
 *
 * Hand-mirrored from `AI_AGENT_LABELS` in `@home/types`, which the schema calls
 * "the one place the two are associated" — this file cannot import it (see the
 * header of `lib/validate.ts` for why `packages/convex` depends on nothing but
 * `convex`), so it is mirrored with the same discipline as every other constant
 * that crosses that boundary. `snapshot.aiUsage.agents[].name` is a display
 * label; `aiUsageDays.agent` is the machine id. Never store one where the other
 * belongs.
 */
const AGENT_LABELS: Record<Doc<'aiUsageDays'>['agent'], string> = {
  claude: 'Claude Code',
  codex: 'Codex',
};

/* ------------------------------------------------------------------ *
 * Dates
 * ------------------------------------------------------------------ */

/**
 * Whole calendar days between two ISO instants, floored at 0.
 *
 * Measured between UTC *midnights* rather than as elapsed hours, and clamped at
 * zero, matching `daysAgo` in `apps/web/src/lib/data.ts` exactly — a push at
 * 23:00 and one at 01:00 the next morning must not both render as "1 day ago" on
 * one surface and "0"/"1" on another. The clamp covers a push timestamped after
 * `computedAt`, which happens whenever GitHub is fetched mid-rebuild.
 */
function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, Math.floor(to / DAY_MS) - Math.floor(from / DAY_MS));
}

/* ------------------------------------------------------------------ *
 * Return types
 *
 * Declared rather than inferred, and not for documentation: every
 * module in this package imports the generated `internal` object,
 * which is typed from every module — so a handler whose return type is
 * inferred *from* a call through `internal` is a circular reference
 * and TypeScript gives up with TS7022/TS7023. Annotating the return of
 * anything called across a module boundary breaks the cycle. This is
 * the documented Convex idiom, not a workaround for a local mistake.
 * ------------------------------------------------------------------ */

/** One curated Lab, as the git action needs it. See `curatedLabRepos`. */
export type CuratedLabRepo = {
  slug: string;
  title: string;
  repoFullName: string;
  isPublic: boolean;
};

/** What `apply` reports back. Counts and slugs only — never a repository name. */
export type SnapshotBuildSummary = {
  computedAt: string;
  labsRefreshed: number;
  projectsScored: number;
  aiUsage: {
    rowsRead: number;
    totalSessions: number;
    totalHours: number;
    agents: number;
    topProjects: number;
  };
  healthDays: number;
  latestFunEntry: string | null;
};

/* ------------------------------------------------------------------ *
 * Reads for the action
 * ------------------------------------------------------------------ */

/**
 * The curated Lab repositories the git action should fetch stats for.
 *
 * An action has no `ctx.db`, so this is how `gitStats.rebuild` learns which
 * repositories exist — and it is also the ADR 014 allowlist in its entirety:
 * the *only* repository names that pipeline is permitted to name in output are
 * the ones this query returns.
 *
 * Drafts are included. A Lab being curated in should show real numbers the
 * moment it is published rather than an hour later, and an unpublished row is
 * not visible to anyone but the admin in the meantime.
 *
 * `isPublic` is `published` renamed at the boundary, because it means something
 * different on the other side: to the git action it is "may this repo's title
 * appear in a public tooltip", not "does this row render on /labs".
 */
export const curatedLabRepos = internalQuery({
  args: {},
  handler: async (ctx): Promise<CuratedLabRepo[]> => {
    const rows = await ctx.db.query('labs').withIndex('by_sortOrder').collect();

    return rows.map((row) => ({
      slug: row.slug,
      title: row.title,
      repoFullName: row.repoFullName,
      isPublic: row.published,
    }));
  },
});

/* ------------------------------------------------------------------ *
 * Folds
 * ------------------------------------------------------------------ */

type AiUsageFold = {
  totalSessions: number;
  totalHours: number;
  agents: Array<{ name: string; sessions: number }>;
  topProjects: Array<{ name: string; sessions: number }>;
  /** Per-project totals for ADR 016, keyed by project slug. Not stored here. */
  byProject: Map<string, { sessions: number; hours: number }>;
  rowsRead: number;
};

/**
 * `aiUsageDays` → `snapshot.aiUsage`, plus the per-project totals ADR 016 wants.
 *
 * ── The window is the heatmap's window, exactly ────────────────────────────
 *
 * `windowStart` is the first date in the contribution calendar this same rebuild
 * just produced. That is not tidiness — `AiSignal` prints the strapline "Same 52
 * weeks · measured, not estimated" and divides `totalSessions` by
 * `gitStats.calendar.length` to get sessions-per-week. If the AI fold covered a
 * different span than the grid, that sentence would be false and the derived
 * cadence figures would be wrong by the ratio between them.
 *
 * ── Totals and the breakdown are read from different fields ───────────────
 *
 * `aiUsageDays.sessions`/`hours` are the agent's totals for the day and are
 * explicitly NOT constrained to equal the sum over `projects[]` — a session in a
 * directory with no project mapping is real work with nowhere to land in the
 * breakdown. So `totalSessions` comes from the row totals and `topProjects` from
 * the breakdown, and neither is derived from the other. Totals ≥ breakdown sum,
 * always; a reader noticing that `topProjects` does not add up to
 * `totalSessions` is seeing the truth, not a bug.
 *
 * ── Several computers, summed ──────────────────────────────────────────────
 *
 * `aiUsageDays` is keyed on (`day`, `agent`, `machine`), so one calendar day
 * holds up to `machines × agents` rows and **the fold must add them together**.
 * It does, because it is a range read that sums every row it sees rather than a
 * per-(day, agent) lookup — the same loop that already summed across agents
 * sums across machines for free.
 *
 * That is worth writing down precisely because nothing here looks like it is
 * doing it. A future edit that replaces the range read with a keyed lookup, or
 * that adds a `.unique()` anywhere, would compile, pass on a one-laptop
 * deployment, and under-report the site's real numbers by whatever the other
 * computers did — which is the same bug the key change fixed, wearing a hat.
 * `machine` is deliberately not read below: nothing in the Snapshot is grouped
 * by it, and nothing public may be.
 *
 * ── Full-table read ────────────────────────────────────────────────────────
 *
 * Two agents × 365 days × a couple of computers is ~1,500 rows a year, which
 * schema.ts explicitly designs for: "Every fold below is a full-table read
 * summed in memory, which at that scale is correct and cheap." The range read
 * below is narrower still.
 */
async function foldAiUsage(ctx: QueryCtx, windowStart: string): Promise<AiUsageFold> {
  // `by_day_agent_machine` is usable from its `day` prefix, which is why
  // schema.ts does not carry a separate `by_day`. The same index and the same
  // window as `recordAiUsage`'s own recompute — the two writers of
  // `projects.aiBuildStats` must not disagree; see `aiStatsWindowStart` there.
  const rows = await ctx.db
    .query('aiUsageDays')
    .withIndex('by_day_agent_machine', (q) => q.gte('day', windowStart))
    .collect();

  let totalSessions = 0;
  let totalHours = 0;

  const byAgent = new Map<Doc<'aiUsageDays'>['agent'], number>();
  const byProject = new Map<string, { sessions: number; hours: number }>();

  for (const row of rows) {
    totalSessions += row.sessions;
    totalHours += row.hours;
    byAgent.set(row.agent, (byAgent.get(row.agent) ?? 0) + row.sessions);

    for (const slice of row.projects) {
      const running = byProject.get(slice.projectSlug) ?? { sessions: 0, hours: 0 };
      running.sessions += slice.sessions;
      running.hours += slice.hours;
      byProject.set(slice.projectSlug, running);
    }
  }

  // Resolve slugs to titles through `projects`, and DROP anything that does not
  // resolve to a *published* one. Two separate reasons, both about what ends up
  // rendered on a public homepage:
  //
  //   • An unresolved slug is — by the Collector's own design — the closest
  //     thing to a repository directory name that could ever reach this field.
  //     ADR 008 says it does not get printed on the strength of a mapping
  //     nobody has made yet.
  //   • An unpublished project is a draft. `projects.list` hides drafts from
  //     every other public read, and `topProjects` must not be the one place a
  //     client's name appears before the case study is signed off (ADR 009).
  //
  // `byProject` still carries both, because `aiBuildStats` is written onto the
  // row itself and is only as public as the row is.
  const named: Array<{ name: string; sessions: number }> = [];
  for (const [slug, totals] of byProject) {
    const project = await ctx.db
      .query('projects')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .first();
    if (project === null || !project.published) continue;
    named.push({ name: project.title, sessions: totals.sessions });
  }

  named.sort((a, b) => b.sessions - a.sessions);

  return {
    totalSessions,
    // Whole hours. `AiSignal` prints this as a headline readout and derives an
    // average session length in minutes from it, so a stored 1210.4166666 would
    // render as noise without changing a single derived figure.
    totalHours: Math.round(totalHours),
    // Ordered by the label map rather than by usage, so the two bars in the
    // agent split do not swap places between rebuilds.
    agents: (Object.keys(AGENT_LABELS) as Array<Doc<'aiUsageDays'>['agent']>)
      .filter((agent) => byAgent.has(agent))
      .map((agent) => ({ name: AGENT_LABELS[agent], sessions: byAgent.get(agent) ?? 0 })),
    topProjects: named.slice(0, MAX_TOP_PROJECTS),
    byProject,
    rowsRead: rows.length,
  };
}

type HealthFold = Doc<'snapshot'>['healthStats'];

/**
 * `healthDays` → `snapshot.healthStats`, or `null`.
 *
 * `null` is the expected state for the whole of phases 4–6: the table lands with
 * the ingest route and the phone that fills it is phase 7. `snapshot.healthStats`
 * is nullable precisely so Off the Clock omits its movement card rather than
 * rendering a day of zero steps, so this returning `null` is the pipeline
 * working.
 *
 * `syncedAt` is the newest `ingestedAt` in the table — "the last time the phone
 * *spoke*" — and is deliberately not the newest day's timestamp: a phone that
 * has been offline since Tuesday and then backfills Tuesday should move
 * `syncedAt` to now, so the UI can say "nothing since Tuesday" instead of
 * implying Tuesday had no steps.
 */
async function foldHealth(
  ctx: QueryCtx,
): Promise<{ stats: HealthFold; rowsRead: number }> {
  const rows = await ctx.db
    .query('healthDays')
    .withIndex('by_day')
    .order('desc')
    .collect();

  if (rows.length === 0) return { stats: null, rowsRead: 0 };

  const latest = rows[0];
  const windowStart = isoDay(dayMs(latest.day) - (HEALTH_WINDOW_DAYS - 1) * DAY_MS);

  // Oldest first, as `recentDays` documents ("for a sparkline").
  const recent = rows.filter((row) => row.day >= windowStart).reverse();

  const project = (row: Doc<'healthDays'>) => ({
    // `day` on the raw row, `date` on the projection. The rename happens here,
    // once, and schema.ts documents both ends of it.
    date: row.day,
    steps: row.steps,
    distanceKm: row.distanceKm,
    // Old rows from the steps-only iPhone build remain readable during the
    // rollout. Every new push writes an explicit array, including `[]`.
    activities: row.activities ?? [],
  });

  let syncedAt = rows[0].ingestedAt;
  for (const row of rows) {
    if (row.ingestedAt > syncedAt) syncedAt = row.ingestedAt;
  }

  return {
    stats: {
      latestDay: project(latest),
      // The mean over the days actually reported, not over seven — dividing by
      // seven when the phone has posted three days would report a "typical day"
      // that is 57% short and would look like the walking stopped.
      sevenDayAverageSteps: Math.round(
        recent.reduce((sum, row) => sum + row.steps, 0) / recent.length,
      ),
      recentDays: recent.map(project),
      syncedAt,
    },
    rowsRead: rows.length,
  };
}

/* ------------------------------------------------------------------ *
 * The build
 * ------------------------------------------------------------------ */

/**
 * Assemble and write the Snapshot. The one write in the whole pipeline.
 *
 * Called by `gitStats.rebuild` with the GitHub half already fetched, because an
 * action cannot write and a mutation cannot `fetch`. Everything else is read
 * from the database here.
 *
 * @param gitStats - freshly fetched, already reshaped. Written verbatim.
 * @param labStats - per-Lab GitHub numbers, keyed by slug. Labs absent from this
 *   list are left alone; see `applyLabStats` below.
 *
 * @returns a summary for the operator and for the action's own return value.
 *   Counts and slugs only.
 */
export const apply = internalMutation({
  args: {
    gitStats: gitStatsPayload,
    labStats: v.array(labStatPayload),
  },
  handler: async (ctx, args): Promise<SnapshotBuildSummary> => {
    const computedAt = nowIso();

    /* ---- identity ------------------------------------------------- *
     * `siteSettings` is the source of truth and `snapshot.identity` is
     * the denormalised copy that keeps the homepage at one document
     * read. The previous Snapshot is the fallback purely so a rebuild
     * on a deployment whose settings row has not been created yet
     * refreshes the numbers instead of failing; with neither, there is
     * no honest row to write and the mutation says so. */
    const settings = await ctx.db.query('siteSettings').order('desc').first();
    const existing = await ctx.db.query('snapshot').order('desc').first();
    const identity = settings?.identity ?? existing?.identity;

    if (identity === undefined) {
      throw new ConvexError({
        code: 'precondition-failed',
        message:
          'Cannot build a Snapshot: there is no siteSettings row and no previous Snapshot to take `identity` from. Run `siteSettings.upsert` (or the seed) first.',
      });
    }

    /* ---- the AI fold's window ------------------------------------- *
     * The first day of the grid that was just fetched — see foldAiUsage
     * for why the two windows must be the same one. An empty calendar
     * (a deployment with no PAT, a GitHub outage that still returned a
     * shell) falls back to a trailing year so the fold is never
     * accidentally unbounded. */
    const firstDay = args.gitStats.calendar[0]?.[0]?.date;
    const windowStart =
      firstDay ?? isoDay(Date.parse(computedAt) - 365 * DAY_MS);

    const ai = await foldAiUsage(ctx, windowStart);
    const health = await foldHealth(ctx);

    /* ---- the newest Fun Entry ------------------------------------- *
     * Copied whole, minus the system fields. Destructured rather than
     * rebuilt field by field so a new column on `funEntries` reaches
     * the Snapshot without an edit here — `snapshot.latestFunEntry`
     * mirrors `funEntryFields` exactly, and schema.ts shares one
     * definition between them precisely so they cannot drift. */
    const newestFun = await ctx.db
      .query('funEntries')
      .withIndex('by_occurredAt')
      .order('desc')
      .first();

    let latestFunEntry: Doc<'snapshot'>['latestFunEntry'] = null;
    if (newestFun !== null) {
      const { _id, _creationTime, ...entry } = newestFun;
      latestFunEntry = entry;
    }

    /* ---- write ---------------------------------------------------- *
     * `replace`, not `patch`: this row is wholly derived, so a field
     * that the current build did not produce is a field that should not
     * survive into it. Patching would let a value written by an older
     * version of this pipeline live on invisibly. */
    const row = {
      identity,
      gitStats: args.gitStats,
      aiUsage: {
        totalSessions: ai.totalSessions,
        totalHours: ai.totalHours,
        agents: ai.agents,
        topProjects: ai.topProjects,
      },
      healthStats: health.stats,
      latestFunEntry,
      computedAt,
    };

    if (existing !== null) {
      await ctx.db.replace(existing._id, row);

      // `snapshot` is a singleton enforced by its writers, and this is the only
      // writer. `snapshot.get` reads newest-first rather than `.unique()` so a
      // duplicate degrades instead of throwing; collapsing them here means that
      // safety net never has to be used twice.
      const all = await ctx.db.query('snapshot').collect();
      for (const stale of all) {
        if (stale._id !== existing._id) await ctx.db.delete(stale._id);
      }
    } else {
      await ctx.db.insert('snapshot', row);
    }

    /* ---- derived writes on other tables --------------------------- */

    const labsRefreshed = await applyLabStats(ctx, args.labStats, computedAt);
    const projectsScored = await applyProjectAiStats(ctx, ai.byProject);

    return {
      computedAt,
      labsRefreshed,
      projectsScored,
      aiUsage: {
        rowsRead: ai.rowsRead,
        totalSessions: ai.totalSessions,
        totalHours: ai.totalHours,
        agents: ai.agents.length,
        topProjects: ai.topProjects.length,
      },
      healthDays: health.rowsRead,
      latestFunEntry: latestFunEntry === null ? null : latestFunEntry.title,
    };
  },
});

/**
 * Overwrite `labs.liveStats` for the Labs GitHub answered about.
 *
 * schema.ts calls this block "the slice the hourly cron overwrites from the
 * GitHub API. Everything else on the row is hand-written and must survive the
 * refresh", and `labs.ts` adds that from phase 4 onwards **the cron is the
 * owner** — an admin edit to these five numbers survives until the next tick.
 *
 * Two rules that are easy to get wrong and expensive to get wrong:
 *
 *   • **A Lab not in `stats` is not touched.** The action omits a Lab whose repo
 *     404s, was renamed, or turned out to be private. Writing zeroes for those
 *     would replace a curated row's honest numbers with a claim that the project
 *     has no stars and has never been pushed to — a GitHub outage would blank
 *     the whole /labs page, permanently, an hour before anyone noticed.
 *   • **`lastPushDaysAgo` is derived, never fetched.** `lastPushedAt` is the
 *     durable fact and this is the display value computed against *this*
 *     rebuild's `computedAt`, which is the same instant every other relative
 *     figure on the site is measured against. apps/web recomputes it from
 *     `lastPushedAt` anyway (see `mapLab` in `apps/web/src/lib/data.ts`); it is
 *     written here so a client that does not — the iOS app, the PDF — still
 *     gets a number that was right at build time.
 *
 * @returns how many rows were actually written.
 */
async function applyLabStats(
  ctx: MutationCtx,
  stats: Array<{
    slug: string;
    stars: number;
    forks: number;
    commitsYear: number;
    lastPushedAt: string;
  }>,
  computedAt: string,
): Promise<number> {
  let written = 0;

  for (const stat of stats) {
    const lab = await ctx.db
      .query('labs')
      .withIndex('by_slug', (q) => q.eq('slug', stat.slug))
      .first();
    if (lab === null) continue;

    // An empty string means GitHub reported no push timestamp at all (a repo
    // created and never pushed to). Keep whatever the row already had rather
    // than inventing one — and if it had none either, keep its stored
    // `lastPushDaysAgo` rather than claiming the repo was pushed today.
    const lastPushedAt =
      stat.lastPushedAt.length > 0 ? stat.lastPushedAt : lab.liveStats.lastPushedAt;

    const liveStats: Doc<'labs'>['liveStats'] = {
      stars: stat.stars,
      forks: stat.forks,
      commitsYear: stat.commitsYear,
      lastPushDaysAgo:
        lastPushedAt === undefined
          ? lab.liveStats.lastPushDaysAgo
          : daysBetween(lastPushedAt, computedAt),
      syncedAt: computedAt,
    };
    // Assigned rather than spread so an absent value stays an absent key: the
    // field is `v.optional()` in the schema, and `{ lastPushedAt: undefined }`
    // is not the same document as one without the key.
    if (lastPushedAt !== undefined) liveStats.lastPushedAt = lastPushedAt;

    if (labStatsMateriallyEqual(lab.liveStats, liveStats)) {
      continue;
    }

    // `revision` guards human-authored fields. Every editor treats liveStats as
    // collector-owned and omits it from editorial saves, so a GitHub refresh
    // must not manufacture an unrelated content conflict.
    await ctx.db.patch(lab._id, { liveStats });
    written += 1;
  }

  return written;
}

type LabStatsForComparison = Omit<Doc<'labs'>['liveStats'], 'syncedAt'>;

/** Ignore the observation timestamp; a check that found the same facts is no-op. */
export function labStatsMateriallyEqual(
  current: Doc<'labs'>['liveStats'],
  next: Doc<'labs'>['liveStats'],
): boolean {
  const left: LabStatsForComparison = {
    stars: current.stars,
    forks: current.forks,
    commitsYear: current.commitsYear,
    lastPushDaysAgo: current.lastPushDaysAgo,
    ...(current.lastPushedAt === undefined
      ? {}
      : { lastPushedAt: current.lastPushedAt }),
  };
  const right: LabStatsForComparison = {
    stars: next.stars,
    forks: next.forks,
    commitsYear: next.commitsYear,
    lastPushDaysAgo: next.lastPushDaysAgo,
    ...(next.lastPushedAt === undefined ? {} : { lastPushedAt: next.lastPushedAt }),
  };
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Write `projects.aiBuildStats` from the per-project fold (ADR 016).
 *
 * The Snapshot's `topProjects` and a project's `aiBuildStats` are two views of
 * the same numbers, and the web contract makes that a promise: `Project.
 * aiBuildStats` says "where the title also appears in `aiUsage.topProjects`,
 * `sessions` matches that number exactly". They match because both are folded
 * from the same `byProject` map over the same window in the same transaction —
 * not because anything checks afterwards.
 *
 * **A project with no sessions in the window has no `aiBuildStats`.** This field
 * is derived telemetry, not authored content. Preserving an earlier value makes
 * the work ledger disagree with `snapshot.aiUsage` and allows seeded totals to
 * survive forever. An empty fold therefore clears the optional field; the
 * Snapshot's own zero totals already make a stopped Collector visible.
 *
 * `hours` is rounded for the same reason `aiUsage.totalHours` is: it is rendered
 * as a whole number and a stored fraction would only ever be truncated by
 * whoever draws it.
 *
 * @returns how many projects were written.
 */
type ProjectAiBuildStatsValue = { sessions: number; hours: number };

/**
 * Pure reconciliation plan used by the transactional writer below.
 *
 * Exported for the regression test: the important case is a project carrying a
 * previous value while its slug is absent from the current fold. That must
 * produce an explicit `undefined` patch rather than no update.
 */
export function projectAiStatsUpdates<
  T extends { slug: string; aiBuildStats?: ProjectAiBuildStatsValue },
>(
  projects: readonly T[],
  byProject: ReadonlyMap<string, ProjectAiBuildStatsValue>,
): Array<{ project: T; next: ProjectAiBuildStatsValue | undefined }> {
  const updates: Array<{
    project: T;
    next: ProjectAiBuildStatsValue | undefined;
  }> = [];

  for (const project of projects) {
    const totals = byProject.get(project.slug);
    const next =
      totals === undefined || (totals.sessions === 0 && totals.hours === 0)
        ? undefined
        : { sessions: totals.sessions, hours: Math.round(totals.hours) };

    const current = project.aiBuildStats;
    const unchanged =
      current === undefined
        ? next === undefined
        : next !== undefined &&
          current.sessions === next.sessions &&
          current.hours === next.hours;

    if (!unchanged) updates.push({ project, next });
  }

  return updates;
}

async function applyProjectAiStats(
  ctx: MutationCtx,
  byProject: Map<string, { sessions: number; hours: number }>,
): Promise<number> {
  // Scan every project, not only the slugs present in the fold. Absence is the
  // live result for pre-agent or out-of-window work and must remove any stored
  // seed/previous-window value.
  const projects = await ctx.db.query('projects').collect();
  const updates = projectAiStatsUpdates(projects, byProject);

  for (const { project, next } of updates) {
    await ctx.db.patch(project._id, {
      aiBuildStats: next,
    });
  }

  return updates.length;
}
