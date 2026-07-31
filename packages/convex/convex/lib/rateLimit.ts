/**
 * lib/rateLimit.ts — the counter, and the only implementation of it.
 *
 * ⚠️ THIS IS THE ENFORCING COPY. `RATE_LIMIT_POLICY` in `@home/types` mirrors
 * the numbers below for the UI's benefit ("ten questions an hour") and enforces
 * nothing. Change this file first, then that one — the same hand-mirroring
 * convention `lib/validate.ts` sets out, and for the same reason:
 * `packages/convex` depends on nothing but `convex` itself.
 *
 * Three callers, one function:
 *
 *   `ask.checkRateLimit`        the public meter, called by the /ask route.
 *   `ask.retrieve`              meters itself on its own bucket (a backstop).
 *   `contactMessages.submit`    meters itself inline.
 *
 * They all go through `consumeRateLimit` so there is exactly one place where a
 * window is decided, a counter is incremented, and a refusal is shaped. A
 * second implementation is how two surfaces end up disagreeing about what
 * "an hour" means.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  THE DESIGN: fixed window counter, one row per (bucket, identifier),
 *  reset in place.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * On each request:
 *
 *   1. floor `now` to a multiple of the bucket's window length → `windowStart`.
 *   2. read the single row for `(bucket, identifierHash)` via
 *      `by_bucket_identifierHash`.
 *   3. no row              → insert `{ windowStart, count: 1 }`, allow.
 *      row, older window   → patch `{ windowStart, count: 1 }`, allow.
 *                            (the reset — the row is reused, never appended to)
 *      row, same window    → `count >= limit` ? refuse : patch `count + 1`.
 *
 * ── Why fixed and not sliding ─────────────────────────────────────────────
 *
 * The honest cost of a fixed window is a **boundary burst**: ten questions at
 * 10:59 and ten more at 11:00 is twenty questions in two minutes against a
 * ten-per-hour limit. The alternatives price that out as follows, on Convex
 * specifically:
 *
 *   • **Sliding log** (timestamp per request) is exact, and costs a row per
 *     request plus a range read and a prune on every check. On a mutation that
 *     already re-runs under OCC contention, that is the expensive option for a
 *     personal site's traffic.
 *   • **Sliding window counter** (two adjacent fixed windows, weighted by how
 *     far into the current one you are) is the usual compromise and costs two
 *     rows and two reads per check. It smooths the boundary; it does not remove
 *     it, and it doubles the write set of every metered request.
 *   • **Fixed window** costs one indexed read and one patch, and its worst case
 *     is bounded and known.
 *
 * What this limiter is actually for decides it: containing cost and casual
 * abuse on a portfolio site, not defending a payments API. A stranger who
 * manages twenty questions across a window boundary has cost about a cent and
 * is still capped at ten for the following hour. That is the right trade for
 * one row and one read, and it is written down here so the next person does not
 * have to rediscover that it was a choice.
 *
 * ── Why the window is ALIGNED to the epoch ────────────────────────────────
 *
 * `windowStart = floor(now / windowMs) * windowMs`, not "the first request's
 * timestamp". Alignment buys two things: `resetAt` is computable by the caller
 * without reading the row (so a UI can print "resets at 11:00" from the
 * decision alone), and a limit can never be extended by a well-timed request —
 * with a rolling start, one request per 59 minutes keeps a window alive
 * forever.
 *
 * ── The residual, stated plainly ──────────────────────────────────────────
 *
 * The check mutation is public, because a Server Action calling Convex has no
 * other way in. So anyone holding the deployment URL can send an *invented*
 * digest and create a row. They cannot send someone else's (the salt is in the
 * web app's environment), so the damage is table growth, bounded by one row per
 * distinct digest per window and swept by `ask.pruneRateLimits`. It is not free
 * and it is not nothing; it is the price of metering a browser-reachable
 * backend, and it is smaller than the thing being prevented.
 *
 * ── Concurrency ───────────────────────────────────────────────────────────
 *
 * Read-then-write, which is safe here for the same reason `assertSlugUnique` is
 * safe: Convex mutations are serialisable, and two concurrent increments on one
 * row conflict, so one is retried against the other's result. Both are counted.
 */

