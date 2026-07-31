/**
 * markdown.ts — the blog's body renderer. Markdown in, sanitised HTML out, on
 * the server, with **zero bytes of client JavaScript**.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  SERVER ONLY. The `import "server-only"` below is load-bearing.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The whole unified/remark/rehype graph is roughly 130 packages. None of it has
 * any business in a browser: a post's body is fixed at publish time, so parsing
 * it in the reader's tab would ship a markdown compiler to render text that
 * could have been text. `server-only` makes importing this from a `"use client"`
 * graph a build error rather than a silent 40 KB regression — the same guard,
 * for the same reason, as `@/lib/data`.
 *
 * The output is a string of HTML, handed to `dangerouslySetInnerHTML` by
 * `<Prose>` (src/components/site/blog/Prose.tsx). That is deliberate and it is
 * the cheap end of the trade space:
 *
 *   • `react-markdown` renders the same tree as React elements. It works in an
 *     RSC and would also cost no client JS — but it re-parses on every render
 *     and produces a React tree we then throw away as HTML anyway.
 *   • `hast-util-to-jsx-runtime` is the middle option, and buys us nothing here
 *     because nothing in a post body needs to become a React component. There
 *     are no MDX-style embeds in this content model; `posts.body` is a plain
 *     markdown string typed in Tiptap (see packages/convex/convex/posts.ts).
 *
 * So: one pipeline, one string, no runtime.
 *
 * ── The stack, and why each plugin is here ─────────────────────────────────
 *
 *   unified 11               the pipeline itself
 *   remark-parse 11          markdown → mdast
 *   remark-gfm 4             tables, task lists, strikethrough, autolinks,
 *                            footnotes — GitHub's dialect, which is the dialect
 *                            anyone writing in Tiptap will assume
 *   remark-rehype 11         mdast → hast
 *   rehype-sanitize 6        the safety net (see below)
 *   rehype-slug 6            stable `id` on every heading
 *   rehype-autolink-headings a deep link on each of those headings
 *   rehype-stringify 10      hast → HTML
 *
 * All seven are the unified collective's own packages, all on their current
 * majors, all with no transitive runtime beyond the unist/hast utilities they
 * share. There is no alternative "minimal" stack worth having: markdown-it and
 * marked are single-package renderers, but neither gives a syntax tree that
 * `rehype-sanitize` can walk, and the sanitiser is the reason to be here.
 *
 * ── Sanitising self-authored content ──────────────────────────────────────
 *
 * Every post is written by Corey in an admin gated by Clerk (ADR 006). There is
 * no user-generated content on this site and there is no comment system, so the
 * threat model is not "an attacker submitted a post". It is narrower and duller:
 * a paste from a rendered web page carrying an `onclick`, a Tiptap export with
 * an inline `style`, a copied `<iframe>` from an embed. Sanitising is a
 * one-line, zero-runtime-cost defence against the day one of those makes it
 * into the body of something that also happens to be `dangerouslySetInnerHTML`.
 *
 * `defaultSchema` is GitHub's own allowlist. It is left almost untouched — one
 * `clobberPrefix` change, documented at the call — because every deviation is a
 * hole someone has to justify later, and this content needs none of them. Raw
 * HTML in the source is dropped entirely before we even get there: `remark-
 * rehype` is called without `allowDangerousHtml`, so `<script>` in a post body
 * is not sanitised, it is never parsed as HTML in the first place.
 *
 * **Plugin order is a security property.** Sanitising runs immediately after
 * `remark-rehype`, on the author's tree, and every transform after it is our
 * own code operating on an already-clean tree. Anything added to the pipeline
 * that handles *authored* markup must go before `rehypeSanitize`; anything that
 * decorates it (the heading anchors, the local plugin below) goes after, which
 * is also the only reason those decorations survive the allowlist at all.
 *
 * ── Syntax highlighting: deliberately not here ────────────────────────────
 *
 * Shiki (4.3.1 at time of writing, actively released) would highlight on the
 * server for zero client JS, so the budget is not the objection. Two things are:
 *
 *   1. **It fights the design.** The Horizon language is two materials — a calm
 *      sky and a monochrome instrument deck — with exactly one accent hue and a
 *      phosphor ramp for data. A code block is deck material. Dropping a
 *      six-colour editor theme into it is the one place on the site where
 *      colour would stop meaning "this is live data".
 *   2. **It is weight for content that does not exist.** ADR 018 launches the
 *      blog empty. `@shikijs/langs` bundles a megabyte-scale grammar per
 *      language into the server build; paying that before a single post is
 *      written is the wrong order to do things in.
 *
 * What the deck idiom gives instead: IBM Plex Mono (already loaded by the
 * `(site)` layout, so no extra font request), a hairline instrument frame, and
 * the language printed as a mono label in the block's corner — which is what
 * `rehypeCodeLanguage` below exists to make possible.
 *
 * **To turn highlighting on later**: `bun add @shikijs/rehype shiki`, then add
 * `.use(rehypeShiki, { themes: { light: …, dark: … }, defaultColor: false })`
 * *after* `rehypeSanitize` (it emits inline `style` custom properties, which the
 * allowlist would otherwise strip) and resolve `--shiki-light` / `--shiki-dark`
 * against `.hor[data-theme]` in blog.css. Nothing else in this file changes.
 */

