/**
 * stats.ts — the measured numbers. Every Signal on the dashboard resolves from
 * something in this file.
 *
 * Three producers write these shapes and none of them is the web app:
 *   - `gitStats`     ← Convex cron, hourly, GitHub GraphQL `contributionsCollection`
 *   - `aiUsage`      ← folded from the `aiUsageDays` rows the local collector
 *                      (launchd, daily) pushes to `/ingest/ai-usage`
 *   - `healthStats`  ← folded from the `healthDays` rows the iOS app pushes to
 *                      `/ingest/health`
 *
 * They are all denormalised onto the singleton `snapshot` row so the homepage
 * costs exactly one document read. See snapshot.ts.
 *
 * Note the two-step for the pushed pipelines. A machine push lands in a raw,
 * day-keyed table (`aiUsageDays`, `healthDays` — both in ingest.ts) and the cron
 * folds those rows into the aggregates below. The raw tables exist because a
 * push is a *fact about a day* that may be revised — HealthKit restates step
 * counts hours later, and the collector re-reads a session directory that grew —
 * so the ingest endpoint has to be able to overwrite one day without recomputing
 * the whole aggregate from a payload that only covers part of the window.
 *
 * DIVERGENCE — `healthStats` is in the plan's data model but does not exist yet
 * in apps/web/src/lib/snapshot.ts. It is modelled here (the superset) and the
 * web mock has to grow the field when phase 3 wires the dashboard.
 */

import * as z from 'zod';
import {
  CountSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  NonNegativeNumberSchema,
  PercentageSchema,
} from './primitives';

/* ------------------------------------------------------------------ *
 * Contribution calendar
 * ------------------------------------------------------------------ */

/**
 * GitHub's five-step intensity bucket, 0 (nothing) to 4 (busiest).
 *
 * Derived from `count`, never stored independently of it — the producer owns the
 * thresholds so every renderer agrees on the colour ramp.
 */
export const ContributionLevelSchema = z.literal([0, 1, 2, 3, 4]);
export type ContributionLevel = z.infer<typeof ContributionLevelSchema>;

/**
 * The neutral bucket. Commits the producer will not name go here, under this
 * exact string.
 *
 * There are two populations it absorbs and they are absorbed for different
 * reasons, which is precisely why one honest label serves both:
 *
 *   - **Private work with no mapping.** A private repository is only nameable
 *     at all because an operator wrote a `gitRepoMap` row for it by hand
 *     (`GitRepoMapEntrySchema`, below). Absent that row there is no sanctioned
 *     display name, and ADR 008 forbids inventing one from the repo identifier.
 *   - **Public but uncurated repositories.** ADR 014's own examples — `dddddd`,
 *     `test`, 2016 coursework. They are absent from /labs for a reason and the
 *     heatmap tooltip is not a back door onto that list.
 *
 * Both are real commits and both are counted in `ContributionDay.count`
 * already, so hiding them would understate the day. Naming the bucket rather
 * than dropping the rows is what lets the popup add up.
 *
 * ⚠️ This string is *rendered in a public tooltip*. It is a bucket label, never
 * a fallback for "I could not resolve the name" — a producer that finds itself
 * wanting to put a repository name here has a bug, not a naming problem.
 *
 * Spelled once here. `packages/convex` cannot import this package (it is
 * bundled into Convex's own runtime — see the header of
 * `convex/lib/validate.ts`) and `apps/web/src/lib/snapshot.ts` keeps itself
 * import-free by doctrine, so both re-declare the literal with a comment
 * pointing back at this constant. Three copies, one owner.
 */
export const OTHER_WORK_LABEL = 'Other work';

/**
 * One project's slice of one day's commits: `QuoteCloud · 5 commits`.
 *
 * ⚠️ `name` is a **display name and nothing else** — a case-study title
 * (`'QuoteCloud'`), a Lab title (`'statline'`), or `OTHER_WORK_LABEL`. It is
 * never a repository identifier, public or private: not `pricing-portal-v2`, not
 * `coreybain/boca`, not an owner/name pair of any kind. ADR 008 is the rule and
 * this field is the surface it is most easily broken on, because unlike
 * `privateContributions` (a number) this one is a string the producer chooses.
 *
 * The mapping from repository to display name is `gitRepoMap`, which is server
 * side, has no public query, and is seeded from a machine-local file. A repo
 * with no entry does not get named — it folds into `OTHER_WORK_LABEL`.
 */
