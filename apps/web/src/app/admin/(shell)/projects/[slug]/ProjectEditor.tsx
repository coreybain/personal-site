"use client";

import { api } from "@home/convex/api";
import { useQuery } from "convex/react";
import Link from "next/link";

import { AdminNotice, AdminPanel } from "@/components/admin";

import { ProjectForm } from "../ProjectForm";

/**
 * Loads one case study by slug and hands it to `ProjectForm`.
 *
 * ── Why the route is keyed on the slug and not the id ───────────────────────
 *
 * `/admin/projects/quotecloud` is a URL a human can read, type and recognise in a
 * history list, and it is the same identifier the public page uses — so the admin
 * URL is the public URL with a prefix, which makes "edit this page" a mechanical
 * transformation rather than a lookup. The cost is that renaming a slug moves the
 * page you are on; `ProjectForm` handles that with a `router.replace` after the
 * save it caused.
 *
 * `includeDrafts: true` is required and is the whole reason this cannot reuse the
 * public read: without it, `getBySlug` returns `null` for an unpublished row —
 * which is correct for `/work/[slug]` (a draft URL must 404 exactly as a
 * nonexistent one does) and useless for an editor.
 *
 * ── The three states ───────────────────────────────────────────────────────
 *
 * `useQuery` returns `undefined` while the subscription resolves and the data
 * afterwards, so `undefined` and `null` are genuinely different answers here:
 * "still asking" and "there is no such case study". Collapsing them would show a
 * "not found" panel for a moment on every page load, which teaches you to
 * disbelieve it.
 */
export function ProjectEditor({ slug }: Readonly<{ slug: string }>) {
  const row = useQuery(api.projects.getBySlug, { slug, includeDrafts: true });

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
      <AdminNotice tone="warn" title="No such case study">
        Nothing in <code>projects</code> has the slug <code>{slug}</code>. It may
        have been deleted, or renamed — a rename leaves no redirect behind.{" "}
        <Link href="/admin/projects">Back to the list</Link>.
      </AdminNotice>
    );
  }

  /**
   * Keyed on the document id so that navigating between two case studies
   * remounts the form rather than reusing its state. Without the key, switching
   * rows would keep the previous draft — `ProjectForm` initialises its state once
   * on purpose, so that a live update from another tab cannot overwrite what is
   * being typed.
   */
  return <ProjectForm key={row._id} row={row} />;
}
