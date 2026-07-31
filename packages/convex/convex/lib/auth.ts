/**
 * lib/auth.ts — the single place a Convex function decides who may write.
 *
 * ADR 006: Clerk is the only human identity provider, and this site has exactly
 * one human administrator. Authentication is not authorization: a valid Clerk
 * session is accepted only when its stable `subject` matches the deployment's
 * `ADMIN_CLERK_USER_ID`. The check fails closed when that variable is absent,
 * so an accidentally enabled public sign-up can never grant site-wide writes.
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
  code: 'unauthenticated' | 'forbidden' | 'authorization-not-configured';
  message: string;
};

/** The one Clerk subject allowed to operate this personal site's admin. */
function configuredAdminSubject(): string | null {
  const subject = process.env.ADMIN_CLERK_USER_ID?.trim();
  return subject ? subject : null;
}

/**
 * Assert the caller is signed in, and return who they are.
 *
 * Every mutation in this package begins with `await requireAdmin(ctx)`. Queries
 * mostly do not: the public site reads published content anonymously, and the
 * admin-only reads say so individually.
 *
 * Throws `ConvexError<AuthErrorData>` when there is no identity, no configured
 * administrator, or the subject is not that administrator. It does not
 * distinguish "no token" from "expired token" from "wrong `aud` claim" —
 * `getUserIdentity()` returns `null` for all three.
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

  const adminSubject = configuredAdminSubject();
  if (adminSubject === null) {
    throw new ConvexError<AuthErrorData>({
      code: 'authorization-not-configured',
      message: 'The administrator allowlist is not configured.',
    });
  }

  if (identity.subject !== adminSubject) {
    throw new ConvexError<AuthErrorData>({
      code: 'forbidden',
      message: 'This Clerk account is not authorized to administer the site.',
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
  const identity = await ctx.auth.getUserIdentity();
  const adminSubject = configuredAdminSubject();
  return identity !== null && adminSubject !== null && identity.subject === adminSubject;
}
