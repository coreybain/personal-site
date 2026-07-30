/**
 * ingestTokens.ts — issue, revoke and verify the bearer tokens that machines
 * authenticate with (ADR 006a).
 *
 * Three sources push data nobody can pull: HealthKit summaries from the phone's
 * background delivery, AI-usage aggregates from the launchd collector on the
 * Mac, and the git statistics job. None of them has a human present, so none of
 * them can hold a Clerk session — they hold one of these tokens instead, and
 * each is independently revocable.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE PLAINTEXT TOKEN IS RETURNED EXACTLY ONCE, BY `issue`, AND IS THEN GONE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Only the SHA-256 hex digest is stored (`ingestTokens.hashedToken`). There is
 * no query in this file, this package, or anywhere else, that can return a
 * plaintext token — not because it is withheld, but because the database does
 * not contain it. A digest is not reversible.
 *
 * The consequences, spelled out so nobody goes looking for the recovery path
 * that does not exist:
 *
 *   • The admin UI MUST show the value from `issue`'s return at the moment it
 *     resolves, and must say plainly that closing the panel loses it.
 *   • A lost token is not recovered, it is replaced: revoke the old row, issue a
 *     new one, paste the new value into the collector's config or the phone.
 *   • Nothing in the admin UI may persist the plaintext — not in `localStorage`,
 *     not in a React state that survives navigation, not in a "recently issued"
 *     list. It is shown, copied, and dropped.
 *
 * ── Runtime notes ─────────────────────────────────────────────────────────
 *
 * Hashing and entropy both use Web Crypto, which the default Convex runtime
 * provides (`crypto`, `SubtleCrypto` — see
 * https://docs.convex.dev/functions/runtimes). The only API restricted to
 * actions is `fetch`, so both work inside a mutation.
 *
 * That was worth checking rather than assuming, because queries and mutations
 * must be deterministic — which is why Convex replaces `Math.random()` with a
 * seeded generator, and why `crypto.getRandomValues()` could plausibly have been
 * seeded, stubbed or refused. It is none of those. Verified 2026-07-30 against
 * the dev deployment, in the query runtime (`convex run --inline-query`), which
 * is bound by the same determinism rules as a mutation:
 *
 *   • `crypto.getRandomValues()` returns real entropy — two successive
 *     executions produced `53c2c5fb0b75d300` and `2133061138e552cd`.
 *   • `crypto.subtle.digest('SHA-256', …)` is correct: `'abc'` hashed to
 *     `ba7816bf…f20015ad`, the published test vector.
 *   • `crypto.randomUUID()` is available, which is why the fallback below is a
 *     real path and not a comforting one.
 *
 * The fallback stays anyway. It costs nothing at runtime, and the alternative is
 * a function whose correctness depends on an undocumented runtime detail
 * remaining true across Convex versions. If both paths ever fail, `issue` throws
 * rather than degrading, and the repair is to move it to an `action` that hashes
 * there and calls an `internalMutation` to insert — the storage shape does not
 * change.
 */

import { v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';
import { requireAdmin } from './lib/auth';
import { assertText, invalid, nowIso } from './lib/validate';
import { ingestScope } from './schema';

/* ------------------------------------------------------------------ *
 * Token format
 * ------------------------------------------------------------------ */

/**
 * Prefix on every issued token.
 *
 * Present so a leaked string is recognisable as a credential for *this* site in
 * a log, a paste or a secret scanner, and so a support question ("is this the
 * token or the deployment URL?") answers itself. It is part of the plaintext
 * that gets hashed — see `sha256Hex`'s caller — so the header value must be sent
 * verbatim, prefix included.
 */
const TOKEN_PREFIX = 'ing_';

/**
 * Bytes of entropy per token: 32, i.e. 256 bits, rendered as 64 hex characters.
 *
 * Hex rather than base64url deliberately. It doubles the length, which costs
 * nothing here (the token lives in a config file and an `Authorization` header),
 * and removes every question about padding, URL-safety and case sensitivity from
 * a value that has to survive being pasted into a plist, a launchd script and an
 * iOS keychain.
 */
const TOKEN_BYTES = 32;

/** Longest accepted token label. Mirrors nothing stricter than good sense. */
const MAX_NAME_LENGTH = 120;

/* ------------------------------------------------------------------ *
 * Crypto helpers
 *
 * Module-private on purpose. Phase 4's HTTP ingest routes do not hash
 * anything themselves — they hand the plaintext to `verifyToken` below,
 * so the digest algorithm and the token format have exactly one
 * definition and cannot drift between issue and verify.
 * ------------------------------------------------------------------ */

/** Lowercase hex, the encoding `ingestTokens.hashedToken` documents. */
function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * `TOKEN_BYTES` of randomness as hex. See the runtime caveat in the file header
 * for why there is a fallback path at all.
 */
function randomTokenHex(): string {
  // `globalThis.crypto` is typed as always-present by lib.dom, which is a claim
  // about browsers, not about the Convex runtime. Widened so the guards below
  // are not dead code to the compiler.
  const webCrypto = globalThis.crypto as Crypto | undefined;

  if (typeof webCrypto?.getRandomValues === 'function') {
    try {
      const bytes = new Uint8Array(TOKEN_BYTES);
      webCrypto.getRandomValues(bytes);
      return toHex(bytes);
    } catch {
      // Fall through. A runtime that refuses `getRandomValues` on determinism
      // grounds would throw here rather than return a weak value.
    }
  }

  if (typeof webCrypto?.randomUUID === 'function') {
    // A v4 UUID carries 122 bits of CSPRNG-backed entropy; three of them,
    // concatenated hex-wise and trimmed, reach the full 256 bits above.
    let hex = '';
    while (hex.length < TOKEN_BYTES * 2) {
      hex += webCrypto.randomUUID().replaceAll('-', '');
    }
    return hex.slice(0, TOKEN_BYTES * 2);
  }

  // Deliberately fatal. `Math.random()` is NOT an acceptable third fallback:
  // Convex seeds it, and a predictable ingest token is worse than a broken
  // issue flow, because it fails silently and stays failed.
  invalid({
    code: 'precondition-failed',
    message:
      'No cryptographic randomness available in this runtime; cannot issue a token. See the note in convex/ingestTokens.ts.',
  });
}

/** SHA-256 of a UTF-8 string, lowercase hex. The one hashing path. */
async function sha256Hex(plaintext: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(plaintext),
  );
  return toHex(new Uint8Array(digest));
}

