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
 * Three paths the matcher below has to let through but `protect()` must not
 * touch.
 *
 * All three are exemptions from "everything the matcher sees is protected",
 * and all are load-bearing rather than convenient:
 *
 *   /admin/sign-in     Clerk's own <SignIn /> lives here (app/admin/sign-in).
 *                      Protecting it is a redirect loop: an unauthenticated hit
 *                      is sent to the sign-in URL, which is this path, which is
 *                      protected, which redirects… The sign-in page is the one
 *                      page under /admin that must render for a signed-out
 *                      visitor.
 *
 *   /api/uploadthing   The UploadThing route handler (ADR 010). It needs Clerk
 *                      *context* — its `.middleware()` calls `auth()`, which is
 *                      only populated on requests this file has seen — but it
 *                      must not be blanket-protected, because UploadThing's own
 *                      servers POST the upload-complete callback here with no
 *                      browser session. `protect()` would 404 those and every
 *                      upload would hang at "finishing". The route's own
 *                      middleware is the gate for the browser-facing half, and
 *                      it rejects a signed-out caller with `UploadThingError`.
 *
 *   /api/native/upload The iOS client sends a Clerk session JWT in the
 *                      Authorization header. Matching the route lets Clerk
 *                      populate `auth()` from that bearer token; the route
 *                      performs its own check so it can return stable JSON 401
 *                      and 503 responses instead of Proxy's redirect/404
 *                      semantics.
 *
 * Compared as an exact match or a `/`-delimited prefix, never `startsWith` on
 * its own: a bare prefix test would also exempt `/admin/sign-inbox`.
 */
const UNPROTECTED_PATHS = [
  "/admin/sign-in",
  "/api/uploadthing",
  "/api/native/upload",
] as const;

function isUnprotected(pathname: string): boolean {
  return UNPROTECTED_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

/**
 * Clerk on `/admin`, a pass-through everywhere and every-when else.
 *
 * The handler tests the pathname, which an earlier revision of this file argued
 * against — worth explaining, because the argument was right and the situation
 * changed. `config.matcher` is the only thing that decides which requests reach
 * this function, so a *second, redundant* matcher inside the handler is pure
 * drift risk (which is why Clerk deprecated `createRouteMatcher` in v7). The
 * test below is not redundant: the matcher now covers three path families whose
 * handling genuinely differs, and Next's matcher syntax cannot express "match
 * this so Clerk populates the request, but do not protect it". The list above is
 * therefore the *only* place the exemptions live, not a copy of something else.
 *
 * `protect()` in Clerk v7 (Core 3) is awaited off the `auth` argument directly —
 * not off the object `auth()` returns — and it throws the redirect or 404
 * itself rather than handing back a response to forward.
 *
 * Clerk's current guidance is that the real gate belongs at the resource: an
 * `await auth()` check at the top of every page, layout, route handler and
 * server function under `/admin`. That gate exists — `app/admin/(shell)/layout.tsx`
 * redirects a session-less caller to `/admin/sign-in`, and every Convex mutation
 * re-checks the identity server-side via `requireAdmin`. This stays as the cheap
 * outer perimeter, which keeps unauthenticated traffic from ever reaching a
 * render, but it is not on its own the authorisation model.
 *
 * The unconfigured branch exists because no Clerk account exists yet, and
 * `clerkMiddleware`'s handler throws on a missing publishable key the first time
 * it sees a request. Constructing it eagerly would be harmless — the key check
 * is per-request — but *running* it would turn every `/admin` hit into a 500.
 * `NextResponse.next()` is the honest no-op: carry on to routing, which renders
 * the admin shell's "auth is not configured" notice instead of a session.
 */
export const proxy: NextMiddleware = clerkConfigured
  ? clerkMiddleware(async (auth, request) => {
      if (isUnprotected(request.nextUrl.pathname)) {
        return;
      }

      await auth.protect();
    })
  : () => NextResponse.next();

/**
 * Which requests reach this file at all.
 *
 * Without a `matcher` a proxy runs on *everything* — `_next/static`, image
 * optimisation, `public/` assets — so the usual Clerk recipe is a long negative
 * pattern that excludes them. That recipe exists so `auth()` works in arbitrary
 * server components. Only three path families here call `auth()`, so the
 * positive form is both shorter and strictly better: the public site never
 * enters this code path, which is precisely the independence ADR 006 asks for.
 *
 * `/api/uploadthing(.*)` is the second entry, and it is here for exactly the
 * trap named below: the route's file router calls `auth()` in its
 * `.middleware()` to decide whether the caller may upload (ADR 010). Clerk
 * cannot populate a request this file never saw, and the symptom of forgetting
 * is an error about `clerkMiddleware` not being detected rather than anything
 * that points at the upload route. Matching it does **not** protect it — see
 * `UNPROTECTED_PATHS` above for why it must not be.
 *
 * `/api/native/upload(.*)` is equally narrow but serves a different protocol:
 * Clerk derives context from the iOS bearer token, then the route handler's
 * `auth()` check returns the API's stable JSON response. It must not widen to
 * all `/api` routes; `/api/ask` is intentionally public and UploadThing has its
 * own callback authentication.
 *
 * The corollary still holds: **the day something else needs `auth()` or
 * `currentUser()`, this matcher has to widen first.**
 *
 * Must stay a literal — Next statically analyses this at build time and ignores
 * anything computed.
 */
export const config = {
  matcher: [
    "/admin(.*)",
    "/api/uploadthing(.*)",
    "/api/native/upload(.*)",
  ],
};
