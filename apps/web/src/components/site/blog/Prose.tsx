/**
 * The rendered post body.
 *
 * ── `dangerouslySetInnerHTML`, deliberately ────────────────────────────────
 *
 * This is the only place in the codebase that sets HTML from a string, so it is
 * worth saying exactly what makes it safe rather than leaving the next reader to
 * assume it is not:
 *
 *   1. **The input is not user content.** `posts.body` is written through an
 *      admin gated by Clerk (ADR 006) by the one person who owns the site. There
 *      is no submission path, no comments, no import.
 *   2. **Raw HTML never survives the parser.** `@/lib/markdown` calls
 *      `remark-rehype` without `allowDangerousHtml`, so a `<script>` in the
 *      markdown source is discarded before any HTML tree exists.
 *   3. **What does exist is sanitised.** `rehype-sanitize` runs on GitHub's
 *      allowlist immediately after the tree is built, and every transform after
 *      it is this repo's own code.
 *
 * The alternative — turning the tree into React elements — buys nothing here.
 * Nothing in a post body needs to be a component (there is no MDX in this
 * content model), both approaches cost zero client JavaScript because both run
 * in a Server Component, and this one avoids reconstructing a React tree that
 * would immediately be serialised back to HTML.
 *
 * ── Zero client JavaScript ─────────────────────────────────────────────────
 *
 * There is no `"use client"` in this directory and there must never be one. A
 * post is text: it needs no hydration, no interactivity and no runtime. The
 * entire unified pipeline stays on the server behind `@/lib/markdown`'s
 * `server-only` guard, and what reaches the browser is HTML and a stylesheet.
 *
 * ── Why `<div>` and not `<article>` ────────────────────────────────────────
 *
 * The page already wraps the whole post — hero, body and footer — in the
 * landmark. This element's only job is to be the styling scope that contains
 * blog.css's element selectors, and nesting a second `<article>` inside the
 * first would flatten the document outline for no benefit.
 */
export function Prose({ html }: { html: string }) {
  if (html.length === 0) return null;

  return (
    <div
      className="blog-prose"
      // See the docblock. Sanitised upstream, on the server, from content that
      // has no untrusted author.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
