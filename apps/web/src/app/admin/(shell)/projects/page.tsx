import type { Metadata } from "next";
import Link from "next/link";

import {
  AdminPage,
  AdminPageHeader,
  ConvexGate,
  ViewOnSite,
} from "@/components/admin";

import { ProjectsTable } from "./ProjectsTable";

/**
 * `/admin/projects` — the case-study list.
 *
 * A **server** component, and deliberately thin: the header, the two title-row
 * affordances, and a gate around the one client component that talks to Convex.
 * The composition order is the kit's rule — furniture outside `<ConvexGate>`,
 * hooks inside it — so a deployment with no Convex and no Clerk still renders a
 * titled page with working navigation instead of a blank rectangle.
 *
 * The `<h1>` is `AdminPageHeader`'s. There is not a second one.
 *
 * The paragraph that used to sit under the title is now `info`: it explains what
 * the screen is (ADR 008, ADR 009) rather than telling anyone to do something, so
 * by README §2a it belongs behind the icon. The ADR-009 text that *is* actionable
 * — the per-row "publish blocked" line and the form's blocker panel — is
 * unchanged and still inline.
 */
export const metadata: Metadata = {
  title: "Case studies — admin",
};

export default function AdminProjectsPage() {
  return (
    <AdminPage>
      <AdminPageHeader
        eyebrow="Content"
        title="Case studies"
        info={
          <>
            Client and employer work: always attributed, always sanitised, never
            repo-linked (ADR 008). Everything is created as a draft — publishing
            is a separate action, and it is refused while any screenshot is
            unmarked (ADR 009).
          </>
        }
        actions={
          <>
            {/* The list's public counterpart. No `published` — a route cannot be
                a draft; that argument is per-row and lives on the editor. */}
            <ViewOnSite href="/work" />

            <Link
              href="/admin/projects/new"
              className="adm-btn"
              data-variant="primary"
            >
              New case study
            </Link>
          </>
        }
      />

      <ConvexGate>
        <ProjectsTable />
      </ConvexGate>
    </AdminPage>
  );
}
