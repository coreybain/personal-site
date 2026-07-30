import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextMiddleware } from "next/server";

/**
 * proxy.ts — request interception, Next 16's name for what was `middleware.ts`.
 *
 * The rename is not cosmetic and the migration notes are worth keeping here:
 * the file must be called `proxy.ts` (verified in
 * node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md), the
 * exported function should be named `proxy`, one such file is permitted per
 * app, and the runtime is **always** `nodejs` — `edge` is not supported in
 * `proxy` and is not configurable. Clerk's Next.js quickstart agrees: from
 * Next 16 the file is `proxy.ts`, contents otherwise unchanged.
 *
 * Because the app lives at `src/app`, this file lives at `src/proxy.ts` — the
 * convention is "same level as `app`", not "repo root".
 */

/**
 * Is Clerk actually set up?
 *
 * Both halves are needed and they are read at different moments, which is worth
 * knowing before debugging this:
 *
 *   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY  inlined at build time, like every
 *                                      NEXT_PUBLIC_ variable
 *   CLERK_SECRET_KEY                   read from the process at cold start —
 *                                      never inlined, never sent to a browser
 *
 * So a deployment that has the publishable key at build and the secret at
 * runtime is configured; one missing either is not. On Vercel both are present
 * for both phases, so this distinction only bites local experiments.
 */
const clerkConfigured = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
);

/**
 * Clerk on `/admin`, a pass-through everywhere and every-when else.
 *
 * There is no route test in the handler, and that is the point: `config.matcher`
 * below already guarantees nothing but `/admin` reaches this function, so
 * `auth.protect()` can run unconditionally. Clerk's own `createRouteMatcher` is
 * deprecated in v7 precisely because a *second* path matcher can drift from the
 * one Next actually routes with; deleting it removes the drift rather than
 * documenting it.
 *
 * `protect()` in Clerk v7 (Core 3) is awaited off the `auth` argument directly —
 * not off the object `auth()` returns — and it throws the redirect or 404
 * itself rather than handing back a response to forward.
 *
 * Clerk's current guidance is that the real gate belongs at the resource: an
 * `await auth.protect()` at the top of every page, layout, route handler and
 * server function under `/admin`. Phase 2 must do that when it builds the route
 * group. This stays as the cheap outer perimeter — it keeps unauthenticated
 * traffic from ever reaching a render — but it is not, on its own, the
 * authorisation model.
 *
 * The unconfigured branch exists because no Clerk account exists yet, and
 * `clerkMiddleware`'s handler throws on a missing publishable key the first time
 * it sees a request. Constructing it eagerly would be harmless — the key check
 * is per-request — but *running* it would turn every `/admin` hit into a 500.
 * `NextResponse.next()` is the honest no-op: carry on to routing, which today
 * 404s because `/admin` is a phase 2 route group that does not exist yet.
 */
export const proxy: NextMiddleware = clerkConfigured
  ? clerkMiddleware(async (auth) => {
      await auth.protect();
    })
  : () => NextResponse.next();

/**
 * Which requests reach this file at all.
 *
 * Without a `matcher` a proxy runs on *everything* — `_next/static`, image
 * optimisation, `public/` assets — so the usual Clerk recipe is a long negative
 * pattern that excludes them. That recipe exists so `auth()` works in arbitrary
 * server components. Nothing outside `/admin` calls `auth()` here, so the
 * positive form is both shorter and strictly better: the public site never
 * enters this code path, which is precisely the independence ADR 006 asks for.
 *
 * The corollary is a trap worth naming: **the day something outside `/admin`
 * needs `auth()` or `currentUser()`, this matcher has to widen first.** Clerk
 * cannot populate the request it never saw, and the symptom is an error about
 * `clerkMiddleware` not being detected rather than anything pointing here.
 *
 * Must stay a literal — Next statically analyses this at build time and ignores
 * anything computed.
 */
export const config = {
  matcher: ["/admin(.*)"],
};