import type { MutationCtx } from '../_generated/server';
import { invalid, nowIso } from './validate';

/* ------------------------------------------------------------------ *
 * Policy
 * ------------------------------------------------------------------ */

/** A bucket name. Mirrors the `rateLimitBucket` validator in schema.ts. */
export type RateLimitBucket = 'ask' | 'ask-retrieve' | 'contact';

/** One bucket's ceiling. */
type Policy = {
  /** Requests permitted per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
  /** Why these numbers. Printed nowhere; read by whoever changes them. */
  rationale: string;
};

/**
 * The ceilings. Deliberately modest — this site's real traffic is a hiring
 * manager reading for ten minutes, and every number here is far above what that
 * person does and far below what a script does.
 *
 * ⚠️ Mirror any change into `RATE_LIMIT_POLICY` in `@home/types`.
 */
export const RATE_LIMITS: Record<RateLimitBucket, Policy> = {
  ask: {
    limit: 10,
    windowSeconds: 3600,
    rationale:
      'One question = one OpenAI embedding + one Anthropic completion. Ten an ' +
      'hour is more than a genuine reader asks and caps a scripted caller at ' +
      'roughly a cent per hour.',
  },
  'ask-retrieve': {
    limit: 30,
    windowSeconds: 3600,
    rationale:
      'A backstop on the public `retrieve` action for callers that bypass the ' +
      '/ask route entirely. Looser than `ask` on purpose: retrieval is the ' +
      'cheap half (an embedding, no completion), and a route that legitimately ' +
      'retries retrieval for one question must not be refused before the ' +
      'question itself is.',
  },
  contact: {
    limit: 3,
    windowSeconds: 3600,
    rationale:
      'Three messages an hour. A real sender writes once; a second and third ' +
      'are the corrections a real sender sometimes needs. Beyond that it is a ' +
      'form-filler, and the inbox is one human being.',
  },
};

/* ------------------------------------------------------------------ *
 * Identifier
 * ------------------------------------------------------------------ */

/** `IdentifierHashSchema`: 64 lowercase hex characters. */
const IDENTIFIER_HASH_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Assert the caller sent a digest and not something else.
 *
 * The strictness is the point rather than tidiness. A caller that passed a raw
 * IP address, an email, or a session id would still "work" — it would key a
 * counter perfectly well — and it would have quietly put an identifier into a
 * database column that schema.ts promises never holds one. A shape check is the
 * only mechanical defence against that, so it is not optional and the error
 * message says what was expected without echoing what was received.
 */
export function assertIdentifierHash(value: string): void {
  if (!IDENTIFIER_HASH_PATTERN.test(value)) {
    invalid({
      code: 'invalid-format',
      field: 'identifierHash',
      message:
        'identifierHash must be a lowercase hex SHA-256 digest (64 characters). ' +
        'Hash the identifier — never send a raw address.',
    });
  }
}

/* ------------------------------------------------------------------ *
 * The check
 * ------------------------------------------------------------------ */

/**
 * The answer to "may this request proceed?".
 *
 * Mirrors `RateLimitDecisionSchema` in `@home/types`, which is what the Next
 * route and the /ask UI type themselves against.
 */
export type RateLimitDecision = {
  allowed: boolean;
  /** The ceiling applied, so a refusal can quote it. */
  limit: number;
  /** Requests left in this window *after* this one. `0` when refused. */
  remaining: number;
  /** Seconds until the window rolls. `0` when allowed — it is an HTTP header. */
  retryAfterSeconds: number;
  /** The instant the window rolls, for a UI that would rather print a time. */
  resetAt: string;
};

