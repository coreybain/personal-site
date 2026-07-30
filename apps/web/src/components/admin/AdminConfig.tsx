"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

/**
 * Deployment facts the browser cannot work out for itself.
 *
 * There is exactly one so far, and it is here because of an asymmetry worth
 * spelling out. `useConvexReady()` can answer its own question from
 * `NEXT_PUBLIC_` variables, because both of Convex's client-side inputs are
 * public by necessity. UploadThing's input is not: `UPLOADTHING_TOKEN` is a
 * secret that authorises writes to the CDN, so it is read from the process on the
 * server and never inlined into a bundle.
 *
 * That leaves the browser unable to tell "uploads are off" from "uploads are on
 * and the first request will fail". The options were:
 *
 *   1. A second, public mirror variable (`NEXT_PUBLIC_UPLOADTHING_ENABLED`).
 *      Rejected: two variables that must agree, with no mechanism to make them,
 *      is a configuration bug waiting to be filed as a component bug.
 *   2. Probe the route on mount. Rejected: a network round trip on every admin
 *      page to render a disabled state, and a flash of the wrong state first.
 *   3. Read it on the server, where the truth is, and hand it down. This.
 *
 * The value is serialised into the RSC payload once, by the admin layout, so the
 * server render and hydration cannot disagree.
 *
 * ── Adding a fact ──────────────────────────────────────────────────────────
 *
 * Only for values that are (a) knowable only on the server and (b) needed by a
 * client component to decide what to render. Anything public belongs in a
 * `NEXT_PUBLIC_` variable read directly at its point of use, which is one fewer
 * indirection and impossible to forget to provide.
 */
export type AdminConfig = {
  /**
   * `true` when `UPLOADTHING_TOKEN` is set on the server (ADR 010).
   *
   * `false` disables `ImageUpload`'s dropzone and replaces it with an
   * explanation. It does **not** disable the alt-text or sanitised controls for
   * media that already exists: an asset uploaded from iOS, or one already in a
   * document, is still editable on a deployment that cannot accept new uploads.
   */
  uploadsEnabled: boolean;
};

/**
 * Defaults to "nothing is configured", which is both the honest answer for a
 * component rendered outside the admin layout and the safe one: a disabled
 * uploader is a nuisance, an enabled uploader pointing at a 503 is a bug report.
 */
const FALLBACK: AdminConfig = { uploadsEnabled: false };

const AdminConfigContext = createContext<AdminConfig>(FALLBACK);

export function AdminConfigProvider({
  children,
  uploadsEnabled,
}: Readonly<{ children: ReactNode; uploadsEnabled: boolean }>) {
  /* Memoised so the context value is referentially stable across re-renders of
     the layout; without it every admin page re-renders whenever the layout does. */
  const value = useMemo<AdminConfig>(() => ({ uploadsEnabled }), [uploadsEnabled]);

  return (
    <AdminConfigContext.Provider value={value}>
      {children}
    </AdminConfigContext.Provider>
  );
}

/** Read the deployment facts. Safe outside the provider — returns all-false. */
export function useAdminConfig(): AdminConfig {
  return useContext(AdminConfigContext);
}
