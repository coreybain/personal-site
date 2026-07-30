import type { Metadata } from "next";

import { AdminPage, AdminPageHeader, ConvexGate } from "@/components/admin";

import { ProjectForm } from "../ProjectForm";

/**
 * `/admin/projects/new` — create a case study.
 *
 * `row={null}` is what puts `ProjectForm` in create mode; the form navigates to
 * `/admin/projects/<slug>` once the document exists, so this route is only ever
 * visited empty.
 *
 * ⚠️ A static segment beats a dynamic one in Next's matcher, so this file wins
 * over `[slug]/page.tsx` at `/admin/projects/new`. The consequence: a case study
 * whose slug is literally `new` would be uneditable from the admin. Left as-is
 * rather than guarded — `new` is not a plausible case-study slug, and a rule
 * banning it would live in three places (here, `SlugField`, the mutation) to
 * prevent something nobody will type.
 */
export const metadata: Metadata = {
  title: "New case study — admin",
};

export default function NewProjectPage() {
  return (
    <AdminPage>
      <AdminPageHeader
        title="New case study"
        back={{ href: "/admin/projects", label: "Case studies" }}
        info={
          <>
            Created as a draft. The narrative trio (problem, approach, outcomes)
            is optional — a title, a client, an attribution line and a summary
            are the minimum a card can render from.
          </>
        }
      />

      <ConvexGate>
        <ProjectForm row={null} />
      </ConvexGate>
    </AdminPage>
  );
}
