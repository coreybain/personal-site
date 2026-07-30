import type { Metadata } from "next";
import Link from "next/link";

import {
  AdminPage,
  AdminPageHeader,
  ConvexGate,
  ViewOnSite,
} from "@/components/admin";

import { LabsTable } from "./LabsTable";

/**
 * `/admin/labs` — the Labs list.
 *
 * A **server** component: header and gate, with the one client component that
 * talks to Convex inside it. Furniture outside the gate is the kit's composition
 * rule and the reason a zero-env clone still renders a titled, navigable page.
 *
 * The prose that used to sit under the title is `info` — it says what a Lab is
 * and which slice of a row the cron owns, neither of which is something a reader
 * has to act on before touching this screen (README §2a).
 */
export const metadata: Metadata = {
  title: "Labs — admin",
};

export default function AdminLabsPage() {
  return (
    <AdminPage>
      <AdminPageHeader
        eyebrow="Content"
        title="Labs"
        info={
          <>
            Repos built for their own sake — no client, no invoice — curated in by
            hand (ADR 014) rather than synced from a GitHub account. Stars, forks
            and commit counts are written by an hourly cron; everything else on a
            Lab is editorial and survives the refresh.
          </>
        }
        actions={
          <>
            {/* `/labs` is the grid, and it is the only public Labs route that
                exists — there is no `/labs/[slug]` page in `src/app/(site)`. */}
            <ViewOnSite href="/labs" />

            <Link
              href="/admin/labs/new"
              className="adm-btn"
              data-variant="primary"
            >
              New Lab
            </Link>
          </>
        }
      />

      <ConvexGate>
        <LabsTable />
      </ConvexGate>
    </AdminPage>
  );
}
