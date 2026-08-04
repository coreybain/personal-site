/**
 * snapshot.ts — the `snapshot` singleton, and the view of it the web app reads.
 *
 * Glossary: a **Snapshot** is one denormalised Convex row holding every
 * precomputed dashboard statistic. The homepage reads exactly one document
 * (ADR 004, and a stated performance gate: "Homepage server work — 1 Convex
 * document read"). It is rebuilt on a schedule, never on request. Nothing on the
 * dashboard may call GitHub, OpenAI or Apple at request time.
 *
 * Two schemas live here and the distinction matters:
 *
 *   SnapshotSchema      The stored row. Exactly the plan's data model:
 *                       gitStats, aiUsage, healthStats, latestFunEntry,
 *                       computedAt — plus the denormalised `identity` block
 *                       (see settings.ts for why).
 *
 *   SnapshotViewSchema  The *kind* of object apps/web/src/lib/snapshot.ts
 *                       exports: the row plus the content collections the
 *                       public site needs, resolved in the same load.
 *
 * ⚠️ `SnapshotViewSchema.parse(snapshot)` on the current mock FAILS, and is
 * meant to. The view matches the mock's shape category — same keys, same
 * collections — but individual fields are the documented superset, so the mock
 * is missing several of them: `funEntries` have no `photo` or `occurredAt`,
 * `projects` have no `attribution` / `media` / `links` / `published` /
 * `featured` / `sortOrder`, and `labs` have no `links` or `coverImage`. Each gap
 * is marked `DIVERGENCE` at the field that has it. This schema is therefore
 * aspirational until the mock grows those fields (or is replaced by the Convex
 * query), and it is not a drift test today — wiring it up as one means fixing
 * the mock first, not the schema.
 *
 * DIVERGENCE — the plan's `snapshot` does not embed collections; the implemented
 * mock does, because a mock has nowhere else to put them. When Convex lands, the
 * page loader assembles the view from the singleton plus the small published
 * queries. The extra reads are per-page, not per-Signal, so the one-read budget
 * for the dashboard's live data still holds.
 */

import * as z from 'zod';
import { IsoDateTimeSchema } from './primitives';
import { AiUsageSchema, GitStatsSchema, HealthStatsSchema } from './stats';
import {
  BeerEntrySchema,
  CoffeeEntrySchema,
  FunEntrySchema,
  LabSchema,
  ProjectSchema,
  WalkEntrySchema,
} from './content';
import { ResumeDocumentSchema } from './resume';
import { IdentitySchema } from './settings';

/* ------------------------------------------------------------------ *
 * The stored row
 * ------------------------------------------------------------------ */

export const SnapshotSchema = z.object({
  /**
   * Denormalised copy of `siteSettings.identity`, so the hero renders from the
   * same single read as the Signals.
   */
  identity: IdentitySchema,

  gitStats: GitStatsSchema,
  aiUsage: AiUsageSchema,

  /**
   * `null` until the iOS app has posted at least once — the health pipeline
   * depends on a phone that may not have shipped yet (phase 7). The life signal
   * strip must degrade to the Fun Entry alone rather than render zeroes.
   */
  healthStats: HealthStatsSchema.nullable(),

  /**
   * The newest Fun Entry of any kind, for the dashboard's life signal strip.
   * `null` before the first entry exists.
   */
  latestFunEntry: FunEntrySchema.nullable(),

  /**
   * When this row was recomputed. Every relative figure on the site — streaks,
   * `lastPushDaysAgo`, "2 days ago" — is relative to this instant and to nothing
   * else, so a stalled cron produces stale-but-consistent output rather than a
   * page that contradicts itself.
   */
  computedAt: IsoDateTimeSchema,
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

/* ------------------------------------------------------------------ *
 * The view the web app consumes
 * ------------------------------------------------------------------ */

/**
 * The three Fun Entry kinds used by the homepage's compact LifeStrip. Convex
 * stores one four-kind table (`FunEntrySchema`); the complete `/fun` page reads
 * `funLog`, while this narrowing exists only at the view boundary.
 */
export const SnapshotFunEntrySchema = z.discriminatedUnion('type', [
  BeerEntrySchema,
  CoffeeEntrySchema,
  WalkEntrySchema,
]);
export type SnapshotFunEntry = z.infer<typeof SnapshotFunEntrySchema>;

export const SnapshotViewSchema = SnapshotSchema.extend({
  /** Published case studies, in `sortOrder`. */
  projects: z.array(ProjectSchema),
  /** Published Labs, in `sortOrder`. */
  labs: z.array(LabSchema),
  resumeDocument: ResumeDocumentSchema,
  /** Compact homepage feed. See `SnapshotFunEntrySchema`. */
  funEntries: z.array(SnapshotFunEntrySchema),
  /** The whole off-the-clock feed, newest first. Superset of `funEntries`. */
  funLog: z.array(FunEntrySchema),
});
export type SnapshotView = z.infer<typeof SnapshotViewSchema>;
