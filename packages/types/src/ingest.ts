/**
 * ingest.ts — `ingestTokens`, the raw day-keyed tables every machine push lands
 * in, and the payload contract for the pushes themselves.
 *
 * Glossary: **Ingest** is authenticated machine-to-server push of data that
 * cannot be pulled — HealthKit from the phone, AI usage from the local collector.
 * Bearer token, never a user session (ADR 006a), because these jobs have no human
 * behind them and each source must be independently revocable.
 *
 * ┌─ what this file defines, in the order the data moves ─────────────────────┐
 * │ 1. `ingestTokens`   who may push (ADR 006a)                               │
 * │ 2. `…IngestSchema`  the wire body, `strictObject`, one per endpoint       │
 * │ 3. `aiUsageDays` /  the stored raw rows: one per day (per agent), the     │
 * │    `healthDays`     landing zone the endpoint upserts into                │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * The cron folds (3) into `snapshot.aiUsage` / `snapshot.healthStats` /
 * `projects.aiBuildStats`. Nothing reads these rows at request time.
 *
 * ── Why raw tables exist at all, rather than pushing straight to the Snapshot ─
 *
 * Because a push is a claim about *a day*, and days get revised. HealthKit
 * restates a step count hours after the fact once the watch syncs; the collector
 * re-reads a session directory that has since grown; a laptop that was shut for a
 * week posts seven days at once. If the endpoint added to a running total, every
 * one of those cases would double-count, and there would be no way to correct a
 * day short of recomputing from a payload that only covers part of the window.
 * Storing the day and upserting it makes a re-send idempotent by construction:
 * the second push for `2026-07-30` *replaces* the first, and the fold — which
 * reads all the rows — always sees exactly one truth per day.
 *
 * That is why every raw row here is keyed by `day` and why the endpoints are
 * described as upserts rather than inserts.
 *
 * ── Every payload schema is a `strictObject` ────────────────────────────────
 *
 * That is a privacy control, not a style choice: the collector's stated guarantee
 * is that only counts, durations and slugs leave the machine — no prompts, no
 * code, no file contents. A strict schema *rejects* an unexpected key at the HTTP
 * boundary instead of silently stripping it, so an accidental `prompt` or `cwd`
 * field fails loudly in tests rather than being quietly dropped in production.
 *
 * The corollary is that nothing free-form may be added to these payloads. There
 * is no `collectorVersion`, no `hostname`, no `notes`: the Verification plan
 * asserts that an AI-usage body contains *only* numeric aggregates and slugs, and
 * that assertion is only checkable while it stays literally true.
 */

import * as z from 'zod';
import {
  CountSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  NonNegativeNumberSchema,
  SlugSchema,
} from './primitives';
import { AiAgentSchema, HealthSourceSchema } from './stats';

/* ------------------------------------------------------------------ *
 * ingestTokens
 * ------------------------------------------------------------------ */

/**
 * What a token is allowed to do. One scope per pipeline, so revoking the phone
 * does not stop the collector.
 *
 * ASSUMPTION — the plan says `scopes[]` without enumerating values. These three
 * are the three machine pipelines described under Pipelines: the local AI-usage
 * collector, the iOS HealthKit push, and the git snapshot job (which runs as a
 * Convex cron today but is given a scope so it can be moved out if the GitHub
 * PAT ever needs to live somewhere other than Convex).
 */
export const IngestScopeSchema = z.enum([
  'ai-usage:write',
  'health:write',
  'git:write',
]);
export type IngestScope = z.infer<typeof IngestScopeSchema>;

export const IngestTokenSchema = z.object({
  /** Human label shown in admin, e.g. `'MacBook collector'`, `'iPhone 16 Pro'`. */
  name: NonEmptyStringSchema,
  /**
   * SHA-256 of the bearer token, hex. The plaintext is shown exactly once at
   * issue and never stored — the admin UI cannot display an existing token, only
   * revoke it and mint a new one.
   */
  hashedToken: NonEmptyStringSchema.regex(
    /^[0-9a-f]{64}$/,
    'Expected a lowercase hex SHA-256 digest',
  ),
  scopes: z.array(IngestScopeSchema).nonempty(),
  /** Last successful authenticated request. `null` if never used. */
  lastUsedAt: IsoDateTimeSchema.nullable(),
  /** Set to revoke. A non-null value must reject every subsequent request. */
  revokedAt: IsoDateTimeSchema.nullable(),
});
export type IngestToken = z.infer<typeof IngestTokenSchema>;

