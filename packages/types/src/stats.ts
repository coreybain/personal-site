/**
 * stats.ts — the measured numbers. Every Signal on the dashboard resolves from
 * something in this file.
 *
 * Three producers write these shapes and none of them is the web app:
 *   - `gitStats`     ← Convex cron, hourly, GitHub GraphQL `contributionsCollection`
 *   - `aiUsage`      ← the local collector (launchd, daily) via `/ingest/ai-usage`
 *   - `healthStats`  ← the iOS app via `/ingest/health`
 *
 * They are all denormalised onto the singleton `snapshot` row so the homepage
 * costs exactly one document read. See snapshot.ts.
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

/** Sessions attributed to one agent, e.g. `Claude Code`, `Codex`. */
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
 * A single day of movement, as HealthKit reports it.
 *
 * Only step count and walking/running distance are read (pipeline 3) — the
 * scopes requested from HealthKit are deliberately the two least sensitive
 * metrics that still say something true about the life signal strip.
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
