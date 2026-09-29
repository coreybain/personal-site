import Image from "next/image";

import type { PostCover as PostCoverAsset } from "@/lib/snapshot";

/** What the browser should download at each breakpoint, per frame size. */
const SIZES = {
  // The post hero and the /blog lead card span the 1180px shell.
  hero: "(min-width: 1180px) 1100px, 100vw",
  // Grid tiles: three across on desktop, two on tablet, one on a phone.
  tile: "(min-width: 1024px) 380px, (min-width: 640px) 50vw, 100vw",
} as const;

/**
 * A post's cover image, in the two sizes the blog uses.
 *
 * `next/image` with `fill`: covers are Uploadfile URLs (ADR 020), allowed in
 * `images.remotePatterns`, so the optimiser serves a resized AVIF/WebP instead
 * of the 1–2 MB source PNG. That matters most on /blog, where the lead card's
 * cover is the LCP element.
 *
 * The CLS budget is held by the frame, not the image: `.blog-cover` declares a
 * fixed `aspect-ratio` in blog.css and `fill` positions the image inside it with
 * `object-fit: cover`, so the space is reserved before any byte lands. That is
 * why `width`/`height` are not forwarded even when the row carries them.
 *
 * `priority` preloads the image with high fetch priority. It is set where the
 * cover is the LCP element — the post page's hero and the /blog lead card.
 * Everything else is lazy.
 */
export function PostCover({
  cover,
  size,
  priority = false,
}: {
  cover: PostCoverAsset;
  /** `hero` is the 21:9 banner on a post; `tile` is the 16:10 card image. */
  size: "hero" | "tile";
  priority?: boolean;
}) {
  return (
    <div className={`blog-cover blog-cover-${size}`}>
      <Image
        src={cover.url}
        // `alt` is required by `posts.create`/`update` (assertMedia), so this is
        // never the empty string by accident — a cover with no description
        // cannot be saved in the first place.
        alt={cover.alt}
        fill
        sizes={SIZES[size]}
        priority={priority}
      />
    </div>
  );
}