export const ContributionProjectSchema = z.object({
  /** Display name. See the warning above. */
  name: NonEmptyStringSchema,
  /** Commits attributed to that name on that day. Always ≥ 1 — see below. */
  commits: CountSchema.positive(),
});
export type ContributionProject = z.infer<typeof ContributionProjectSchema>;

export const ContributionDaySchema = z.object({
  date: IsoDateSchema,
  count: CountSchema,
  level: ContributionLevelSchema,
  /**
   * The day's **top** project by commit count, or `null`.
   *
   * Kept — and kept first-class — because it predates `byProject` and is read
   * by consumers that will never grow a popup: the eight archived variants
   * under `apps/web/src/app/v/*`, and anything else that wants one word rather
   * than a breakdown. It is a *summary of* `byProject`, not an independent
   * fact, and the rule tying the two together is exact:
   *
   *     project ∈ { byProject[0].name, null }
   *
   * i.e. it is the name of the highest-commit entry, or `null`. Never a name
   * that is absent from `byProject`, and never non-null when `byProject` is
   * empty. A producer MAY be stricter and null it out while `byProject` is
   * populated — `gitStats.ts` does exactly that via `ATTRIBUTION_MAJORITY`,
   * refusing to label a day whose leader accounts for a minority of it — which
   * is why this is a membership rule rather than a plain equality.
   *
   * Renderers wanting "which projects, how many each" must read `byProject`.
   * This field cannot answer that and never could.
   *
   * ADR 008: only named, attributed projects ever appear here. Private repo
   * names must never reach this field — it is rendered in a public tooltip.
   */
  project: NonEmptyStringSchema.nullable(),
  /**
   * Per-project commit counts for that day — what the heatmap's day popup
   * lists.
   *
   * Invariants, all of them the producer's job (this file does not `.refine()`
   * them, for the same reason `LanguageShareSchema` does not check that the
   * shares sum to 100 — see below):
   *
   *   - `count === 0` ⇒ `byProject` is `[]` and `project` is `null`.
   *   - Non-empty ⇒ `count > 0`.
   *   - Sorted by `commits` descending; ties broken by `name` ascending, so the
   *     order is total and two runs of the same producer agree.
   *   - `name` is unique within the array. Two rows for `QuoteCloud` is a fold
   *     that was not folded.
   *   - Every `commits` is ≥ 1. A zero-commit entry is a name leaked for no
   *     reason; drop the entry instead.
   *   - `sum(commits) ≤ count`, and the gap is left unexplained rather than
   *     papered over. `count` is GitHub's *contribution* count (commits, but
   *     also PRs, reviews and issues), while these are commits; per-repo day
   *     pages can also be truncated. A producer must never invent commits to
   *     close the gap — `OTHER_WORK_LABEL` carries real commits it declines to
   *     name, not a remainder.
   *
   * An **empty array on an active day is legitimate** and means "this day
   * happened, attribution could not speak for it" — the popup shows the count
   * and no breakdown. It does not mean the day was idle.
   */
  byProject: z.array(ContributionProjectSchema),
});
export type ContributionDay = z.infer<typeof ContributionDaySchema>;

/** One column of the heatmap: seven days, Sunday → Saturday. Always seven. */
export const ContributionWeekSchema = z.array(ContributionDaySchema).length(7);
export type ContributionWeek = z.infer<typeof ContributionWeekSchema>;

/**
 * The trailing-year grid, oldest week first. 52 columns in practice — not
 * constrained here, because a 53-week ISO year is a real thing and the renderer
 * lays out from `.length` rather than a constant.
 */
export const ContributionCalendarSchema = z.array(ContributionWeekSchema);
export type ContributionCalendar = z.infer<typeof ContributionCalendarSchema>;

/* ------------------------------------------------------------------ *
 * Git
 * ------------------------------------------------------------------ */

/**
 * One language's share of tracked code. The set is expected to sum to 100 with
 * an `Other` bucket absorbing the tail; that invariant is the producer's job,
 * not a `.refine()` here, because rounding would make it flaky.
 */
export const LanguageShareSchema = z.object({
  name: NonEmptyStringSchema,
  pct: PercentageSchema,
});
export type LanguageShare = z.infer<typeof LanguageShareSchema>;

