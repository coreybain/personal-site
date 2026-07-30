import type { Metadata } from "next";

import {
  AdminPage,
  AdminPageHeader,
  ConvexGate,
  ViewOnSite,
} from "@/components/admin";

import { FunEditor } from "./FunEditor";

/**
 * `/admin/fun/[id]` — the entry editor.
 *
 * `params` is a promise in this version of Next and is awaited, which is why the
 * component is `async` (it was a plain object up to 14; the synchronous access that
 * still worked in 15 is gone).
 *
 * The id is passed down as a `string` and cast inside the client component, not
 * here: a server component cannot check it either, and the cast belongs next to the
 * query that consumes it. See `FunEditor`'s header.
 *
 * `ViewOnSite` points at `/fun` rather than at a per-entry URL because there is no
 * per-entry URL — `funEntries` has no slug and /fun is a grid, which is the same
 * reason this route is keyed on an id. No `published` prop: the table has no such
 * field, and passing `published={true}` to say so would imply the opposite is
 * expressible.
 */
export const metadata: Metadata = {
  title: "Edit fun entry — admin",
};

export default async function EditFunEntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <AdminPage>
      <AdminPageHeader
        title="Edit entry"
        back={{ href: "/admin/fun", label: "Fun entries" }}
        info={
          <>
            Already live on <code>/fun</code> — there is no draft state on this
            table, so every save is a publish and deleting is the only way to take an
            entry back.
          </>
        }
        actions={<ViewOnSite href="/fun" />}
      />

      <ConvexGate>
        <FunEditor entryId={id} />
      </ConvexGate>
    </AdminPage>
  );
}
