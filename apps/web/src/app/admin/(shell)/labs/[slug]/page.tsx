import type { Metadata } from "next";

import { AdminPage, AdminPageHeader, ConvexGate } from "@/components/admin";

import { LabEditor } from "./LabEditor";

/**
 * `/admin/labs/[slug]` — edit one Lab.
 *
 * Furniture plus a gate. The document cannot be read here: an admin read needs an
 * authenticated Convex client, and that identity is fetched in the browser
 * (`ConvexClientProvider` gets the Clerk JWT asynchronously — see `ConvexGate`),
 * so `LabEditor` does the loading.
 *
 * `params` is a promise in this version of Next and must be awaited. No
 * `generateStaticParams`: `src/app/admin/layout.tsx` sets
 * `dynamic = "force-dynamic"` for the whole admin.
 *
 * The return path is `back` rather than a ghost button in `actions` — it is
 * navigation, not one of the screen's actions, and it is now in the same place on
 * every detail screen. No `ViewOnSite` here: this component knows the slug and
 * not whether the Lab is published, so the honest version of that control needs
 * `row.published` and lives in `LabForm`'s publish panel.
 */
export const metadata: Metadata = {
  title: "Edit Lab — admin",
};

export default async function EditLabPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <AdminPage>
      <AdminPageHeader
        title="Edit Lab"
        back={{ href: "/admin/labs", label: "Labs" }}
        info={
          <>
            Editing <code>{slug}</code>. The GitHub stats block is shown
            read-only: the hourly cron owns it, and anything typed there would
            last until the next tick.
          </>
        }
      />

      <ConvexGate>
        <LabEditor slug={slug} />
      </ConvexGate>
    </AdminPage>
  );
}