import "server-only";

import type { Element, Root } from "hast";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";

/* ------------------------------------------------------------------ *
 * Sanitiser schema
 * ------------------------------------------------------------------ */

/**
 * GitHub's allowlist, with DOM-clobbering prefixes turned off.
 *
 * `hast-util-sanitize` defaults to rewriting every `id` and same-page `href` to
 * start with `user-content-`, which protects a page that embeds untrusted HTML
 * from an `id="body"` shadowing a global. This site embeds one author's own
 * posts, so the protection buys nothing — and it actively breaks something:
 * `remark-gfm` already emits footnote ids under its own `user-content-` prefix,
 * so the sanitiser prefixes them a *second* time (`user-content-user-content-
 * fn-1`) while leaving the `href` that points at them alone. Every footnote link
 * in a post lands nowhere. Verified against the real pipeline, not assumed.
 *
 * Heading ids are unaffected either way — `rehype-slug` runs after the
 * sanitiser, so `#the-heading` was never going to be prefixed and a URL
 * fragment shared from this blog stays readable.
 */
const SCHEMA = {
  ...defaultSchema,
  clobberPrefix: "",
} satisfies typeof defaultSchema;

/* ------------------------------------------------------------------ *
 * Local transforms
 * ------------------------------------------------------------------ */

/** `class="language-ts"` → the language, or `undefined`. */
function languageOf(node: Element): string | undefined {
  const className = node.properties?.className;
  if (!Array.isArray(className)) return undefined;

  for (const value of className) {
    if (typeof value !== "string") continue;
    if (value.startsWith("language-")) {
      const language = value.slice("language-".length).trim();
      if (language.length > 0) return language;
    }
  }

  return undefined;
}

/**
 * Three small corrections to the emitted HTML, in one tree walk.
 *
 * Runs **after** the sanitiser, so it is decorating a tree that is already
 * known-clean and its own attributes are not subject to the allowlist. All
 * three are things the markdown source cannot express and a reader would
 * otherwise notice:
 *
 *   `<pre data-lang>`  — the fenced language, lifted off the `<code>` child
 *                        where remark puts it, so blog.css can print it in the
 *                        block's corner with `content: attr(data-lang)`. This is
 *                        the whole of the "syntax highlighting" story; see the
 *                        file header.
 *   `<img loading>`    — every image in a post body is below the fold by
 *                        definition (the cover image is rendered separately by
 *                        the page, outside this pipeline), so all of them are
 *                        lazy and async-decoded.
 *   `<a rel>`          — outbound links get `noreferrer noopener`. They are not
 *                        given `target="_blank"`: a link in the middle of a
 *                        sentence is part of the reading flow, and hijacking the
 *                        reader's tab management is the site's least favourite
 *                        habit of other sites. Internal links (`/work/…`, `#…`)
 *                        are left alone.
 */
