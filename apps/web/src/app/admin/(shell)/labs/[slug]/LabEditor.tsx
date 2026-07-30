"use client";

import { api } from "@home/convex/api";
import { useQuery } from "convex/react";
import Link from "next/link";

import { AdminNotice, AdminPanel } from "@/components/admin";

import { LabForm } from "../LabForm";

/**
 * Loads one Lab by slug and hands it to `LabForm`.
 *
 * The mirror of `ProjectEditor`, including why the route is keyed on the slug
 * rather than the document id: the admin URL is the public URL with a prefix, so
 * "edit this page" is a transformation rather than a lookup.
 *
 * `includeDrafts: true` is what makes an unpublished Lab readable at all —
 * `labs.getBySlug` returns `null` for a draft otherwise, which is right for
 * `/labs/[slug]` and useless for an editor. `undefined` (resolving) and `null`
 * (no such row) are kept apart so a "not found" panel never flashes on load.
 */
export function LabEditor({ slug }: Readonly<{ slug: string }>) {
  const row = useQuery(api.labs.getBySlug, { slug, includeDrafts: true });

  if (row === undefined) {
    return (
      <AdminPanel>
        <p className="adm-micro" role="status">
          Loading <code>{slug}</code>…
        </p>
      </AdminPanel>
    );
  }

  if (row === null) {
    return (
      <AdminNotice tone="warn" title="No such Lab">
        Nothing in <code>labs</code> has the slug <code>{slug}</code>. It may have
        been deleted, or renamed — a rename leaves no redirect behind.{" "}
        <Link href="/admin/labs">Back to the list</Link>.
      </AdminNotice>
    );
  }

  /* Keyed on the document id so navigating between two Labs remounts the form
     instead of reusing its state — the form initialises once on purpose, so that
     a live update cannot overwrite what is being typed. */
  return <LabForm key={row._id} row={row} />;
}
