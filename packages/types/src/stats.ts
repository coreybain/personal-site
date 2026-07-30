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

export const ContributionDaySchema = z.object({
  date: IsoDateSchema,
  count: CountSchema,
  level: ContributionLevelSchema,
  /**
   * Display title of the project that received most of that day's commits;
   * `null` on an inactive day.
   *
   * ADR 008: only named, attributed projects ever appear here. Private repo
   * names must never reach this field — it is rendered in a public tooltip.
   */
  project: NonEmptyStringSchema.nullable(),
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
  publicRepoCount: CountSchema,
  /** Consecutive days with at least one contribution, up to `computedAt`. */
  currentStreakDays: CountSchema,
  calendar: ContributionCalendarSchema,
  languages: z.array(LanguageShareSchema),
});
export type GitStats = z.infer<typeof GitStatsSchema>;

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
 * Only step count and walking/running distance are read (pipeline 3) — the
 * scopes requested from HealthKit are deliberately the two least sensitive
 * metrics that still say something true about the life signal strip.
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
});
export type HealthDay = z.infer<typeof HealthDaySchema>;

/**
 * Movement aggregates for the dashboard's life signal.
 *
 * DIVERGENCE — the plan names `healthStats` on the snapshot but does not list
 * its fields, and apps/web/src/lib/snapshot.ts has no equivalent at all. This
 * shape is inferred from pipeline 3 (`HKObserverQuery` on step count and
 * walking distance, posted as a daily summary) and is the least-committal thing
 * that renders: the latest day, a rolling average for context, and the sync
 * time so the UI can admit when the phone has been offline.
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
