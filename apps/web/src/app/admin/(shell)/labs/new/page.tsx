import type { Metadata } from "next";

import { AdminPage, AdminPageHeader, ConvexGate } from "@/components/admin";

import { LabForm } from "../LabForm";

/**
 * `/admin/labs/new` — curate a Lab in.
 *
 * `row={null}` puts `LabForm` in create mode; it navigates to
 * `/admin/labs/<slug>` once the document exists.
 *
 * ⚠️ A static segment beats a dynamic one in Next's matcher, so this file wins
 * over `[slug]/page.tsx` at `/admin/labs/new` — a Lab whose slug is literally
 * `new` would be uneditable here. Same trade as `/admin/projects/new`: not worth a
 * rule in three places to prevent something nobody will type.
 */
export const metadata: Metadata = {
  title: "New Lab — admin",
};

export default function NewLabPage() {
  return (
    <AdminPage>
      <AdminPageHeader
        title="New Lab"
        back={{ href: "/admin/labs", label: "Labs" }}
        info={
          <>
            Created as a draft. A Lab needs a repo (a repo is what makes it a Lab
            rather than a case study) and a cover image — the imagery is the
            point, not an afterthought. The GitHub numbers arrive from the cron.
          </>
        }
      />

      <ConvexGate>
        <LabForm row={null} />
      </ConvexGate>
    </AdminPage>
  );
}