/* ------------------------------------------------------------------ *
 * AI usage — Pipeline 2
 *
 * Producer  `tooling/collector`, a Bun script under launchd, daily.
 * Transport POST /ingest/ai-usage, scope `ai-usage:write`.
 * Stored in `aiUsageDays`, upserted on (`day`, `agent`).
 * Folded by the hourly snapshot cron into `snapshot.aiUsage` and into each
 *           `projects.aiBuildStats` (ADR 016).
 * ------------------------------------------------------------------ */

/**
 * One project's slice of one agent-day: "Codex spent 3.5 h across 4 sessions on
 * `quotecloud` on 2026-07-30".
 *
 * `projectSlug` and nothing else. The collector decodes Claude's path-encoded
 * directory names (shaped `-Users-coreybaines-GitHub-<repo>`) and Codex's
 * `session_meta.cwd` **locally**, maps the repo directory to a project slug via
 * admin config, and discards the path before it builds this object. The absolute
 * path never leaves the machine, and because the payload is strict it could not
 * arrive if it tried.
 *
 * The slug is the join key to `projects.slug` — which is also why an unmapped
 * repo must be dropped by the collector rather than sent under its directory
 * name. A directory name is a private repo name, and ADR 008 says those never
 * reach the server, let alone a public response.
 */
export const AiUsageProjectSchema = z.strictObject({
  projectSlug: SlugSchema,
  sessions: CountSchema,
  hours: NonNegativeNumberSchema,
});
export type AiUsageProject = z.infer<typeof AiUsageProjectSchema>;

/**
 * One agent's whole day, with its per-project breakdown. The unit of both the
 * payload and the stored row.
 *
 * `sessions`/`hours` are the day's totals for that agent and are NOT required to
 * equal the sum over `projects`: a session in a directory with no project
 * mapping counts toward the agent's day (it really happened, and the homepage
 * Signal should say so) but has nowhere to appear in the breakdown. The totals
 * are therefore ≥ the breakdown sum, always, and the fold must use the totals for
 * `snapshot.aiUsage` and the breakdown for `projects.aiBuildStats` rather than
 * deriving one from the other.
 */
export const AiUsageDayIngestSchema = z.strictObject({
  /** The calendar day being reported, UTC. Half the upsert key. */
  day: IsoDateSchema,
  /** The other half. `'claude'` | `'codex'` — an id, not a display name. */
  agent: AiAgentSchema,
  sessions: CountSchema,
  /** Wall-clock hours across those sessions. Fractional. */
  hours: NonNegativeNumberSchema,
  projects: z.array(AiUsageProjectSchema),
});
export type AiUsageDayIngest = z.infer<typeof AiUsageDayIngestSchema>;

/**
 * Body of the daily push from `tooling/collector` (launchd).
 *
 * A list of day/agent rows rather than one window aggregate. The collector may
 * re-send any day it likes — the usual shape is "today plus yesterday", because
 * yesterday's sessions can still be appended to after midnight — and each row
 * replaces its (`day`, `agent`) predecessor outright. A re-run over the same
 * period is therefore a no-op rather than a doubling, which is the property the
 * old window-based body could not offer.
 *
 * There is no window: `days` *is* the window, and it does not have to be
 * contiguous.
 */
export const AiUsageIngestSchema = z.strictObject({
  /** One or more agent-days, oldest first. At least one, or say nothing. */
  days: z.array(AiUsageDayIngestSchema).nonempty(),
  /** When the collector built this payload. Recorded as the rows' `ingestedAt`. */
  postedAt: IsoDateTimeSchema,
});
export type AiUsageIngest = z.infer<typeof AiUsageIngestSchema>;

