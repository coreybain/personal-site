"use client";

import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import type { ReactNode } from "react";

/**
 * The two public keys that decide whether authenticated Convex exists at all.
 *
 * Both are `NEXT_PUBLIC_`, so Next inlines them into this client bundle at
 * build time. That is the point: the gate below is a build-time constant, which
 * means the server render and the browser hydration always agree on which
 * branch was taken. A runtime-only check would risk a hydration mismatch.
 *
 * Unset variables inline as `undefined` rather than the empty string, hence the
 * plain truthiness checks.
 */
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

/**
 * One client per browser tab, created at module scope rather than in the
 * component.
 *
 * `ConvexReactClient` owns a WebSocket and a query cache. Constructing it
 * during render would hand every re-render a fresh connection and throw away
 * the cache; module scope gives it the process lifetime it expects. Convex's
 * own Next.js guide does exactly this.
 *
 * The constructor is cheap and opens nothing — the socket is dialled on the
 * first subscription, in the browser only — so it is safe to evaluate during a
 * server render too.
 *
 * `null` when unconfigured, because the constructor throws on a missing URL and
 * there is nothing useful to build yet.
 */
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

/**
 * Clerk → Convex, or nothing at all (ADR 006).
 *
 * ── Where this belongs ─────────────────────────────────────────────────────
 *
 * **In the `/admin` layout, and nowhere else.** It is not mounted anywhere
 * today, on purpose: phase 2 creates `/admin` and mounts it there, inside
 * `<body>`.
 *
 * It used to wrap the whole tree from the root layout, which is what an auth
 * provider normally does and is wrong here. The `@clerk/nextjs` and
 * `convex/react-clerk` imports above are static inside a `"use client"` module,
 * so they land in the client graph of every route the provider wraps whether or
 * not the gate below takes the branch — measured at **+76 KB gzip**, one 76.6 KB
 * chunk loaded by the homepage, against a < 100 KB budget that phase 3 enforces
 * in CI. Unset `NEXT_PUBLIC_` variables are *not* inlined by Turbopack (they
 * stay runtime `process.env` lookups), so no amount of rearranging the gate lets
 * dead-code elimination drop the imports, and lazy-loading is not the answer
 * either: a `next/dynamic` boundary around the whole tree hands the crawler an
 * empty shell. The only fix is to mount it below the public site, which is also
 * exactly what ADR 006 describes — "the public site does not depend on it".
 *
 * The nesting order is not a style choice: `ConvexProviderWithClerk` calls
 * Clerk's `useAuth` to mint the `convex` JWT template token, so it must sit
 * *inside* `ClerkProvider` or the hook has no context to read and Convex never
 * receives a token. Convex's docs call this out explicitly.
 *
 * **The degradation path is the load-bearing part of this file.** No Clerk or
 * Convex project exists yet, and the public site must not depend on either
 * (ADR 006: "a Clerk outage cannot take the site down — only editing"). With
 * the keys absent this component renders `children` and no provider, no
 * client, and no network call — the tree is byte-identical to not having wired
 * anything. Half-configured is treated as unconfigured on purpose: a
 * `ClerkProvider` without a Convex URL, or a Convex client with no way to
 * authenticate, is a runtime error waiting for the first admin page rather
 * than a useful partial state.
 *
 * Note on cost, because it is not zero. The `@clerk/nextjs` and
 * `convex/react-clerk` imports above are static, so their code lands in the
 * client graph of every route this provider wraps whether or not the branch is
 * taken — measured at **+76 KB gzip on the homepage** (215 KB → 294 KB across
 * its chunks). Unset `NEXT_PUBLIC_` variables are *not* inlined by Turbopack,
 * they stay as runtime `process.env` lookups, so no amount of arranging this
 * gate will let dead-code elimination remove the imports.
 *
 * Lazy-loading it is not the answer either: the provider wraps the entire tree,
 * so a `next/dynamic` boundary here would put the whole page behind Suspense
 * and hand the crawler an empty shell. The real fix is structural and belongs
 * to phase 2 — `/admin` gets its own layout, and this provider moves down to
 * it, which is also what ADR 006 describes ("the public site does not depend on
 * it"). Until the keys exist the code is inert, so this is a budget item to
 * settle before launch rather than a bug.
 */
export function ConvexClientProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  if (!convex || !clerkPublishableKey) {
    return children;
  }

  return (
    <ClerkProvider publishableKey={clerkPublishableKey}>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        {children}
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
