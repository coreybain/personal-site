import { Suspense } from "react";
import Link from "next/link";

import { CodeForm } from "@/components/site/preview/CodeForm";
import { PreviewSignOut } from "@/components/site/preview/PreviewSignOut";
import { StatusChip } from "@/components/site/preview/StatusChip";
import { currentSession, listPreviewPosts } from "@/lib/preview";

/**
 * The preview home: the code form when signed out, every post when signed in.
 * The session read happens inside Suspense so the page shell still prerenders
 * under Cache Components; everything inside is per-request.
 */
export default function PreviewPage() {
  return (
    <main>
      <section className="hor-sky">
        <div className="hor-wash" aria-hidden="true" />
        <div className="hor-shell pt-24 pb-16 sm:pt-28 lg:pt-32">
          <Suspense fallback={<p className="hor-body">Loading…</p>}>
            <PreviewHome />
          </Suspense>
        </div>
      </section>
    </main>
  );
}

async function PreviewHome() {
  const session = await currentSession();
  if (!session) {
    return (
      <div className="pv-gate">
        <span className="hor-eyebrow">
          <span className="hor-mono">00</span>
          <span className="hor-tick" aria-hidden="true" />
          Preview
        </span>
        <h1 className="hor-display blog-title mt-5">Drafts</h1>
        <p className="hor-lede mt-6 max-w-[48ch]">
          Enter the code from your MCP server. Codes work once and expire after ten minutes.
        </p>
        <CodeForm />
      </div>
    );
  }

  const posts = await listPreviewPosts(session);
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="hor-eyebrow">
            <span className="hor-mono">{String(posts.length).padStart(2, "0")}</span>
            <span className="hor-tick" aria-hidden="true" />
            Preview
          </span>
          <h1 className="hor-display blog-title mt-5">Drafts</h1>
        </div>
        <PreviewSignOut />
      </div>

      {posts.length === 0 ? (
        <p className="hor-lede mt-10">No posts yet. Ask for a draft and it will appear here.</p>
      ) : (
        <ul className="pv-list mt-10">
          {posts.map((post) => (
            <li key={post.postId}>
              <Link href={`/preview/blog/${post.slug}`} className="hor-card pv-row">
                <span className="pv-row-main">
                  <span className="pv-row-title">{post.title}</span>
                  <span className="pv-row-excerpt">{post.excerpt}</span>
                </span>
                <span className="pv-row-meta">
                  <StatusChip post={post} />
                  {post.editedSinceViewed ? <span className="pv-flag">Edited since you viewed it</span> : null}
                  {post.openFeedback > 0 ? (
                    <span className="pv-flag pv-flag-quiet">{post.openFeedback} open {post.openFeedback === 1 ? "note" : "notes"}</span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
