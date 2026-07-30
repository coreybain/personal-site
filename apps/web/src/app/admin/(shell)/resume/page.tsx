import type { Metadata } from "next";

import {
  AdminPage,
  AdminPageHeader,
  ConvexGate,
  ViewOnSite,
} from "@/components/admin";

import { ResumeEditor } from "./ResumeEditor";

/**
 * `/admin/resume` — the Resume Document singleton (ADR 011, ADR 012).
 *
 * A **server** component, thin by the kit's composition rule: the header renders
 * without a backend, so a zero-env clone shows a page that explains the two-table
 * flow rather than a blank rectangle. Everything that reads or writes is inside
 * `ResumeEditor`, below the gate.
 *
 * ── The one thing to understand before editing here ─────────────────────────
 *
 * The résumé's work history is **not authored on this screen.** It is a projection
 * of the `experienceEntries` table, rebuilt inside every write to that table, and
 * `resume.upsert` has no `experience` argument at all — so there is no way to write
 * it from a browser, from iOS, or by accident. Roles are edited at
 * `/admin/experience`; this screen owns the summary, the capabilities, the
 * education rows and the PDF flag, and offers the rebuild button for the cases the
 * automatic chain cannot cover (a restored backup, rows imported straight into the
 * table, entries authored before the singleton existed).
 *
 * The header's `info` says so, because the failure mode of saying it nowhere is
 * someone looking for an "add a role" button on this page and concluding the admin
 * is broken. It is chrome rather than judgement — nothing is lost by learning it a
 * hover later — so it is a tooltip and not a paragraph. What this screen must
 * *not* leave to a hover is the projection having actually drifted, and that stays
 * an inline notice inside `ResumeEditor`.
 */
export const metadata: Metadata = {
  title: "Résumé — admin",
};

export default function ResumePage() {
  return (
    <AdminPage>
      <AdminPageHeader
        eyebrow="Profile"
        title="Résumé"
        info={
          <>
            The single document that <code>/resume</code> and the generated PDF
            both render (ADR 011). The summary, capabilities, education and PDF
            flag are authored here; the <strong>work history is not</strong> — it
            is rebuilt from the experience entries on every write to them, so roles
            are edited at <code>/admin/experience</code> and appear here by
            themselves.
          </>
        }
        actions={<ViewOnSite href="/resume" />}
      />

      <ConvexGate>
        <ResumeEditor />
      </ConvexGate>
    </AdminPage>
  );
}
