import type { Metadata } from "next";

import { AdminPage, AdminPageHeader, ConvexGate } from "@/components/admin";

import { EntryEditor } from "../EntryEditor";

/**
 * `/admin/experience/new` — add a role.
 *
 * A **server** component; the form is `EntryEditor` with no id, which is the same
 * component the edit route renders. A successful create navigates to
 * `/admin/experience/<id>`, so this URL is never a place you can save twice.
 *
 * There is no `sortOrder` field on the form: `experienceEntries.create` defaults it
 * to one below the current lowest — the top of the résumé — because the role being
 * added is almost always the one just started. Reordering is the ↑/↓ buttons on the
 * list screen.
 */
export const metadata: Metadata = {
  title: "New role — admin",
};

export default function NewExperiencePage() {
  return (
    <AdminPage>
      <AdminPageHeader
        title="Add a role"
        back={{ href: "/admin/experience", label: "Experience" }}
        info={
          <>
            Inserted at the top of the résumé. Saving it rebuilds the
            résumé&rsquo;s work history in the same transaction — there is no
            separate publish step, because there is no draft state on this table.
          </>
        }
      />

      <ConvexGate>
        <EntryEditor entryId={null} />
      </ConvexGate>
    </AdminPage>
  );
}
