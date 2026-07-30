"use client";

import { AuthLoading, Authenticated, Unauthenticated } from "convex/react";
import Link from "next/link";
import type { ReactNode } from "react";

import { CONVEX_READY } from "./useConvexReady";

/**
 * The wrapper every data-reading subtree in the admin goes inside.
 *
 * **If a component calls `useQuery` or `useMutation`, one of its ancestors must
 * be a `<ConvexGate>`.** It guards two independent failures, and both of them
 * present as a crashed page rather than as a message:
 *
 * ── 1. There may be no Convex client at all ─────────────────────────────────
 *
 * No Convex deployment and no Clerk application are provisioned yet, and the repo
 * builds and renders with zero environment variables set. Under that rule
 * `ConvexClientProvider` mounts *no provider*, so `useQuery` has no client in
 * context and throws the moment it runs. React forbids calling a hook
 * conditionally, so a component cannot decide to skip its own query — the
 * decision has to happen one level up, by not mounting the component. That is
 * what the `CONVEX_READY` branch below is.
 *
 * ── 2. The client may not be authenticated *yet* ────────────────────────────
 *
 * This is the subtle one, and it is why `<Authenticated>` is here rather than
 * left to callers. Almost every admin query is admin-only and throws
 * `ConvexError({ code: 'unauthenticated' })` without an identity. The `(shell)`
 * layout already proved there is a Clerk session server-side — but the *browser's*
 * Convex client authenticates asynchronously: `ConvexProviderWithClerk` has to
 * fetch a `convex` JWT template token before the socket carries an identity. A
 * query issued in that window runs unauthenticated and throws, and a throw during
 * render is an error boundary, not an empty table.
 *
 * `<Authenticated>` renders children only once the client holds a token, so the
 * window simply does not contain any queries. The three states are all handled:
 *
 *   AuthLoading      the token fetch is in flight — a moment, usually
 *   Authenticated    the normal case
 *   Unauthenticated  the session went away mid-visit (expired, signed out in
 *                    another tab). The server-side gate cannot catch that
 *                    without a navigation, so it is said here.
 *
 * ── Composition rule for pages ──────────────────────────────────────────────
 *
 * Page furniture goes **outside** the gate; hooks go **inside** it:
 *
 * ```tsx
 * export default function ProjectsPage() {
 *   return (
 *     <AdminPage>
 *       <AdminPageHeader title="Case studies" info="…" />
 *       <ConvexGate>
 *         <ProjectsTable />
 *       </ConvexGate>
 *     </AdminPage>
 *   );
 * }
 * ```
 *
 * The header outside means a zero-env deployment still renders a page with a
 * title, a description and working navigation, rather than a blank rectangle.
 */
export function ConvexGate({
  children,
  /**
   * Replaces the standard "no backend" notice. Pass `null` to render nothing —
   * right for a widget that is decoration rather than content. Only affects the
   * *unconfigured* case; the auth states below always render.
   */
  fallback,
}: Readonly<{ children: ReactNode; fallback?: ReactNode }>) {
  if (!CONVEX_READY) {
    return fallback === undefined ? <ConvexNotConfigured /> : fallback;
  }

  return (
    <>
      <Authenticated>{children}</Authenticated>

      <AuthLoading>
        <p className="adm-micro" role="status">
          Connecting…
        </p>
      </AuthLoading>

      <Unauthenticated>
        <div className="adm-notice" data-tone="warn">
          <div>
            <p className="adm-notice-title">Session expired</p>
            <p className="adm-micro">
              The browser no longer holds a valid identity, so nothing here can
              read or write. <Link href="/admin/sign-in">Sign in again</Link> —
              unsaved edits on this page will be lost.
            </p>
          </div>
        </div>
      </Unauthenticated>
    </>
  );
}

/**
 * The standard "there is no backend yet" notice.
 *
 * Exported so a page can place it somewhere other than where the gate would, and
 * so the wording lives in one file. It names the variables rather than saying
 * "not configured", because the reader of this message is almost always the
 * person who can fix it.
 */
export function ConvexNotConfigured() {
  return (
    <div className="adm-notice" data-tone="info">
      <div>
        <p className="adm-notice-title">No Convex backend configured</p>
        <p className="adm-micro">
          This screen reads and writes live data. Set{" "}
          <code>NEXT_PUBLIC_CONVEX_URL</code> and{" "}
          <code>NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code> in{" "}
          <code>apps/web/.env.local</code>, then restart the dev server — both are
          inlined at build time, so a restart is required rather than a reload. See{" "}
          <code>apps/web/.env.example</code>.
        </p>
      </div>
    </div>
  );
}