/**
 * Aggregate git activity for the trailing 12 months.
 *
 * ADR 008: aggregates plus named CI projects. `totalContributionsYear` is the
 * headline (6,434) and it is only available because the cron authenticates with
 * Corey's own PAT — private contributions are invisible to any other token.
 * `privateContributions` is published as a *number* and never as repo names.
 */
export const GitStatsSchema = z.object({
  /** Public + private. The number the hero quotes. */
  totalContributionsYear: CountSchema,
  /** The private/restricted slice of the above. Count only, never named. */
  privateContributions: CountSchema,
  publicCommits: CountSchema,
  /** Public repositories with contribution activity in the trailing window. */
  publicRepoCount: CountSchema,
  /** Every public repository owned by the account, including forks. */
  totalPublicRepoCount: CountSchema,
  /** Consecutive days with at least one contribution, up to `computedAt`. */
  currentStreakDays: CountSchema,
  calendar: ContributionCalendarSchema,
  languages: z.array(LanguageShareSchema),
});
export type GitStats = z.infer<typeof GitStatsSchema>;

/* ------------------------------------------------------------------ *
 * Attribution mapping — the private half of ADR 008
 *
 * `gitRepoMap` is the table that lets a *private* repository contribute a
 * *public* name to the heatmap popup without the repository ever being named.
 * It is the only place in the model where a private repo identifier is stored
 * at all, and the rules around it are load-bearing:
 *
 *   • NO PUBLIC QUERY. Not a filtered one, not a redacted one, not "just the
 *     display names". No function in `packages/convex` may return a row, a
 *     field of a row, or the row count. The git cron reads it internally and
 *     emits display names; that is the only egress.
 *   • Seeded from a machine-local, gitignored file — the same pattern as
 *     `tooling/collector`'s config. The mapping is Corey's private knowledge
 *     about his own repositories and does not belong in version control.
 *   • Nothing is inferred. A repository with no row is not named. There is no
 *     heuristic that turns `pricing-portal-v2` into `QuoteCloud`, because a
 *     heuristic that guesses right nine times out of ten leaks on the tenth.
 *
 * Both halves of ADR 008 hold at once as a result: aggregates over private work
 * stay published (`privateContributions`, and now a *labelled* commit count),
 * while private repository names stay off the wire entirely.
 * ------------------------------------------------------------------ */

/**
 * What a mapped repository *is*, which decides where its display name comes
 * from and whether it is used at all.
 *
 *   `project`  A sanctioned case study — QuoteCloud, TravelDocs, ZeroRisk,
 *              SoldOnline. Published, attributed work (ADR 008), so the popup
 *              may say `QuoteCloud · 5 commits`. `displayName` should match the
 *              `projects` row's `title` exactly, or the site says two names for
 *              one thing.
 *   `lab`      A curated Lab (ADR 014). Mostly redundant — a public Lab is
 *              already attributable through its own public `repoFullName` — and
 *              exists for the private repo that a Lab is *built from*, and as
 *              the manual override when the allowlist join is not enough.
 *   `ignore`   Fold into `OTHER_WORK_LABEL`, silently. The explicit form of
 *              "I have looked at this repo and decided it stays unsurfaced"
 *              (ADR 014's junk repos), as distinct from a repo nobody has
 *              triaged yet — which behaves identically today, on purpose, but
 *              is a gap in the mapping rather than a decision recorded in it.
 */
export const GitRepoKindSchema = z.enum(['project', 'lab', 'ignore']);
export type GitRepoKind = z.infer<typeof GitRepoKindSchema>;

/**
 * One repository → one public display name. Mirrors the `gitRepoMap` table.
 *
 * ⚠️ A row of this shape contains a private repository name. It is the one
 * document in the model that does, and it may never be returned by a query,
 * logged, echoed in an ingest response, or embedded in the Snapshot. Read the
 * section header above before touching anything that reads this table.
 */
