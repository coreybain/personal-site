import type { PostCover as PostCoverAsset } from "@/lib/snapshot";

/**
 * A post's cover image, in the two sizes the blog uses.
 *
 * ── Why a plain `<img>` and not `next/image` ───────────────────────────────
 *
 * Covers are UploadThing CDN URLs (ADR 010), and `next/image` refuses a remote
 * host that is not listed in `images.remotePatterns`. Adding that entry is a
 * change to the *public site's* build configuration made on behalf of one
 * feature, and it is the SEO/config agent's call rather than this one's — the
 * admin's `ImageUpload` already reached the same conclusion and says so at the
 * same kind of `<img>`. Recorded as an open item; nothing in the markup below
 * has to change when it is taken, only the element.
 *
 * The CLS budget is held without the optimiser: the frame declares a fixed
 * `aspect-ratio` in blog.css and the image is `object-fit: cover` inside it, so
 * the space is reserved from the stylesheet before any byte of the image lands.
 * That is also why `width`/`height` are *not* forwarded even when the row
 * carries them — they would fight the ratio the layout is built on.
 *
 * `priority` maps to `fetchPriority="high"` + eager loading, and is set only by
 * the post page's hero, where the cover is the LCP element. Everything else —
 * every card in the index grid — is lazy.
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
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={cover.url}
        // `alt` is required by `posts.create`/`update` (assertMedia), so this is
        // never the empty string by accident — a cover with no description
        // cannot be saved in the first place.
        alt={cover.alt}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding="async"
      />
    </div>
  );
}