/**
 * A stored `aiUsageDays` row — the wire shape plus when it was written.
 *
 * Mirrored by the `aiUsageDays` table in packages/convex/convex/schema.ts.
 * Exactly one row exists per (`day`, `agent`); the ingest mutation enforces that
 * by looking the pair up on `by_day_agent` and patching rather than inserting.
 */
export const AiUsageDaySchema = z.object({
  day: IsoDateSchema,
  agent: AiAgentSchema,
  sessions: CountSchema,
  hours: NonNegativeNumberSchema,
  projects: z.array(AiUsageProjectSchema),
  /**
   * When this row was last written — the `postedAt` of the push that produced
   * it. On a revised day this moves; `_creationTime` keeps the first sighting,
   * which is how a "this day changed after the fact" question stays answerable.
   */
  ingestedAt: IsoDateTimeSchema,
});
export type AiUsageDay = z.infer<typeof AiUsageDaySchema>;

/* ------------------------------------------------------------------ *
 * Health — Pipeline 3
 *
 * Producer  the iOS app: `HKObserverQuery` + background delivery on step count
 *           and walking/running distance, with a foreground sync on app open.
 * Transport POST /ingest/health, scope `health:write`.
 * Stored in `healthDays`, upserted on `day`.
 * Folded by the hourly snapshot cron into `snapshot.healthStats`.
 *
 * The phone is a phase 7 deliverable and the route lands in phase 4, so this
 * table will sit empty for a while. That is deliberate: `snapshot.healthStats` is
 * nullable precisely so the life signal strip degrades to the Fun Entry alone
 * rather than rendering zeroes, and an empty table exercises that path.
 * ------------------------------------------------------------------ */

/**
 * One day of movement as the phone reports it.
 *
 * Steps and distance only. These are the two least sensitive HealthKit metrics
 * that still say something true about the life signal, and the iOS app requests
 * read scopes for nothing else — a schema that cannot express heart rate is a
 * stronger guarantee than a policy that says we won't ask for it.
 */
export const HealthDayIngestSchema = z.strictObject({
  /** The calendar day being reported, UTC. The upsert key. */
  day: IsoDateSchema,
  steps: CountSchema,
  distanceKm: NonNegativeNumberSchema,
});
export type HealthDayIngest = z.infer<typeof HealthDayIngestSchema>;

/**
 * Body of the HealthKit push from the iOS app.
 *
 * Days may be re-sent and routinely are — HealthKit revises a step count once the
 * watch syncs, and today's row is re-posted every time background delivery fires
 * — so the handler upserts by `day` rather than appending.
 */
export const HealthIngestSchema = z.strictObject({
  /** One or more daily summaries, oldest first. Steps and distance only. */
  days: z.array(HealthDayIngestSchema).nonempty(),
  /**
   * Who measured these. One value for the whole push, because one push comes
   * from one place: the phone always sends `healthkit`, and `manual` is for a
   * backfill. Stored per row so a mixed history stays legible.
   */
  source: HealthSourceSchema,
  /** When the phone built this payload. */
  postedAt: IsoDateTimeSchema,
});
export type HealthIngest = z.infer<typeof HealthIngestSchema>;

/**
 * A stored `healthDays` row — one day, whoever measured it, whenever it arrived.
 *
 * Mirrored by the `healthDays` table in packages/convex/convex/schema.ts. The
 * Snapshot's `HealthDay` projection (stats.ts) is this row minus `source` and
 * `ingestedAt`, with `day` rendered as `date`; see that schema for why the two
 * spellings differ.
 *
 * The key is `day` alone, not (`day`, `source`): a day has one step count, and a
 * `manual` correction is meant to overwrite the `healthkit` figure rather than
 * sit beside it and force every reader to decide which one wins.
 */
export const HealthDaySummarySchema = z.object({
  day: IsoDateSchema,
  steps: CountSchema,
  distanceKm: NonNegativeNumberSchema,
  source: HealthSourceSchema,
  /**
   * When this row was last written. The newest value across the table becomes
   * `healthStats.syncedAt` — the last time the phone *spoke*, which is what lets
   * the UI say "no data since Tuesday" instead of implying Tuesday had no steps.
   */
  ingestedAt: IsoDateTimeSchema,
});
export type HealthDaySummary = z.infer<typeof HealthDaySummarySchema>;

