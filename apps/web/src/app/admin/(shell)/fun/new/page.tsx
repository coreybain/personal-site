import type { Metadata } from "next";

import { AdminPage, AdminPageHeader, ConvexGate } from "@/components/admin";

import { NewFunEntryForm } from "./NewFunEntryForm";

/**
 * `/admin/fun/new` — the create screen.
 *
 * A static segment, so it is matched before the sibling `[id]` route. Nothing else
 * distinguishes it from the editor structurally: furniture, gate, client form.
 *
 * The header is deliberately thin here. The fact that matters on this screen — that
 * saving puts a photo straight onto the public grid with no draft step — is **not**
 * in the tip: it is the `AdminNotice` at the top of the form, which is the one place
 * a reader cannot miss it and the one fact on this screen they have to act on. The
 * tip holds only what the fields are.
 *
 * No `ViewOnSite` either: nothing exists yet, so there is nothing to view. The
 * editor gets one the moment the entry is created and this form redirects to it.
 */
export const metadata: Metadata = {
  title: "New fun entry — admin",
};

export default function NewFunEntryPage() {
  return (
    <AdminPage>
      <AdminPageHeader
        title="New entry"
        back={{ href: "/admin/fun", label: "Fun entries" }}
        info={
          <>
            A photo, what it was, and when it happened. The kind picker decides the
            rest: a walk carries steps and distance, everything else carries a note.
          </>
        }
      />

      <ConvexGate>
        <NewFunEntryForm />
      </ConvexGate>
    </AdminPage>
  );
}
