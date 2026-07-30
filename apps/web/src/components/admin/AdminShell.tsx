import type { ReactNode } from "react";

import { ThemeToggle } from "@/components/theme";

import { AdminBreadcrumb } from "./AdminBreadcrumb";
import { AdminNav } from "./AdminNav";
import { AdminSignOut } from "./AdminSignOut";
import { AdminStatusStrip } from "./AdminStatusStrip";
import { ViewSiteLink } from "./ViewOnSite";

/**
 * The admin's chrome: a sidebar of sections and a topbar of context.
 *
 * A **server** component. Everything that needs the browser is a leaf below it —
 * `AdminNav` (pathname), `AdminBreadcrumb` (pathname), `ThemeToggle` (the theme
 * scope), `AdminSignOut` (Clerk). Keeping the shell itself on the server is what
 * lets the sidebar's structure and the section list ship as HTML rather than as
 * a component tree the browser has to build before anything appears.
 *
 * Rendered by `src/app/admin/(shell)/layout.tsx` and nowhere else. It persists
 * across navigations between admin pages, so the sidebar's scroll position and
 * the theme survive a route change.
 */
export function AdminShell({
  children,
  /**
   * Whether a Clerk session is possible at all. `false` on a deployment with no
   * keys, which is every deployment today — the shell then omits the sign-out
   * control (there is nothing to sign out of) and the layout above renders its
   * "auth is not configured" notice.
   */
  authConfigured,
}: Readonly<{ children: ReactNode; authConfigured: boolean }>) {
  return (
    <div className="adm-shell">
      <aside className="adm-side">
        {/* The mark is a link home rather than a logo: from inside the admin the
            useful "up" is the public site, not the dashboard, which the nav's
            first item already covers.

            A plain <a> rather than <Link>, which is why the lint rule is
            silenced here and nowhere else. `next/link` would soft-navigate:
            React stays mounted, and the admin's client graph — Clerk, the Convex
            socket, UploadThing — stays live in memory while the reader browses
            the public site. That is the exact coupling ADR 006 and the root
            layout's docblock exist to prevent, and it also means a Convex
            subscription keeps a WebSocket open on a page that has no business
            holding one. A document load is the clean boundary: the admin ends
            when you leave it. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="adm-brand">
          <span className="adm-brand-mark" aria-hidden="true">
            cb
          </span>
          <span>
            <span className="adm-brand-name">Admin</span>
            <br />
            <span className="adm-brand-sub">coreybaines.com</span>
          </span>
        </a>

        <AdminNav />

        <div className="adm-side-foot">
          <AdminStatusStrip />
        </div>
      </aside>

      <div className="adm-main">
        <header className="adm-topbar">
          <AdminBreadcrumb />

          {/* Right cluster: the controls that are about the *session* rather
              than about the current page. "View site" leads because it is the
              one you reach for constantly — every edit ends with checking the
              live page — and it opens a new tab, so unlike the brand mark it
              never costs you the form you were in the middle of. */}
          <div className="adm-topbar-end">
            <ViewSiteLink />
            <ThemeToggle className="adm-theme-toggle" />
            {authConfigured ? <AdminSignOut /> : null}
          </div>
        </header>

        {children}
      </div>
    </div>
  );
}