/* ------------------------------------------------------------------ *
 * Admin surface
 * ------------------------------------------------------------------ */

/**
 * Mint a token. **Returns the plaintext once — see the file header.**
 *
 * @param name - human label shown in admin, e.g. `'MacBook collector'`. Its only
 *   job is to make "which one do I revoke?" answerable a year from now.
 * @param scopes - one or more `IngestScopeSchema` values. Give each source only
 *   what it pushes: revoking the phone must not stop the collector, which is the
 *   entire point of ADR 006a and is defeated by issuing one all-scope token.
 *
 * @returns `{ tokenId, name, scopes, token }` where `token` is the plaintext,
 *   present in this one response and stored nowhere.
 */
export const issue = mutation({
  args: {
    name: v.string(),
    scopes: v.array(ingestScope),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    assertText(args.name, 'name', MAX_NAME_LENGTH);

    // `IngestTokenSchema` says `.nonempty()`; Convex's `v.array()` cannot.
    // A scopeless token authenticates and is then refused by every endpoint,
    // which is a confusing way to spend an afternoon.
    if (args.scopes.length === 0) {
      invalid({
        code: 'invalid-format',
        field: 'scopes',
        message: 'A token needs at least one scope.',
      });
    }

    // Duplicates would survive into the row and read as a mistake in the admin
    // list. Order is preserved so the UI shows them as they were chosen.
    const scopes = [...new Set(args.scopes)];

    const token = `${TOKEN_PREFIX}${randomTokenHex()}`;
    const hashedToken = await sha256Hex(token);

    const tokenId = await ctx.db.insert('ingestTokens', {
      name: args.name.trim(),
      hashedToken,
      scopes,
      // Nullable, not absent: "issued and never used" is a fact the admin list
      // reports, and it must be distinguishable from a row the insert forgot.
      lastUsedAt: null,
      revokedAt: null,
      // No `createdAt`. Convex's `_creationTime` IS the issue time for this
      // table — see schema.ts — and `list` below projects it into the ISO
      // convention the rest of the model uses.
    });

    return { tokenId, name: args.name.trim(), scopes, token };
  },
});

/**
 * Revoke a token. Sets `revokedAt`; the row stays, forever.
 *
 * Revocation is a tombstone rather than a delete so that "the collector stopped
 * pushing on the 14th" has an explanation six months later. `verifyToken` below
 * refuses any row with a non-null `revokedAt`, which is the assertion the phase
 * 6 verification plan checks by name.
 *
 * Idempotent: revoking an already-revoked token returns the original instant
 * rather than throwing or overwriting it. The admin UI may be a stale tab, and
 * the honest answer to "revoke this" when it is already revoked is "it is".
 *
 * @returns `{ tokenId, name, revokedAt, alreadyRevoked }`
 */
export const revoke = mutation({
  args: { tokenId: v.id('ingestTokens') },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const row = await ctx.db.get(args.tokenId);
    if (row === null) {
      invalid({
        code: 'not-found',
        field: 'tokenId',
        message: 'That token no longer exists.',
      });
    }

    if (row.revokedAt !== null) {
      return {
        tokenId: row._id,
        name: row.name,
        revokedAt: row.revokedAt,
        alreadyRevoked: true,
      };
    }

    const revokedAt = nowIso();
    await ctx.db.patch(row._id, { revokedAt });

    return { tokenId: row._id, name: row.name, revokedAt, alreadyRevoked: false };
  },
});