function rehypeHorizonProse() {
  return (tree: Root): void => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName === "pre") {
        const code = node.children.find(
          (child): child is Element =>
            child.type === "element" && child.tagName === "code",
        );
        const language = code ? languageOf(code) : undefined;
        if (language) {
          node.properties = { ...node.properties, "data-lang": language };
        }
        return;
      }

      if (node.tagName === "img") {
        node.properties = {
          ...node.properties,
          loading: "lazy",
          decoding: "async",
        };
        return;
      }

      if (node.tagName === "a") {
        const href = node.properties?.href;
        if (typeof href === "string" && /^https?:\/\//i.test(href)) {
          // `rel` is a space-separated token list in HTML and an array in hast;
          // `rehype-stringify` joins it back on the way out.
          node.properties = {
            ...node.properties,
            rel: ["noreferrer", "noopener"],
          };
        }
      }
    });
  };
}

/* ------------------------------------------------------------------ *
 * The pipeline
 * ------------------------------------------------------------------ */

/**
 * The heading anchor: a `#` that appears on hover, styled in blog.css.
 *
 * `aria-hidden` + `tabIndex: -1` because the heading text is already the
 * accessible name of the section and a screen reader announcing "link, number
 * sign" before every heading is noise. Sighted readers get an affordance;
 * keyboard users get one fewer stop.
 */
const ANCHOR_CONTENT: Element = {
  type: "element",
  tagName: "span",
  properties: { className: ["blog-anchor"], ariaHidden: "true" },
  children: [{ type: "text", value: "#" }],
};

/**
 * Which headings get an anchor: `h2`–`h4` only.
 *
 * `h1` is excluded because the post's own title is the page's `h1` and a body
 * heading should not compete with it. `h5`/`h6` are excluded because a post that
 * is six levels deep has an outline problem, not a linking problem.
 *
 * The explicit exclusion is `footnote-label` — the visually-hidden "Footnotes"
 * heading `remark-gfm` synthesises at the end of a post with footnotes in it.
 * It is chrome, not a section, and anchoring it would put a stray `#` in the
 * one heading nobody is meant to see.
 */
function isAnchorableHeading(element: Element): boolean {
  if (!["h2", "h3", "h4"].includes(element.tagName)) return false;
  return element.properties?.id !== "footnote-label";
}

/**
 * Built once at module scope and frozen on first use, which is what unified
 * processors are designed for: the parser, the plugins and the compiler are all
 * stateless, and `.process()` is what carries per-document state. Rebuilding the
 * pipeline per post would re-run seven plugin factories for no benefit.
 */
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  // No `allowDangerousHtml`: raw HTML in a post body is dropped here, before the
  // sanitiser ever sees it. See the file header — this is the first of the two
  // lines of defence and by far the more absolute one.
  .use(remarkRehype)
  .use(rehypeSanitize, SCHEMA)
  .use(rehypeSlug)
  .use(rehypeAutolinkHeadings, {
    behavior: "append",
    test: isAnchorableHeading,
    content: () => structuredClone(ANCHOR_CONTENT),
  })
  .use(rehypeHorizonProse)
  .use(rehypeStringify)
  .freeze();

/**
 * One post body, as HTML.
 *
 * Async because unified's `process` is: the pipeline supports asynchronous
 * transforms even though none of ours are, and calling `processSync` would
 * foreclose adding one (a server-side highlighter, an image dimension probe)
 * without touching every caller.
 *
 * Returns `""` for an empty or whitespace-only body rather than an empty
 * `<p></p>`, so a caller can test the result and render nothing at all. In
 * practice `posts.publish` refuses to publish a blank body (`assertText`), so
 * this is a guard against a draft preview, not against a live post.
 */
export async function renderMarkdown(markdown: string): Promise<string> {
  if (markdown.trim().length === 0) return "";

  const file = await processor.process(markdown);
  return String(file);
}
