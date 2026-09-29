/**
 * previewAccess.ts — who may open the preview area (docs/plans/preview-area.md).
 *
 * There is no sign-in provider. Access is a short code the owner gets through
 * the MCP server (`create_preview_code`): single use, ten-minute expiry, stored
 * only as a SHA-256 hash. Redeeming it at /preview creates a session whose
 * bearer secret lives only in that browser's httpOnly cookie; this table holds
 * its hash. Sessions last 30 days from last use and can all be revoked at once
 * (`revoke_preview_sessions`).
 *
 * Wrong codes are counted globally: after `MAX_FAILURES` inside the window,
 * code entry refuses everything until the window passes, which makes guessing
 * a 40-bit, ten-minute, single-use code hopeless.
 *
 * The public functions here are called by the website's server (Server
 * Actions and server components), never by browser JavaScript directly; the
 * session secret is passed as an argument over HTTPS and never logged.
 */
import { ConvexError, v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { internalMutation, mutation, type MutationCtx, type QueryCtx } from './_generated/server';
import { managementConfiguration, managementSha256, requireManagement } from './lib/managementAuth';
import { nowIso } from './lib/validate';
import { managementEnvironment } from './schema';

const CODE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Extend a session's expiry at most once an hour, so every page view is not a write. */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
/** Crockford base32 without I, L, O, U — nothing to misread when typing. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function previewError(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars = Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

/** Uppercase, strip separators and spaces, and map look-alikes, so "k7qf 2m9x" works. */
export function normaliseCode(input: string): string {
  const cleaned = input.toUpperCase().replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1').replace(/O/g, '0');
  return cleaned.length === 8 ? `${cleaned.slice(0, 4)}-${cleaned.slice(4)}` : cleaned;
}

function randomSession(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `pvs_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export async function issueCode(ctx: MutationCtx): Promise<{ code: string; expiresAt: string }> {
  const code = randomCode();
  const now = Date.now();
  await ctx.db.insert('previewCodes', {
    hashedCode: await managementSha256(code), expiresAt: now + CODE_TTL_MS, usedAt: null, createdAt: now,
  });
  return { code, expiresAt: new Date(now + CODE_TTL_MS).toISOString() };
}

async function revokeAll(ctx: MutationCtx): Promise<number> {
  const now = Date.now();
  let revoked = 0;
  for await (const session of ctx.db.query('previewSessions')) {
    if (session.revokedAt === null && session.expiresAt > now) {
      await ctx.db.patch(session._id, { revokedAt: now });
      revoked += 1;
    }
  }
  for await (const code of ctx.db.query('previewCodes')) {
    if (code.usedAt === null && code.expiresAt > now) await ctx.db.patch(code._id, { expiresAt: now });
  }
  return revoked;
}

/* ------------------------------------------------------------------ *
 * Owner operations (MCP gateway and CLI)
 * ------------------------------------------------------------------ */

/**
 * `create_preview_code` and `revoke_preview_sessions` through the management
 * gateway. Deliberately not routed through management receipts: a receipt
 * stores the result for replay, and a code is a secret that must exist only in
 * the one response that delivers it. The audit row records the action, never
 * the code.
 */
export const manage = internalMutation({
  args: {
    token: v.string(),
    environment: managementEnvironment,
    operation: v.union(v.literal('create_preview_code'), v.literal('revoke_preview_sessions')),
  },
  handler: async (ctx, args) => {
    const actor = await requireManagement(ctx, args, 'content:publish');
    const result = args.operation === 'create_preview_code'
      ? await issueCode(ctx)
      : { revokedSessions: await revokeAll(ctx) };
    await ctx.db.insert('managementAudit', {
      ownerSubject: actor.ownerSubject, actorTokenId: actor.tokenId, environment: actor.environment,
      operation: args.operation, entityType: 'preview', entityId: 'preview-access',
      oldRevision: null, newRevision: null, changedFields: [], createdAt: nowIso(),
    });
    return args.operation === 'create_preview_code'
      ? { ...result, redeemAt: '/preview', note: 'Single use. Expires ten minutes after issue.' }
      : result;
  },
});

/** CLI fallback for the owner: `bunx convex run previewAccess:issueCodeForMachine`. */
export const issueCodeForMachine = internalMutation({
  args: {},
  handler: async (ctx) => await issueCode(ctx),
});

export const revokeAllForMachine = internalMutation({
  args: {},
  handler: async (ctx) => ({ revokedSessions: await revokeAll(ctx) }),
});

/* ------------------------------------------------------------------ *
 * Browser sessions (called by the website's server)
 * ------------------------------------------------------------------ */

export const redeem = mutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const recentFailures = await ctx.db.query('previewFailures')
      .withIndex('by_at', (q) => q.gt('at', now - FAILURE_WINDOW_MS)).take(MAX_FAILURES);
    if (recentFailures.length >= MAX_FAILURES) {
      previewError('locked', 'Too many incorrect codes. Code entry is paused for 15 minutes.');
    }

    const code = normaliseCode(args.code.slice(0, 64));
    const hashed = /^[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(code) ? await managementSha256(code) : null;
    const found = hashed
      ? await ctx.db.query('previewCodes').withIndex('by_hashedCode', (q) => q.eq('hashedCode', hashed)).unique()
      : null;

    if (!found || found.usedAt !== null || found.expiresAt <= now) {
      // Recorded in its own write; the thrown error below would roll it back,
      // so failures are returned rather than thrown.
      await ctx.db.insert('previewFailures', { at: now });
      return { ok: false as const, message: 'That code is not valid or has expired. Ask for a new one.' };
    }

    await ctx.db.patch(found._id, { usedAt: now });
    const session = randomSession();
    await ctx.db.insert('previewSessions', {
      hashedSession: await managementSha256(session),
      createdAt: now, lastSeenAt: now, expiresAt: now + SESSION_TTL_MS, revokedAt: null,
    });
    return { ok: true as const, session, expiresAt: new Date(now + SESSION_TTL_MS).toISOString() };
  },
});

async function findSession(ctx: QueryCtx, session: string): Promise<Doc<'previewSessions'> | null> {
  if (!/^pvs_[a-f0-9]{64}$/.test(session)) return null;
  const hashed = await managementSha256(session);
  const row = await ctx.db.query('previewSessions').withIndex('by_hashedSession', (q) => q.eq('hashedSession', hashed)).unique();
  if (!row || row.revokedAt !== null || row.expiresAt <= Date.now()) return null;
  return row;
}

/** Gate for every preview read and write. Throws `unauthenticated` for an unknown, expired or revoked session. */
export async function requirePreviewSession(ctx: QueryCtx, session: string): Promise<Doc<'previewSessions'>> {
  const row = await findSession(ctx, session);
  if (!row) previewError('unauthenticated', 'Your preview session has ended. Enter a new code.');
  return row;
}

/** Called on each preview page load: validates and, at most hourly, rolls the 30-day expiry forward. */
export const touch = mutation({
  args: { session: v.string() },
  handler: async (ctx, args) => {
    const row = await findSession(ctx, args.session);
    if (!row) return { valid: false as const };
    const now = Date.now();
    if (now - row.lastSeenAt >= TOUCH_INTERVAL_MS) {
      await ctx.db.patch(row._id, { lastSeenAt: now, expiresAt: now + SESSION_TTL_MS });
    }
    return { valid: true as const };
  },
});

export const signOut = mutation({
  args: { session: v.string() },
  handler: async (ctx, args) => {
    const row = await findSession(ctx, args.session);
    if (row) await ctx.db.patch(row._id, { revokedAt: Date.now() });
    return { signedOut: true as const };
  },
});

/** Audit a preview-area action under the configured owner, attributed to the session. */
export async function auditPreviewAction(
  ctx: MutationCtx,
  session: Doc<'previewSessions'>,
  entry: { operation: string; entityId: string; oldRevision: number | null; newRevision: number | null; changedFields: string[] },
): Promise<void> {
  const configured = managementConfiguration();
  await ctx.db.insert('managementAudit', {
    ownerSubject: configured.ownerSubject, actorTokenId: `preview:${session._id}`,
    environment: configured.environment as 'development' | 'production', entityType: 'post', createdAt: nowIso(), ...entry,
  });
}

export const pruneExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let removed = 0;
    for await (const code of ctx.db.query('previewCodes')) {
      if (code.expiresAt <= now) { await ctx.db.delete(code._id); removed += 1; }
    }
    for await (const session of ctx.db.query('previewSessions')) {
      if (session.expiresAt <= now || (session.revokedAt !== null && session.revokedAt < now - SESSION_TTL_MS)) {
        await ctx.db.delete(session._id); removed += 1;
      }
    }
    for (const failure of await ctx.db.query('previewFailures').withIndex('by_at', (q) => q.lt('at', now - FAILURE_WINDOW_MS)).collect()) {
      await ctx.db.delete(failure._id); removed += 1;
    }
    return { removed };
  },
});