/**
 * Every token, newest first, **without hashes**.
 *
 * The projection is written out field by field rather than spreading the
 * document. That is the point of it: a spread would ship `hashedToken` to the
 * browser the moment someone adds a field, and while a SHA-256 digest is not
 * directly useful to an attacker, publishing it turns an offline dictionary
 * attack into an option and there is no reason to.
 *
 * `issuedAt` converts Convex's epoch-millisecond `_creationTime` into the RFC
 * 3339 string every other timestamp in the model already is, so the admin table
 * formats one kind of value.
 *
 * Ordered `desc` by `_creationTime` with no index: `ingestTokens` holds one row
 * per machine — single digits, for the life of the site — so a scan is the
 * correct read, and an index would be write cost for nothing.
 *
 * Admin-only. The list of which machines can push, and when each last did, is a
 * map of the ingest surface.
 *
 * @returns `Array<{ _id, name, scopes, issuedAt, lastUsedAt, revokedAt }>`
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const rows = await ctx.db.query('ingestTokens').order('desc').collect();

    return rows.map((row) => ({
      _id: row._id,
      name: row.name,
      scopes: row.scopes,
      issuedAt: new Date(row._creationTime).toISOString(),
      /** `null` until the machine has pushed once. A liveness signal (ADR 006a). */
      lastUsedAt: row.lastUsedAt,
      /** Non-null ⇒ dead. Rendered as revoked, never offered for reuse. */
      revokedAt: row.revokedAt,
    }));
  },
});

/* ------------------------------------------------------------------ *
 * Machine surface
 * ------------------------------------------------------------------ */

/**
 * Resolve a plaintext bearer token to its row, or say why not.
 *
 * This is the function phase 4's HTTP ingest routes call, once per request:
 *
 * ```ts
 * // convex/http.ts (phase 4)
 * const auth = request.headers.get('Authorization') ?? '';
 * const result = await ctx.runMutation(internal.ingestTokens.verifyToken, {
 *   token: auth.replace(/^Bearer /, ''),
 *   requiredScope: 'health:write',
 * });
 * if (!result.ok) return new Response(null, { status: result.reason === 'missing-scope' ? 403 : 401 });
 * ```
 *
 * `internalMutation`, for two independent reasons:
 *
 *   • **Internal**, because a public function taking a token argument is an
 *     unauthenticated oracle: anyone could call it from a browser and grind
 *     candidates. Only other Convex functions can reach this.
 *   • **A mutation**, because a successful verify writes `lastUsedAt`. That
 *     makes every ingest request a write transaction, which is a real cost
 *     accepted for a real benefit: a collector that silently stopped running is
 *     visible in the admin list without any monitoring (ADR 006a). Failed
 *     attempts write nothing — an attacker must not be able to leave a trace
 *     shaped like a successful push.
 *
 * It returns a discriminated result instead of throwing. The caller is an HTTP
 * route that has to choose a status code, and matching on `reason` is honest
 * where parsing an error message would not be.
 *
 * On timing: the lookup is an index probe on the *digest*, so it is not
 * constant-time — but the value being compared is already a one-way hash of the
 * secret, so what leaks is timing about a digest an attacker cannot invert into
 * a token. The plaintext itself is never compared.
 *
 * @returns `{ ok: true, tokenId, name, scopes }`
 *   | `{ ok: false, reason: 'unknown-token' | 'revoked' | 'missing-scope' }`
 */
export const verifyToken = internalMutation({
  args: {
    /** The plaintext, exactly as sent — `ing_…`, with no `Bearer ` prefix. */
    token: v.string(),
    /**
     * The scope this endpoint requires. Optional so a future non-scoped use can
     * exist, but every ingest route MUST pass one: a token verified without a
     * scope check is a token with every scope.
     */
    requiredScope: v.optional(ingestScope),
  },
  handler: async (ctx, args) => {
    // Cheap rejection before touching the database or the hash function. A
    // missing header arrives here as `''`.
    if (args.token.length === 0) {
      return { ok: false as const, reason: 'unknown-token' as const };
    }

    const hashedToken = await sha256Hex(args.token);

    // `.first()` rather than `.unique()`: two rows sharing a digest is a
    // 2^-256 event, and if it somehow happened, rejecting every push from
    // both machines would be a worse answer than accepting the first.
    const row = await ctx.db
      .query('ingestTokens')
      .withIndex('by_hashedToken', (q) => q.eq('hashedToken', hashedToken))
      .first();

    if (row === null) {
      return { ok: false as const, reason: 'unknown-token' as const };
    }

    // The ADR 006a assertion: a revoked token is rejected. Checked before
    // scopes so a revoked token cannot be told apart from an unknown one by
    // which failure it produces for a scope it does not hold.
    if (row.revokedAt !== null) {
      return { ok: false as const, reason: 'revoked' as const };
    }

    if (args.requiredScope !== undefined && !row.scopes.includes(args.requiredScope)) {
      return { ok: false as const, reason: 'missing-scope' as const };
    }

    await ctx.db.patch(row._id, { lastUsedAt: nowIso() });

    return {
      ok: true as const,
      tokenId: row._id,
      name: row.name,
      scopes: row.scopes,
    };
  },
});
