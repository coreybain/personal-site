/**
 * ingest.ts — `ingestTokens`, plus the payload contract for every machine push.
 *
 * Glossary: **Ingest** is authenticated machine-to-server push of data that
 * cannot be pulled — HealthKit from the phone, AI usage from the local collector.
 * Bearer token, never a user session (ADR 006a), because these jobs have no human
 * behind them and each source must be independently revocable.
 *
 * Every payload schema here is a `strictObject`. That is a privacy control, not a
 * style choice: the collector's stated guarantee is that only counts, durations
 * and slugs leave the machine — no prompts, no code, no file contents. A strict
 * schema *rejects* an unexpected key at the HTTP boundary instead of silently
 * stripping it, so an accidental `prompt` or `cwd` field fails loudly in tests
 * rather than being quietly dropped in production.
 */

import * as z from 'zod';
import {
  CountSchema,
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  NonNegativeNumberSchema,
  SlugSchema,
} from './primitives';
import { HealthDaySchema } from './stats';

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
 * POST /ingest/ai-usage
 * ------------------------------------------------------------------ */

/** Per-agent aggregate. `name` is an agent product name, e.g. `'Claude Code'`. */
export const AgentUsageIngestSchema = z.strictObject({
  name: NonEmptyStringSchema,
  sessions: CountSchema,
  hours: NonNegativeNumberSchema,
});
export type AgentUsageIngest = z.infer<typeof AgentUsageIngestSchema>;

/**
 * Per-project aggregate.
 *
 * `projectSlug` only — never a filesystem path. The collector decodes Claude's
 * path-encoded directory names and Codex's `session_meta.cwd` locally, maps the
 * repo to a project slug via admin config, and discards the path before it
 * builds this object.
 */
export const ProjectUsageIngestSchema = z.strictObject({
  projectSlug: SlugSchema,
  sessions: CountSchema,
  hours: NonNegativeNumberSchema,
});
export type ProjectUsageIngest = z.infer<typeof ProjectUsageIngestSchema>;

/**
 * Body of the daily push from `tooling/collector` (launchd).
 *
 * Feeds both the dashboard AI Signal (`snapshot.aiUsage`) and each project's
 * `aiBuildStats` (ADR 016). The window is explicit so a re-run is idempotent
 * rather than additive.
 */
export const AiUsageIngestSchema = z.strictObject({
  /** Inclusive start of the aggregation window. */
  windowStart: IsoDateTimeSchema,
  /** Exclusive end. Also the "as at" time shown next to the Signal. */
  windowEnd: IsoDateTimeSchema,
  totalSessions: CountSchema,
  totalHours: NonNegativeNumberSchema,
  agents: z.array(AgentUsageIngestSchema),
  projects: z.array(ProjectUsageIngestSchema),
});
export type AiUsageIngest = z.infer<typeof AiUsageIngestSchema>;

/* ------------------------------------------------------------------ *
 * POST /ingest/health
 * ------------------------------------------------------------------ */

/**
 * Body of the HealthKit push from the iOS app.
 *
 * Sent from `HKObserverQuery` background delivery, with a foreground sync on app
 * open as the fallback. Days may be re-sent — HealthKit revises step counts after
 * the fact — so the handler upserts by `date` rather than appending.
 */
export const HealthIngestSchema = z.strictObject({
  /** One or more daily summaries, oldest first. Steps and distance only. */
  days: z.array(HealthDaySchema).nonempty(),
  /** When the phone built this payload. */
  postedAt: IsoDateTimeSchema,
});
export type HealthIngest = z.infer<typeof HealthIngestSchema>;

/* ------------------------------------------------------------------ *
 * Responses
 * ------------------------------------------------------------------ */

/**
 * What every ingest endpoint returns. Deliberately tiny: the phone and the
 * launchd job both just need to know whether to retry, and a verbose response is
 * one more thing that could leak state to a token holder.
 */
export const IngestResultSchema = z.strictObject({
  ok: z.literal(true),
  /** Rows written or updated, for the collector's local log. */
  accepted: CountSchema,
  /** Whether this push triggered a snapshot recompute. */
  snapshotRebuilt: z.boolean(),
});
export type IngestResult = z.infer<typeof IngestResultSchema>;
