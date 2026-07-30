import type { Metadata } from "next";

import { AdminPage, AdminPageHeader, ConvexGate } from "@/components/admin";

import { EntryEditor } from "../EntryEditor";

/**
 * `/admin/experience/[id]` — edit one role.
 *
 * A **server** component. `params` is a **promise** in this version of Next and has
 * to be awaited (it was synchronous up to 14, and the compatibility shim is on its
 * way out) — see `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`.
 *
 * The id is passed down as a plain string and cast to `Id<'experienceEntries'>` at
 * the one call site that needs it. There is nothing to validate here: a malformed id
 * is refused by Convex's own argument validation, and a well-formed id for a deleted
 * row resolves to `null`, which `EntryEditor` renders as "that role is gone".
 *
 * `dynamic = "force-dynamic"` is inherited from `src/app/admin/layout.tsx`, so this
 * route is never prerendered and needs no `generateStaticParams`.
 */
export const metadata: Metadata = {
  title: "Edit role — admin",
};

export default async function EditExperiencePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <AdminPage>
      <AdminPageHeader
        title="Edit role"
        back={{ href: "/admin/experience", label: "Experience" }}
        info={
          <>
            Saving rebuilds the résumé&rsquo;s work history in the same transaction,
            so <code>/resume</code> and the PDF follow immediately. Position in the
            résumé is not edited here — use the ↑/↓ buttons on the list.
          </>
        }
      />

      <ConvexGate>
        <EntryEditor entryId={id} />
      </ConvexGate>
    </AdminPage>
  );
}
