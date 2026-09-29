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
 *
 * ── One route, no browser sessions ─────────────────────────────────────────
 *
 * The browser admin and its sign-in page are gone: content is managed through
 * the MCP server (packages/mcp), which authenticates with its own scoped
 * management credentials against Convex and never touches this app. The only
 * route left that reads a Clerk identity is the iOS upload endpoint.
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
 * Clerk context for `/api/native/upload`, and nothing else.
 *
 * The iOS client sends a Clerk session JWT in the Authorization header.
 * Matching the route lets Clerk populate `auth()` from that bearer token; the
 * route performs its own check so it can return stable JSON 401 and 503
 * responses instead of Proxy's redirect/404 semantics. So the handler does not
 * call `protect()` — it only has to exist for `auth()` to work downstream.
 *
 * The unconfigured branch exists because `clerkMiddleware`'s handler throws on
 * a missing publishable key the first time it sees a request.
 * `NextResponse.next()` is the honest no-op: the route then answers 503 itself.
 */
export const proxy: NextMiddleware = clerkConfigured
  ? clerkMiddleware()
  : () => NextResponse.next();

/**
 * Which requests reach this file at all.
 *
 * Without a `matcher` a proxy runs on *everything* — `_next/static`, image
 * optimisation, `public/` assets. Only one route here calls `auth()`, so the
 * positive form is both shorter and strictly better: the public site never
 * enters this code path, which is precisely the independence ADR 006 asks for.
 * It must not widen to all `/api` routes; `/api/ask` is intentionally public.
 *
 * The corollary still holds: **the day something else needs `auth()` or
 * `currentUser()`, this matcher has to widen first.**
 *
 * Must stay a literal — Next statically analyses this at build time and ignores
 * anything computed.
 */
export const config = {
  matcher: ["/api/native/upload(.*)"],
};