/* ------------------------------------------------------------------ *
 * Responses
 * ------------------------------------------------------------------ */

/**
 * What the ingest endpoints return.
 *
 * ⚠️ **This section was rewritten in phase 4 to match the endpoints as built.**
 * It previously declared a single `IngestResultSchema` of
 * `{ ok, accepted, snapshotRebuilt }`, and neither route ever returned those
 * fields. The collector had coded against the contract and was consequently
 * logging `accepted=? snapshotRebuilt=?` after every successful push — a live
 * pipeline reporting nothing about what it had just done. Nothing caught the
 * divergence because `packages/convex` deliberately does not import this
 * package (it is bundled into Convex's runtime — see the header of
 * `convex/lib/validate.ts`), so the contract is enforced by convention and
 * review rather than by the compiler.
 *
 * Reality won rather than the older declaration, for two reasons. The counts the
 * routes actually return are strictly more informative than `accepted` — which
 * of created/updated is which is exactly what an operator wants to know after a
 * re-run — and `snapshotRefold` distinguishes *scheduled* from *unavailable*,
 * which a boolean cannot, and which is the only signal that the ingest→snapshot
 * seam is connected at all.
 *
 * The original rationale still binds, and still holds: **a response is state
 * disclosed to a token holder**, so these stay counts and labels. In particular
 * `unmappedProjects` is a *number*, never the slugs — a slug that matches no
 * project is a repo directory name that got as far as the server, and ADR 008
 * says those are never echoed to anyone.
 *
 * The two routes return different shapes because they are different pipelines,
 * so there are two schemas. Both remain `strictObject`.
 */
export const AiUsageIngestResultSchema = z.strictObject({
  ok: z.literal(true),
  /** The token's own label, echoed for the launchd log. Never the token. */
  token: NonEmptyStringSchema,
  /** `aiUsageDays` rows inserted by this push. */
  daysCreated: CountSchema,
  /** `aiUsageDays` rows replaced by this push — the normal case on a re-run. */
  daysUpdated: CountSchema,
  /** Case studies whose `aiBuildStats` changed (ADR 016). */
  projectsUpdated: CountSchema,
  /** Case studies whose usage was revised away entirely. Almost always 0. */
  projectsCleared: CountSchema,
  /** How many slugs matched no `projects` row. A count, never the names. */
  unmappedProjects: CountSchema,
  /**
   * Whether the push managed to ask for a Snapshot rebuild. `'unavailable'` is
   * not a failure — the row is written either way and the hourly cron will fold
   * it — but it does mean the homepage will lag until that cron runs.
   */
  snapshotRefold: z.enum(['scheduled', 'unavailable']),
});
export type AiUsageIngestResult = z.infer<typeof AiUsageIngestResultSchema>;

export const HealthIngestResultSchema = z.strictObject({
  ok: z.literal(true),
  /** The token's own label, echoed for the phone's log. Never the token. */
  token: NonEmptyStringSchema,
  /** `healthDays` rows inserted by this push. */
  daysCreated: CountSchema,
  /** `healthDays` rows replaced — the common case; HealthKit revises today. */
  daysUpdated: CountSchema,
  /** Newest day in this push, echoed so the phone can confirm what landed. */
  latestDay: IsoDateSchema,
});
export type HealthIngestResult = z.infer<typeof HealthIngestResultSchema>;

/**
 * What every ingest *failure* returns, from either route.
 *
 * `unauthorized` and `forbidden` are deliberately indistinguishable from one
 * another's causes: an unknown token and a revoked token both produce
 * `unauthorized`, so possession of a revoked token cannot be used to probe which
 * tokens ever existed.
 */
export const IngestErrorSchema = z.strictObject({
  ok: z.literal(false),
  error: z.strictObject({
    code: z.enum([
      'unauthorized',
      'forbidden',
      'malformed-body',
      'payload-too-large',
    ]),
    /** Which field was wrong, when the route can say. Absent otherwise. */
    field: z.string().optional(),
    message: NonEmptyStringSchema,
  }),
});
export type IngestError = z.infer<typeof IngestErrorSchema>;
