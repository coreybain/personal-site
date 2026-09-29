import type { TocEntry } from "@/lib/markdown";

import { PostShare } from "./PostShare";
import { PostToc } from "./PostToc";

/**
 * The rail beside a post: its contents, then the share controls.
 *
 * A Server Component composing two small client islands, so the post body
 * itself stays static HTML. On wide screens blog.css sticks this to the right
 * of the text; below that it sits above the post, with the contents folded
 * behind a toggle so it does not push the first paragraph off the screen.
 *
 * A post with fewer than two headings gets no contents — a one-item map is not
 * a map — but still gets the share controls.
 */
export function PostAside({
  toc,
  url,
  title,
  share = true,
}: {
  toc: TocEntry[];
  url: string;
  title: string;
  /** False in the preview area, so an unpublished post's link cannot be shared by accident. */
  share?: boolean;
}) {
  return (
    <aside className="blog-aside">
      {toc.length >= 2 ? <PostToc toc={toc} /> : null}
      {share ? <PostShare url={url} title={title} /> : null}
    </aside>
  );
}
