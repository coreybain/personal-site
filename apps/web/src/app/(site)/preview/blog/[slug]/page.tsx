import { Suspense } from "react";
import Link from "next/link";

import { PostAside } from "@/components/site/blog/PostAside";
import { PostHero } from "@/components/site/blog/PostHero";
import { Prose } from "@/components/site/blog/Prose";
import { FeedbackLayer, type FeedbackItem } from "@/components/site/preview/FeedbackLayer";
import { PreviewBar } from "@/components/site/preview/PreviewBar";
import { StatusChip } from "@/components/site/preview/StatusChip";
import { getSiteData } from "@/lib/data";
import { renderPost } from "@/lib/markdown";
import { currentSession, getPreviewPost, previewClient, type PreviewPost } from "@/lib/preview";
import { SITE_URL } from "@/lib/seo";
import { formatSydney, sydneyInputs } from "@/lib/sydneyTime";
import type { Post } from "@/lib/snapshot";

import { api } from "@home/convex/api";

/**
 * /preview/blog/[slug] — a post exactly as it will appear, from its pending
 * version (docs/plans/preview-area.md). Same hero, contents rail and prose as
 * the public page; share controls are off, and the action bar and feedback
 * layer sit on top. Everything is per-request, inside Suspense.
 */
/**
 * Allowed to block. A preview must check the session before it can show
 * anything, and the shared layout's nav reads the pathname, so there is no
 * useful shell to prerender for a slug that is only known at request time.
 * Private, never cached, and off the public site's navigation paths.
 */
export const instant = false;

export default async function PreviewPostPage({ params }: { params: Promise<{ slug: string }> }) {
  // Read up front, as the public /blog/[slug] does: slugs are unknown at build,
  // and the shared layout's nav reads the pathname, so there is no useful shell
  // to prerender for an arbitrary slug.
  const { slug } = await params;
  return (
    <Suspense fallback={<main className="hor-shell pt-32"><p className="hor-body">Loading preview…</p></main>}>
      <PreviewPost slug={slug} />
    </Suspense>
  );
}

/**
 * Dates the preview needs that depend on "now": a draft has no date yet, so the
 * hero shows its scheduled time or today; a new schedule defaults to tomorrow
 * at 9:00 Sydney time.
 */
function previewDates(post: PreviewPost) {
  const now = Date.now();
  const dated: Post = {
    ...post.content,
    publishedAt: post.publishedAt ?? post.scheduledFor ?? new Date(now).toISOString(),
  };
  const schedule = post.scheduledFor ?? new Date(now + 24 * 60 * 60 * 1000).toISOString();
  return {
    dated,
    inputs: sydneyInputs(schedule),
    zone: formatSydney(schedule).split(" ").pop() ?? "Sydney",
  };
}

async function PreviewPost({ slug }: { slug: string }) {
  const session = await currentSession();
  if (!session) {
    return (
      <main className="hor-shell pt-32 pb-24">
        <p className="hor-lede">Your preview session has ended.</p>
        <Link href="/preview" className="hor-link">Enter a code</Link>
      </main>
    );
  }

  const [post, { identity }] = await Promise.all([getPreviewPost(session, slug), getSiteData()]);
  if (!post) {
    return (
      <main className="hor-shell pt-32 pb-24">
        <p className="hor-lede">There&apos;s no post at /{slug}.</p>
        <Link href="/preview" className="hor-link">All drafts</Link>
      </main>
    );
  }

  // Opening the page counts as having seen this exact version.
  await previewClient().mutation(api.preview.markSeen, { session, postId: post.postId, key: post.key });

  const { html, toc } = await renderPost(post.content.body);
  const { dated, inputs, zone } = previewDates(post);

  const feedback: FeedbackItem[] = post.feedback.map((item) => ({
    id: item.id, anchor: item.anchor, reaction: item.reaction, note: item.note,
    status: item.status, resolution: item.resolution,
  }));

  return (
    <main>
      <div className="hor-shell pv-bar-shell">
        <div className="pv-bar-top">
          <Link href="/preview" className="pv-link">← All drafts</Link>
          <StatusChip post={post} />
        </div>
        <PreviewBar
          postId={post.postId}
          expectedKey={post.key}
          status={post.status}
          publicSlug={post.publicSlug}
          scheduleLabel={post.scheduledFor ? formatSydney(post.scheduledFor) : null}
          failure={post.scheduleFailure?.message ?? null}
          defaultDate={inputs.date}
          defaultTime={post.scheduledFor ? inputs.time : "09:00"}
          timeZoneLabel={zone}
        />
      </div>

      <FeedbackLayer postId={post.postId} items={feedback}>
        <section className="hor-sky">
          <div className="hor-wash" aria-hidden="true" />
          <div className="hor-shell">
            <PostHero post={dated} index={0} postCount={1} identity={identity} />
          </div>
        </section>

        <div className="blog-seam" aria-hidden="true" />

        <section className="hor-sky">
          <div className="hor-shell">
            <div className="blog-layout pt-14 pb-24 sm:pt-16">
              <PostAside toc={toc} url={`${SITE_URL}/blog/${post.content.slug}`} title={post.content.title} share={false} />
              <article className="blog-article">
                <Prose html={html} />
              </article>
            </div>
          </div>
        </section>
      </FeedbackLayer>
    </main>
  );
}
