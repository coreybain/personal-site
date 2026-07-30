/**
 * lib/auth.ts — the single place a Convex function decides who may write.
 *
 * ADR 006: Clerk is the only human auth, and this site has exactly one human.
 * There is no roles table, no allowlist and no `users` table, because there is
 * no second person to distinguish from the first: **any identity Clerk vouches
 * for is the admin**. The gate is enforced in Clerk's dashboard (public
 * sign-ups off, one user), not here — see packages/convex/README.md step 2.
 *
 * That is a deliberate, narrow trust assumption, so it is worth being explicit
 * about what would break it: leaving sign-ups enabled in Clerk would make every
 * mutation in this package writable by anyone who can create an account. If a
 * second human ever needs an account, the fix is a claim check in
 * `requireAdmin` (e.g. `identity.subject === process.env.ADMIN_SUBJECT`), and
 * because every mutation calls this helper, that is a one-file change.
 *
 * ── Why a helper rather than a custom function wrapper ─────────────────────
 *
 * Convex supports building a wrapped `adminMutation` constructor, which would
 * make the check impossible to forget. It is not used because the wrapper hides
 * the check at the call site, and this package's whole idiom is that the
 * important decisions are visible in the file you are reading. `await
 * requireAdmin(ctx)` as the first line of every mutation is one line of
 * ceremony that a reviewer can grep for:
 *
 *   rg -n 'requireAdmin' packages/convex/convex
 *
 * Any mutation that does not appear in that output is either a bug or a
 * deliberately public write — and there is exactly one of those
 * (`contactMessages.submit`, which says so at length).
 *
 * ── Errors ────────────────────────────────────────────────────────────────
 *
 * Failures throw `ConvexError` rather than a bare `Error`. Convex redacts the
 * message of an uncaught plain `Error` in production deployments (the client
 * sees "Server Error"), while a `ConvexError`'s `data` payload is delivered
 * intact. The admin UI needs to tell "your session expired, sign in again"
 * apart from "that slug is taken", so the distinction is load-bearing rather
 * than cosmetic.
 */

import type { Auth, UserIdentity } from 'convex/server';
import { ConvexError } from 'convex/values';

/**
 * The narrowest context shape these helpers need.
 *
 * `QueryCtx`, `MutationCtx` and `ActionCtx` all satisfy it, so one helper
 * serves all three without importing the generated context types (which would
 * make `lib/` depend on `_generated/`, and this file is imported by everything).
 */
type AuthedCtx = { auth: Auth };

/** Shape of the `data` payload on every auth failure thrown here. */
export type AuthErrorData = {
  code: 'unauthenticated';
  message: string;
};

/**
 * Assert the caller is signed in, and return who they are.
 *
 * Every mutation in this package begins with `await requireAdmin(ctx)`. Queries
 * mostly do not: the public site reads published content anonymously, and the
 * admin-only reads say so individually.
 *
 * Throws `ConvexError<AuthErrorData>` when there is no identity. It does not
 * distinguish "no token" from "expired token" from "wrong `aud` claim" —
 * `getUserIdentity()` returns `null` for all three, and a misconfigured Clerk
 * JWT template looks exactly like being signed out (README step 3).
 *
 * @returns the Clerk identity: `subject` is the stable user id, and `tokenIdentifier`
 *   is the issuer-qualified form. Callers that only need the gate may ignore it.
 */
export async function requireAdmin(ctx: AuthedCtx): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity();

  if (identity === null) {
    throw new ConvexError<AuthErrorData>({
      code: 'unauthenticated',
      message: 'Admin sign-in required.',
    });
  }

  return identity;
}

/**
 * Whether the caller is signed in, without throwing.
 *
 * For reads whose *shape* is the same either way but whose *rows* are not: the
 * admin listings show drafts, the public listings do not, and both are the same
 * query with a different filter. Do not use this to guard a write — a write
 * wants the throw, so that a signed-out client gets an error instead of a
 * silent no-op.
 */
export async function isAdmin(ctx: AuthedCtx): Promise<boolean> {
  return (await ctx.auth.getUserIdentity()) !== null;
}
