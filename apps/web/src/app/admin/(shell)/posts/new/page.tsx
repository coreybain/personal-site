import type { Metadata } from "next";

import { AdminPage, AdminPageHeader, ConvexGate } from "@/components/admin";

import { NewPostForm } from "./NewPostForm";

/**
 * `/admin/posts/new` — the create screen.
 *
 * A static segment, so it wins over the sibling `[slug]` route and there is no
 * chance of a post ever being addressable at `/admin/posts/new`. (Next matches
 * static segments before dynamic ones; the slug `new` would be unreachable rather
 * than ambiguous, which is worth knowing but has no consequence — a post called
 * "new" can simply be given a different slug.)
 *
 * `sectionForPathname` resolves this to Writing by longest-prefix match, so the
 * sidebar and breadcrumb are already correct with nothing added here.
 *
 * No `ViewOnSite`: there is no document yet, so there is nothing that could be
 * viewed anywhere. The `back` link is the only navigation this screen needs, and
 * it replaced the "All posts" button that used to sit in `actions`.
 */
export const metadata: Metadata = {
  title: "New post — admin",
};

export default function NewPostPage() {
  return (
    <AdminPage>
      <AdminPageHeader
        title="New post"
        back={{ href: "/admin/posts", label: "Writing" }}
        info={
          <>
            Created as a draft. Publishing is a separate action on the editor, and
            it is what stamps the date the blog sorts on.
          </>
        }
      />

      <ConvexGate>
        <NewPostForm />
      </ConvexGate>
    </AdminPage>
  );
}