export const GitRepoMapEntrySchema = z.object({
  /**
   * `owner/name` exactly as GitHub spells it, **lowercased** on the way in.
   * GitHub is case-insensitive about repository names and an operator seeding
   * this by hand will type `CoreyBain/Boca` half the time; the lookup key has
   * to be one of the two spellings, and lowercase is the one the git cron's
   * existing allowlist already uses.
   *
   * Not a `SlugSchema` — a slug forbids the `/`, and this is two segments.
   */
  repoFullName: NonEmptyStringSchema.regex(
    /^[^\s/]+\/[^\s/]+$/,
    'Expected owner/name',
  ),
  /**
   * The public label. A case-study or Lab title — never the repo name, never a
   * derivative of it. Unused when `kind` is `'ignore'`; keep it human ("old
   * scratch repo") so the seed file explains itself.
   */
  displayName: NonEmptyStringSchema,
  kind: GitRepoKindSchema,
});
export type GitRepoMapEntry = z.infer<typeof GitRepoMapEntrySchema>;

/* ------------------------------------------------------------------ *
 * AI usage
 * ------------------------------------------------------------------ */

/**
 * Which agent produced a session. The stable machine identifier — this is what
 * `aiUsageDays.agent` stores, what the collector sends, and what an index is
 * built on. It is deliberately NOT the display string.
 *
 * Two values because there are two agents on the machine and the collector reads
 * exactly two directories: `~/.claude/projects/*` and `~/.codex/sessions`
 * (Pipeline 2). Adding a third agent means adding it here first — a closed enum
 * makes that a typecheck failure in the collector, the ingest route and the
 * fold, rather than a silently-ignored bucket.
 */
export const AiAgentSchema = z.enum(['claude', 'codex']);
export type AiAgent = z.infer<typeof AiAgentSchema>;

/**
 * Machine id → the product name the dashboard prints.
 *
 * The fold uses this to turn an `aiUsageDays.agent` into `AgentUsage.name`, so
 * "Claude Code" is spelled once in the whole system. Renaming a product is an
 * edit here and nowhere else; renaming the *identifier* would be a migration,
 * which is exactly the distinction this map exists to preserve.
 */
export const AI_AGENT_LABELS = {
  claude: 'Claude Code',
  codex: 'Codex',
} as const satisfies Record<AiAgent, string>;

/**
 * Sessions attributed to one agent, e.g. `Claude Code`, `Codex`.
 *
 * `name` is the display label from `AI_AGENT_LABELS`, not the `AiAgent` id: this
 * shape is rendered, and apps/web/src/lib/snapshot.ts already reads
 * `agents[].name` as prose. There is no `hours` here on purpose — see the note
 * on `AiUsageSchema`.
 */
export const AgentUsageSchema = z.object({
  name: NonEmptyStringSchema,
  sessions: CountSchema,
});
export type AgentUsage = z.infer<typeof AgentUsageSchema>;

/**
 * Sessions attributed to one project, by display title.
 *
 * Where the title also appears in a project's `aiBuildStats`, the two `sessions`
 * figures are the same number reported twice — one for the dashboard Signal,
 * one for the case study.
 */
export const ProjectUsageSchema = z.object({
  name: NonEmptyStringSchema,
  sessions: CountSchema,
});
export type ProjectUsage = z.infer<typeof ProjectUsageSchema>;

/**
 * Whole-practice agent usage (ADR 016 evidence, dashboard Signal).
 *
 * Everything here is an aggregate. The collector transmits counts and durations
 * only — never a prompt, never a diff, never a file path beyond a repo slug.
 *
 * Folded from `aiUsageDays` by the hourly cron: `totalSessions`/`totalHours` are
 * the sum over the whole table, `agents` groups by `AiUsageDay.agent`, and
 * `topProjects` groups by `AiUsageDayProject.projectSlug` and resolves each slug
 * to the project's display title.
 *
 * Per-agent and per-project *hours* are measured and stored — they are just not
 * carried here. `agents[]` and `topProjects[]` are `{ name, sessions }` because
 * that is the shape apps/web/src/lib/snapshot.ts renders, and the Snapshot holds
 * what the site draws and nothing more (ADR 004: one document read, so every
 * unread byte is paid for on every homepage render). The per-project hours reach
 * the site by a different route — `projects.aiBuildStats` (ADR 016) — and the
 * per-agent hours stay in `aiUsageDays`, queryable by admin, not by the
 * dashboard. Widening this object is a Snapshot change, not a pipeline change.
 */
export const AiUsageSchema = z.object({
  totalSessions: CountSchema,
  totalHours: NonNegativeNumberSchema,
  agents: z.array(AgentUsageSchema),
  /** Highest-usage projects, descending. Trimmed to a display-sized list. */
  topProjects: z.array(ProjectUsageSchema),
});
export type AiUsage = z.infer<typeof AiUsageSchema>;

