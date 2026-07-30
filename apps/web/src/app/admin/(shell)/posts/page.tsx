import type { Metadata } from "next";
import Link from "next/link";

import {
  AdminPage,
  AdminPageHeader,
  ConvexGate,
  ViewOnSite,
} from "@/components/admin";

import { PostsTable } from "./PostsTable";

/**
 * `/admin/posts` — the writing list.
 *
 * A **server** component: header, primary action, then the gate. Everything that
 * needs a backend is inside `PostsTable`. That order is the kit's rule and it has a
 * concrete payoff — on a clone with no environment variables this page still
 * renders a title, an explanation and a working "New post" link instead of a blank
 * rectangle. See `components/admin/README.md` §2.
 *
 * The paragraph that used to sit under the title is now `info`: it says what the
 * table holds and how publishing works, which is chrome by the test in README §2a —
 * true, read once, and not something the reader has to act on before touching the
 * screen. The one fact here that *is* judgement — "saving publishes immediately",
 * which is Fun, not Writing — belongs to `/admin/fun` and is loud there.
 */
export const metadata: Metadata = {
  title: "Writing — admin",
};

export default function AdminPostsPage() {
  return (
    <AdminPage>
      <AdminPageHeader
        eyebrow="Content"
        title="Writing"
        info={
          <>
            Long-form posts. Every post is created as a draft and is invisible to
            anyone without a session until it is published — publishing is a
            separate action, and it stamps the date once and never again.
          </>
        }
        actions={
          <>
            {/* `/blog` does not exist: ADR 018 ships the blog hidden and
                `siteSettings.nav.blog` starts `false`. `routeLive={false}` renders
                the honest "not on the site yet" state naming the route, rather
                than a link to a 404 or — worse — no control at all, which would
                read as a bug. It becomes a real link the day the route lands.
                README §4a. */}
            <ViewOnSite href="/blog" routeLive={false} />

            <Link
              href="/admin/posts/new"
              className="adm-btn"
              data-variant="primary"
            >
              New post
            </Link>
          </>
        }
      />

      <ConvexGate>
        <PostsTable />
      </ConvexGate>
    </AdminPage>
  );
}
