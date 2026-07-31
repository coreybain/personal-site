/**
 * rateLimit.ts — `rateLimits`, the counter table behind every public write.
 *
 * Phase 6 owns this. Two surfaces on this site can be driven by a stranger and
 * both cost money or storage when they are:
 *
 *   • **Ask Corey** (`/ask`, ADR 015) — one question is one OpenAI embedding
 *     plus one Anthropic completion. Unmetered, a script turns a portfolio into
 *     a bill.
 *   • **The contact form** — `contactMessages.submit` is the one deliberately
 *     public mutation in `packages/convex`, and its docblock has said since
 *     phase 2 that rate limiting "belongs to build phase 6". This is that.
 *
 * ── The identifier is a HASH, and the raw value never arrives ───────────────
 *
 * `identifierHash` is a lowercase hex SHA-256 of `salt + identifier`, computed
 * **in the Next.js layer**, where the caller's IP is actually visible. Convex
 * never sees an IP: a Convex mutation has no access to the request's transport
 * (the browser talks to Convex directly, and a Server Action's IP is a Next
 * concern), so the address is hashed at the only place it exists and the digest
 * is what crosses the wire. The salt lives in the web app's environment, so the
 * digest is not reversible by rainbow table and cannot be recomputed by anyone
 * who merely knows the address.
 *
 * That property is load-bearing rather than decorative. The check mutation is
 * public — it has to be, since a Server Action calls it — so anyone can send it
 * a digest. Without the salt they cannot send *someone else's* digest, which is
 * the attack that matters (burning a stranger's quota). Sending random digests
 * only fills the table with rows that expire, which `ask.pruneRateLimits`
 * sweeps.
 *
 * ── Fixed window, one row per (bucket, identifier) ─────────────────────────
 *
 * The stored shape is a **fixed window counter**: the window start is floored
 * to a multiple of the window length, and the single row for an identifier is
 * *reset in place* when the request that arrives belongs to a later window.
 * Read the trade-off note in `packages/convex/convex/lib/rateLimit.ts` — it is
 * the enforcing copy, and it explains why this and not a sliding log.
 *
 * ⚠️ This table is server-internal. It is not read by any page, it is not in
 * the Swift contract's useful surface, and no public query returns a row from
 * it. It is modelled here because `@home/types` is the mirror of the Convex
 * schema (see `tableSchemas`), and a table missing from the mirror is a table
 * the drift check cannot see.
 */

import * as z from 'zod';
import { CountSchema, IsoDateTimeSchema, NonNegativeNumberSchema } from './primitives';

/**
 * Which public surface a counter belongs to.
 *
 * Buckets are separate counters, never a shared pool, because they meter
 * different costs and deserve different ceilings. Splitting them also means a
 * reader who has used up their questions can still send a message.
 *
 *   `ask`           one question on `/ask`: an embedding + a completion.
 *                   Metered by the Next route via `ask.checkRateLimit`.
 *   `ask-retrieve`  a direct call to the public `ask.retrieve` action. A
 *                   backstop on the action itself, deliberately looser than
 *                   `ask` — see the note on double counting in `ask.ts`.
 *   `contact`       one contact form submission. Enforced inside
 *                   `contactMessages.submit`, not in front of it.
 */
export const RateLimitBucketSchema = z.enum(['ask', 'ask-retrieve', 'contact']);
export type RateLimitBucket = z.infer<typeof RateLimitBucketSchema>;

/** Lowercase hex SHA-256. 64 characters, and nothing else is accepted. */
export const IdentifierHashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'Expected a lowercase hex SHA-256 digest');
export type IdentifierHash = z.infer<typeof IdentifierHashSchema>;

/**
 * One counter row. Mirrors the `rateLimits` table.
 *
 * There is at most ONE row per `(bucket, identifierHash)` — ever, not per
 * window. A request in a later window rewrites `windowStart` and resets
 * `count`, so the table's size is bounded by the number of distinct identifiers
 * seen recently rather than by traffic.
 */
export const RateLimitSchema = z.object({
  bucket: RateLimitBucketSchema,
  identifierHash: IdentifierHashSchema,
  /**
   * Start of the window this `count` belongs to, floored to a multiple of the
   * bucket's window length since the Unix epoch. Aligned rather than
   * rolling-from-first-request so `resetAt` is computable by the caller and
   * identical for everyone in the same window.
   */
  windowStart: IsoDateTimeSchema,
  /** Requests consumed in this window. Always ≥ 1 once the row exists. */
  count: CountSchema,
  /** When the row was last touched. Feeds the prune sweep and nothing else. */
  updatedAt: IsoDateTimeSchema,
});
export type RateLimit = z.infer<typeof RateLimitSchema>;

/**
 * What a check returns to its caller.
 *
 * Not a stored shape — this is the return value of `ask.checkRateLimit` and the
 * `rateLimit` field of `ask.retrieve`, modelled here so the Next route and the
 * `/ask` UI infer it instead of re-typing it.
 *
 * `retryAfterSeconds` is `0` when `allowed` is true. It is named for the HTTP
 * header it exists to fill: a route that refuses should answer `429` with
 * `Retry-After: <retryAfterSeconds>`.
 */
export const RateLimitDecisionSchema = z.object({
  allowed: z.boolean(),
  /** The ceiling that was applied, so a message can quote it honestly. */
  limit: CountSchema,
  /** Requests left in this window after this one. `0` when refused. */
  remaining: CountSchema,
  /** Seconds until the window rolls. `0` when allowed. */
  retryAfterSeconds: NonNegativeNumberSchema,
  /** The instant the window rolls, for a UI that would rather print a time. */
  resetAt: IsoDateTimeSchema,
});
export type RateLimitDecision = z.infer<typeof RateLimitDecisionSchema>;

/**
 * The policy, as documentation.
 *
 * ⚠️ THIS IS NOT THE ENFORCING COPY. `RATE_LIMITS` in
 * `packages/convex/convex/lib/rateLimit.ts` is what actually refuses a request;
 * `packages/convex` deliberately depends on nothing but `convex` itself (see
 * that package's `lib/validate.ts` header) and so cannot import this file. The
 * two are hand-mirrored, exactly as `MAX_MESSAGE` and friends already are:
 * change the Convex copy first, then this one.
 *
 * It is exported anyway because the web app has a legitimate use for it that
 * does not involve enforcement — telling a reader "ten questions an hour"
 * before they hit the wall, in the same words the server would use.
 */
export const RATE_LIMIT_POLICY = {
  ask: { limit: 10, windowSeconds: 3600 },
  'ask-retrieve': { limit: 30, windowSeconds: 3600 },
  contact: { limit: 3, windowSeconds: 3600 },
} as const satisfies Record<RateLimitBucket, { limit: number; windowSeconds: number }>;
