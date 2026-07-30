import type { Metadata } from "next";

import { AdminPage, AdminPageHeader, ConvexGate } from "@/components/admin";

import { ProjectEditor } from "./ProjectEditor";

/**
 * `/admin/projects/[slug]` — edit one case study.
 *
 * The slug is the only thing this server component knows: the document itself
 * cannot be read here, because reading it needs an authenticated *Convex* client
 * and the browser is where that identity lives (`ConvexClientProvider` fetches
 * the Clerk JWT asynchronously — see `ConvexGate`). So the page is furniture plus
 * a gate, and `ProjectEditor` does the loading.
 *
 * `params` is a promise in this version of Next and must be awaited — the
 * synchronous form was removed. There is no `generateStaticParams` and no
 * `dynamicParams`: `src/app/admin/layout.tsx` sets `dynamic = "force-dynamic"`
 * for the whole admin, since every one of these pages is a live view of a
 * mutable document behind a session.
 *
 * ── The header, after the compaction pass ───────────────────────────────────
 *
 * `back` replaces what used to be a ghost "Back to list" button in `actions`. It
 * is the same destination and it is no longer competing with the screen's real
 * actions for the right-hand side — a return path is navigation, not an action,
 * and every detail screen in the admin now puts it in the same place.
 *
 * There is no `ViewOnSite` here, and its absence is deliberate rather than an
 * omission: this component knows the slug and *not* whether the document is
 * published, so the only link it could offer is one that 404s for every draft.
 * The affordance lives in `ProjectForm`'s publish panel instead, where
 * `row.published` is in hand and the "Draft — not public yet" state can be told
 * honestly. The eyebrow went for the same reason it went everywhere else: the
 * topbar breadcrumb already reads `admin / case studies / <slug>`.
 */
export const metadata: Metadata = {
  title: "Edit case study — admin",
};

export default async function EditProjectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <AdminPage>
      <AdminPageHeader
        title="Edit case study"
        back={{ href: "/admin/projects", label: "Case studies" }}
        info={
          <>
            Editing <code>{slug}</code>. Saving a published case study re-runs
            the ADR-009 media gate, so an unsanitised screenshot cannot be edited
            into something that is already public.
          </>
        }
      />

      <ConvexGate>
        <ProjectEditor slug={slug} />
      </ConvexGate>
    </AdminPage>
  );
}