/**
 * Agent effort spent on one specific thing (ADR 016). Attached to a project row,
 * rendered on its case study.
 */
export const AiBuildStatsSchema = z.object({
  sessions: CountSchema,
  /** Wall-clock hours across those sessions. */
  hours: NonNegativeNumberSchema,
});
export type AiBuildStats = z.infer<typeof AiBuildStatsSchema>;

/* ------------------------------------------------------------------ *
 * Health
 * ------------------------------------------------------------------ */

/**
 * Where a day of movement came from.
 *
 * ASSUMPTION — the plan does not enumerate this. `healthkit` is Pipeline 3
 * proper: `HKObserverQuery` background delivery from the iOS app, which is the
 * only writer that will exist in practice. `manual` exists because the phone is
 * a phase 7 dependency and the ingest route lands in phase 4: a day typed into
 * admin, or backfilled from an export, must be distinguishable from a day the
 * watch actually measured, or the numbers stop being evidence.
 */
export const HealthSourceSchema = z.enum(['healthkit', 'manual']);
export type HealthSource = z.infer<typeof HealthSourceSchema>;

/**
 * A single day of movement, as HealthKit reports it — the *projection* embedded
 * in `HealthStats` on the Snapshot. The stored row is `HealthDaySummarySchema`
 * in ingest.ts, which adds `source` and `ingestedAt`.
 *
 * Step count, walking/running distance and discrete workouts are read. Workout
 * summaries deliberately exclude routes, heart rate, energy and raw samples.
 *
 * The key is `date` here and `day` on the stored row, and the difference is
 * load-bearing rather than sloppy: on the Snapshot this is one field of a dated
 * sample, spelled the way every other dated sample on the Snapshot spells it
 * (`ContributionDay.date`, which apps/web reads by that name); on a raw table it
 * is the row's identity, and naming it `day` makes "one row per day", `by_day`
 * and "upsert by day" read as the same word everywhere. The rename happens once,
 * in the fold, which is already reshaping.
 */
export const HealthDaySchema = z.object({
  date: IsoDateSchema,
  steps: CountSchema,
  distanceKm: NonNegativeNumberSchema,
  /** Discrete workout sessions HealthKit assigned to this local day. */
  activities: z.array(
    z.object({
      /** Stable HealthKit workout UUID, used only to reconcile repeat syncs. */
      id: NonEmptyStringSchema,
      kind: z.enum(['walking', 'running', 'cycling', 'gym', 'other']),
      title: NonEmptyStringSchema,
      startedAt: IsoDateTimeSchema,
      durationMinutes: NonNegativeNumberSchema,
      distanceKm: NonNegativeNumberSchema.optional(),
    }),
  ),
});
export type HealthDay = z.infer<typeof HealthDaySchema>;

/**
 * Movement aggregates for the dashboard's life signal.
 *
 * The plan named `healthStats` without listing its fields. This shape is the
 * implemented pipeline 3 contract (`HKObserverQuery` on daily movement and
 * workouts, posted as a daily summary) and is mirrored by the web Snapshot:
 * the latest day, a rolling average for context, and the sync time so the UI
 * can admit when the phone has been offline instead of implying today had no
 * steps.
 *
 * Folded from `healthDays` by the hourly cron: `latestDay` is the newest row,
 * `recentDays` the trailing seven, `sevenDayAverageSteps` their mean, and
 * `syncedAt` the newest `ingestedAt` — the last time the phone *spoke*, which is
 * not the same as the last day it has data for and is the one the UI needs to
 * tell the truth about a phone that has been off.
 */
export const HealthStatsSchema = z.object({
  /** Most recent day the phone has reported. */
  latestDay: HealthDaySchema,
  /** Trailing-7-day mean step count, for the "typical day" comparison. */
  sevenDayAverageSteps: CountSchema,
  /** Trailing-7-day totals, oldest first, for a sparkline. */
  recentDays: z.array(HealthDaySchema),
  /** When the phone last successfully posted. Stale ⇒ show it, don't fake it. */
  syncedAt: IsoDateTimeSchema,
});
export type HealthStats = z.infer<typeof HealthStatsSchema>;
