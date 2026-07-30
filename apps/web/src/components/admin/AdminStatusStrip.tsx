"use client";

import { useAdminConfig } from "./AdminConfig";
import { useConvexReady } from "./useConvexReady";

/**
 * Two lines at the bottom of the sidebar saying which backing services this
 * deployment actually has.
 *
 * This is not decoration. Every admin screen degrades quietly when a service is
 * absent — tables render empty, buttons disable, uploads refuse — and quiet
 * degradation is indistinguishable from "broken" unless something says which it
 * is. One glance answers "is the data missing or is the backend missing", which
 * is the first question every time.
 *
 * Hidden below the sidebar's breakpoint along with the rest of `.adm-side-foot`:
 * on a narrow screen the sidebar is a horizontal strip and there is no room, and
 * the answer is also visible on any page that tries to read data.
 */
export function AdminStatusStrip() {
  const convexReady = useConvexReady();
  const { uploadsEnabled } = useAdminConfig();

  return (
    <dl className="adm-status">
      <div>
        <dt>convex</dt>
        <dd data-ok={convexReady ? "true" : "false"}>
          {convexReady ? "connected" : "absent"}
        </dd>
      </div>
      <div>
        <dt>uploads</dt>
        <dd data-ok={uploadsEnabled ? "true" : "false"}>
          {uploadsEnabled ? "enabled" : "absent"}
        </dd>
      </div>
    </dl>
  );
}
