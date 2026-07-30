import type { Metadata } from "next";

import {
  AdminPage,
  AdminPageHeader,
  ConvexGate,
  ViewOnSite,
} from "@/components/admin";

import { PostEditor } from "./PostEditor";

/**
 * `/admin/posts/[slug]` — the post editor.
 *
 * A **server** component whose only job is the furniture and the gate; the editor
 * itself is a client component because it holds form state and three mutations.
 *
 * `params` is a promise in this version of Next and must be awaited (it was a plain
 * object up to 14, and the synchronous access that still worked in 15 is gone).
 * That is the whole reason this component is `async`.
 *
 * The title cannot be the post's title: the header renders outside `ConvexGate`,
 * so it is drawn before any data exists. That is the trade the kit's composition
 * rule makes, and it is the right one — the slug is in the URL, the title is one
 * line down inside the panel, and a zero-env clone still renders a page.
 *
 * ── The return path is the `back` link, not a button in `actions` ─────────────
 *
 * This screen used to carry an "All posts" ghost button on the right. It is now a
 * `BackLink` above the title, which is where a return path belongs: the right-hand
 * cluster is for what this screen can *do*, and mixing "leave" into it makes the
 * primary action harder to find. The slot it vacated holds the one thing worth
 * saying about where this post is published — which for now is that it is not.
 */
export const metadata: Metadata = {
  title: "Edit post — admin",
};

export default async function EditPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <AdminPage>
      <AdminPageHeader
        title="Edit post"
        back={{ href: "/admin/posts", label: "Writing" }}
        info={
          <>
            This post will live at <code>/blog/{slug}</code>. Drafts resolve there
            for a signed-in session and nowhere else, so a link to an unpublished
            post is a 404 for everyone else.
          </>
        }
        actions={
          /* The document's own route, and it does not exist yet — the blog ships
             hidden (ADR 018). `routeLive={false}` wins over `published`: there is
             no point saying "draft" about a route that would 404 either way. */
          <ViewOnSite href={`/blog/${slug}`} routeLive={false} />
        }
      />

      <ConvexGate>
        <PostEditor slug={slug} />
      </ConvexGate>
    </AdminPage>
  );
}