/**
 * Consume one unit from `(bucket, identifierHash)`, or refuse.
 *
 * **Consuming, not peeking.** A call that returns `allowed: true` has already
 * incremented the counter, so calling this twice for one user-visible action
 * charges that action twice. That is why `ask.retrieve` has a bucket of its own
 * rather than sharing `ask` with the route that calls it — see the note there.
 *
 * A refusal does NOT increment. Hammering a refused endpoint therefore costs
 * one read and no write, and cannot extend the wait.
 *
 * @param ctx - any mutation context. Deliberately not usable from a query: this
 *   writes, and a "check" that silently failed to count would be worse than no
 *   limit at all.
 */
export async function consumeRateLimit(
  ctx: MutationCtx,
  bucket: RateLimitBucket,
  identifierHash: string,
): Promise<RateLimitDecision> {
  assertIdentifierHash(identifierHash);

  const policy = RATE_LIMITS[bucket];
  const windowMs = policy.windowSeconds * 1000;

  // `Date.now()` is frozen for the lifetime of a Convex mutation, so every
  // instant computed below is the same instant — which is what makes
  // `windowStart` and `resetAt` agree exactly with the row that gets written.
  const nowMs = Date.now();
  const windowStartMs = Math.floor(nowMs / windowMs) * windowMs;
  const resetMs = windowStartMs + windowMs;

  const windowStart = new Date(windowStartMs).toISOString();
  const resetAt = new Date(resetMs).toISOString();
  // Rounded up: a `Retry-After: 0` on a refusal invites an immediate retry that
  // is certain to be refused again.
  const retryAfterSeconds = Math.max(1, Math.ceil((resetMs - nowMs) / 1000));

  /* `collect()` and collapse, not `.unique()` — the same call `knowledge.ts`
     makes about its upsert, and for a sharper reason. `by_bucket_identifierHash`
     is an index, not a uniqueness constraint; nothing in Convex prevents a
     second row, and `.unique()` *throws* on one. A throw here does not degrade
     the limiter, it breaks the contact form and Ask Corey outright, permanently,
     for one identifier. Collapsing costs a delete in a case that should never
     happen and cannot fail closed on a caller who did nothing wrong. */
  const rows = await ctx.db
    .query('rateLimits')
    .withIndex('by_bucket_identifierHash', (q) =>
      q.eq('bucket', bucket).eq('identifierHash', identifierHash),
    )
    .collect();

  const [existing, ...duplicates] = rows;
  for (const duplicate of duplicates) {
    await ctx.db.delete(duplicate._id);
  }

  const refused: RateLimitDecision = {
    allowed: false,
    limit: policy.limit,
    remaining: 0,
    retryAfterSeconds,
    resetAt,
  };

  /* First sighting of this identifier in this bucket, ever. */
  if (existing === undefined) {
    await ctx.db.insert('rateLimits', {
      bucket,
      identifierHash,
      windowStart,
      count: 1,
      updatedAt: nowIso(),
    });
    return {
      allowed: true,
      limit: policy.limit,
      remaining: policy.limit - 1,
      retryAfterSeconds: 0,
      resetAt,
    };
  }

  /* The row belongs to an earlier window: reset it in place. This is the branch
     that keeps the table one row per identifier instead of one row per window,
     and it is why nothing has to expire for the limiter to be correct — a stale
     row is indistinguishable from no row. `pruneRateLimits` exists to reclaim
     space, not to restore correctness.

     `<` rather than `!==` deliberately: a row from the *future* (a clock skew,
     or a hand-edited row) is treated as the current window rather than reset,
     so nobody can lift their own limit by writing a later `windowStart`. */
  if (existing.windowStart < windowStart) {
    await ctx.db.patch(existing._id, {
      windowStart,
      count: 1,
      updatedAt: nowIso(),
    });
    return {
      allowed: true,
      limit: policy.limit,
      remaining: policy.limit - 1,
      retryAfterSeconds: 0,
      resetAt,
    };
  }

  /* Same window, and already at the ceiling. No write: see the docblock. */
  if (existing.count >= policy.limit) {
    return refused;
  }

  const count = existing.count + 1;
  await ctx.db.patch(existing._id, { count, updatedAt: nowIso() });

  return {
    allowed: true,
    limit: policy.limit,
    remaining: policy.limit - count,
    retryAfterSeconds: 0,
    resetAt,
  };
}
