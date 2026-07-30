import type { Metadata } from "next";
import Link from "next/link";

import {
  AdminPage,
  AdminPageHeader,
  ConvexGate,
  ViewOnSite,
} from "@/components/admin";

import { ExperienceTable } from "./ExperienceTable";

/**
 * `/admin/experience` — the roles the résumé's work history is built from.
 *
 * A **server** component, thin by the kit's composition rule: the header and the
 * "Add a role" link render without a backend, so a zero-env clone shows a page a
 * human can read and navigate. Everything that reads or writes is inside
 * `ExperienceTable`, below the gate.
 *
 * ── This table is one half of a pair ────────────────────────────────────────
 *
 * `experienceEntries` is the normalised, editable source — machine dates
 * (`YYYY-MM-DD`), skills, `sortOrder`, links to case studies.
 * `resumeDocument.experience` is the render-ready projection of it, and **every
 * write here rebuilds that projection in the same transaction**, so `/resume`, the
 * PDF and `/about` cannot print different work histories. Nothing on this screen
 * writes the projection directly; nothing can.
 *
 * The public path to this data is `resume.get`, which returns the projection in one
 * document read. Every read in `convex/experienceEntries.ts` is admin-only —
 * exposing the rows as well would create a second public shape of the same facts,
 * which is exactly how a page and a PDF start disagreeing.
 *
 * Which is also why the "View on site" link points at `/resume` rather than at
 * anything of this section's own: these rows have no public page, and the résumé is
 * where they surface.
 */
export const metadata: Metadata = {
  title: "Experience — admin",
};

export default function ExperiencePage() {
  return (
    <AdminPage>
      <AdminPageHeader
        eyebrow="Profile"
        title="Experience"
        info={
          <>
            Roles in print order — <strong>newest first</strong>, which is the
            lowest sort order, so the numbers drift negative and leave gaps and are
            only ever compared to each other. Every save rebuilds the
            résumé&rsquo;s work history in the same transaction, and there is no
            draft state: a role is either on the résumé or deleted.
          </>
        }
        actions={
          <>
            <ViewOnSite href="/resume" label="View résumé" />
            <Link
              href="/admin/experience/new"
              className="adm-btn"
              data-variant="primary"
            >
              Add a role
            </Link>
          </>
        }
      />

      <ConvexGate>
        <ExperienceTable />
      </ConvexGate>
    </AdminPage>
  );
}
