import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AdminConfigProvider } from "@/components/admin/AdminConfig";
import { ConvexClientProvider } from "@/components/auth";
import { ThemeScope } from "@/components/theme/ThemeScope";

import "./admin.css";

/**
 * The /admin route group's outer layout — **the one and only place
 * `ConvexClientProvider` is mounted.**
 *
 * ── Why here and nowhere else ───────────────────────────────────────────────
 *
 * `ConvexClientProvider` used to wrap the whole tree from the root layout, which
 * is what an auth provider normally does and was wrong here. `@clerk/nextjs` and
 * `convex/react-clerk` are static imports inside a `"use client"` module, so they
 * land in the client graph of every route the provider wraps — measured at
 * **+76 KB gzip** on the homepage, against a < 100 KB budget that phase 3
 * enforces in CI, for a provider that rendered nothing because the keys are
 * unset. Unset `NEXT_PUBLIC_` variables stay runtime `process.env` lookups
 * rather than being inlined, so no arrangement of the gate lets dead-code
 * elimination drop the imports; the only fix is structural. See the docblocks in
 * `src/app/layout.tsx` and `src/components/auth/ConvexClientProvider.tsx`, which
 * both describe this file before it existed.
 *
 * The corollary, and the rule to enforce in review: **nothing under `src/app/(site)`
 * may import from `src/components/auth` or from `src/components/admin`.** If a
 * public page ever needs live Convex data, give it a Convex client without Clerk
 * rather than dragging the auth SDK back into the shared chunk.
 *
 * Mounted inside `<body>` (the root layout owns `<html>`), which Clerk v7
 * (Core 3) requires and which is also incompatible-by-design with wrapping
 * `<html>` under Next's cache components.
 *
 * ── Why this layout does not gate ───────────────────────────────────────────
 *
 * There is no `auth()` check here. The gate lives one level down, in
 * `(shell)/layout.tsx`, because `/admin/sign-in` is a child of *this* layout and
 * must render for a signed-out visitor — a gate here would redirect the sign-in
 * page to itself. So this layout owns the things every admin route needs
 * regardless of session (the provider, the theme scope, the stylesheet) and the
 * `(shell)` group owns the things only a signed-in route needs (the gate, the
 * sidebar, the topbar).
 *
 * ── Layering ────────────────────────────────────────────────────────────────
 *
 *   ConvexClientProvider   Clerk → Convex, or nothing at all when unconfigured
 *     ThemeScope           the `.hor .adm` element: `data-theme` + the token layer
 *       AdminConfigProvider  server-only deployment facts (see AdminConfig.tsx)
 *         children         either `/admin/sign-in` or the `(shell)` group
 *
 * `ThemeScope` carries **both** classes and that is deliberate: `.hor` is what
 * makes every `--hor-*` token resolve (they are declared on `.hor[data-theme]` in
 * @home/ui/tokens.css), and `.adm` is what `admin.css` scopes itself to. The
 * admin borrows the site's palette and writes its own components — it does not
 * import `horizon.css`. See the header of `admin.css`.
 */

/**
 * Kept out of search results, belt and braces.
 *
 * `/admin` is already behind Clerk in any configured deployment, so a crawler
 * could not read it. But a zero-env preview deployment has no Clerk, renders the
 * shell, and would otherwise be indexable — and "coreybaines.com/admin" showing
 * up in a search result is a bad look even when the pages behind it are empty.
 */
export const metadata: Metadata = {
  title: "Admin — coreybaines.com",
  robots: { index: false, follow: false },
};

/**
 * Rendered per request, never prerendered.
 *
 * Two reasons, and the second is the subtle one:
 *
 *   1. Every page below reads a session. A prerendered admin page is a page
 *      whose auth decision was made at build time, which is not a decision.
 *
 *   2. `UPLOADTHING_TOKEN` is read below. Under static prerendering that read
 *      happens at *build* time, so a deployment built without the token and
 *      later given one would keep showing uploads as unavailable until the next
 *      build. Forcing dynamic rendering makes it a cold-start read, which is
 *      what an operator expects when they set an environment variable.
 *
 * Valid because Cache Components are not enabled in `next.config.ts`; under
 * `cacheComponents` this export is removed and the equivalent is reached by not
 * marking anything cacheable.
 */
export const dynamic = "force-dynamic";

export default function AdminLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  /**
   * Server-side read, handed to the browser as a boolean rather than a value.
   * The token itself must never cross this boundary — see `AdminConfig.tsx` for
   * why the browser is told about it at all.
   */
  const uploadsEnabled = Boolean(process.env.UPLOADTHING_TOKEN);

  return (
    <ConvexClientProvider>
      <ThemeScope className="hor adm" defaultTheme="dark">
        <AdminConfigProvider uploadsEnabled={uploadsEnabled}>
          {children}
        </AdminConfigProvider>
      </ThemeScope>
    </ConvexClientProvider>
  );
}
