/**
 * markdown.tsx — markdown-lite, rendered as React elements. No HTML, ever.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  WHY THIS FILE EXISTS AT ALL, NEXT TO A REAL MARKDOWN PIPELINE
 *
 *  `src/lib/markdown.ts` already compiles markdown properly — remark, rehype,
 *  `rehype-sanitize`, autolinked headings — and it is the right tool for a
 *  blog post. It is the wrong tool here, twice over:
 *
 *   1. It runs on the **server**, once, over finished text. This text arrives a
 *      token at a time in the browser and is re-rendered on every chunk.
 *   2. It produces an **HTML string**, which can only be mounted through
 *      `dangerouslySetInnerHTML`. That is a sanitiser away from an injection,
 *      and the text being sanitised is written by a language model quoting a
 *      corpus. The whole class of bug disappears if no HTML is ever produced.
 *
 *  So: a ~200-line parser that emits React nodes. React escapes text nodes by
 *  construction, `dangerouslySetInnerHTML` appears nowhere in this folder, and
 *  a `<script>` in an answer renders as the five visible characters it is.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── The grammar, in full ──────────────────────────────────────────────────
 *
 *   blocks    paragraphs · `-`/`*`/`•` bullet lists · `1.` ordered lists ·
 *             ``` fenced code ``` · `#`–`###` headings (rendered as a lead-in
 *             line, not as document structure — see below) · `>` quotes
 *   inline    `**bold**` · `*italic*` · `` `code` `` · `[1]` citation refs
 *
 * Everything else is text. No images (nothing to show), no tables (a chat
 * answer that needs one should link to the page that has it), no raw links —
 * the answer's links are its **citations**, which are chips with real URLs and
 * a number, not inline anchors a model might invent.
 *
 * Headings deliberately render as a strong lead-in `<p>` rather than `<h2>`:
 * this text sits inside a page that already has a heading outline, and letting
 * a model inject H2s into it would corrupt the document structure a screen
 * reader navigates by.
 *
 * ── Streaming ─────────────────────────────────────────────────────────────
 *
 * Every incomplete construct has a defined half-open rendering, because at 30
 * tokens a second the reader spends most of their time looking at one:
 *
 *   unclosed fence   the lines so far render as code, immediately
 *   unclosed `**`    stays literal until the closer lands, then reflows
 *   half a list item renders as a one-item list and grows
 *
 * Nothing here throws. A parser that can throw would blank the answer mid-word.
 */

import type { ReactNode } from "react";

/* ------------------------------------------------------------------ *
 * Inline
 * ------------------------------------------------------------------ */

/**
 * One pass over a line of text, emitting nodes for the four inline forms.
 *
 * A hand-rolled scanner rather than a regex `split`, because the forms nest
 * badly under regexes (`**bold `code` **`) and because the scanner gives the
 * exact behaviour streaming needs: an opener with no closer is emitted as the
 * literal characters that are actually on screen.
 *
 * `onCitation` is the hook the console uses to turn `[1]` into a link to the
 * matching chip. It returns `null` when the number is out of range — a model
 * that cites `[7]` with four sources gets the literal text `[7]`, which is the
 * honest rendering of a claim the page cannot back up.
 */
function inline(
  text: string,
  keyPrefix: string,
  onCitation: (index: number, key: string) => ReactNode | null,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let buffer = "";
  let index = 0;
  let key = 0;

  /** Flush the plain-text run collected so far. */
  const flush = () => {
    if (buffer.length > 0) {
      nodes.push(buffer);
      buffer = "";
    }
  };

  while (index < text.length) {
    const rest = text.slice(index);

    // `code` — first, so markers inside a span stay literal.
    if (rest.startsWith("`")) {
      const close = rest.indexOf("`", 1);
      if (close > 1) {
        flush();
        nodes.push(
          <code className="ask-code" key={`${keyPrefix}-c${key++}`}>
            {rest.slice(1, close)}
          </code>,
        );
        index += close + 1;
        continue;
      }
    }

    // **bold**
    if (rest.startsWith("**")) {
      const close = rest.indexOf("**", 2);
      if (close > 2) {
        flush();
        nodes.push(
          <strong key={`${keyPrefix}-b${key++}`}>
            {inline(rest.slice(2, close), `${keyPrefix}-b${key}`, onCitation)}
          </strong>,
        );
        index += close + 2;
        continue;
      }
    }

    // *italic* — never `**`, which the branch above already claimed, and never
    // a bare `*` used as a bullet or a multiplication sign (no closer, no run).
    if (rest.startsWith("*") && !rest.startsWith("**")) {
      const close = rest.indexOf("*", 1);
      if (close > 1 && !rest.slice(1, close).includes("\n")) {
        flush();
        nodes.push(
          <em key={`${keyPrefix}-i${key++}`}>
            {inline(rest.slice(1, close), `${keyPrefix}-i${key}`, onCitation)}
          </em>,
        );
        index += close + 1;
        continue;
      }
    }

    // [1] — a citation reference. Only bare digits qualify: `[see below]` is
    // prose and stays prose.
    if (rest.startsWith("[")) {
      const close = rest.indexOf("]");
      if (close > 1) {
        const inner = rest.slice(1, close);
        if (/^\d{1,2}$/.test(inner)) {
          const node = onCitation(Number(inner), `${keyPrefix}-r${key++}`);
          if (node !== null) {
            flush();
            nodes.push(node);
            index += close + 1;
            continue;
          }
        }
      }
    }

    buffer += text[index];
    index += 1;
  }

  flush();
  return nodes;
}

/* ------------------------------------------------------------------ *
 * Blocks
 * ------------------------------------------------------------------ */

const BULLET = /^\s{0,3}[-*•]\s+(.*)$/;
const ORDERED = /^\s{0,3}(\d{1,2})[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}(#{1,4})\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const FENCE = /^\s{0,3}```(.*)$/;

/** A list being accumulated across lines: its kind, and its items so far. */
type OpenList = { ordered: boolean; items: string[] };

export type MarkdownLiteProps = {
  /** The answer so far. May end mid-word, mid-fence, mid-anything. */
  text: string;
  /**
   * Stable prefix for React keys. Message-scoped, so two answers on screen
   * cannot collide.
   */
  idPrefix: string;
  /**
   * Where `[n]` links to. Given the number as written in the prose, returns an
   * href — or `null` when this message has no source with that number, in
   * which case the marker renders as the literal text it is.
   *
   * A resolver rather than a count, because citation numbers come from the
   * route (`AskCitation.index`) and need not be a dense 1..n range: one
   * unrenderable source leaves a gap, and a count would happily link `[3]` to
   * whatever happened to be third.
   */
  citationHref?: (index: number) => string | null;
};

/**
 * The renderer. Pure, cheap, and called on every streamed chunk — memoise it at
 * the call site (`AskConsole` does) so a finished message stops re-parsing when
 * a *later* message streams.
 */
export function MarkdownLite({
  text,
  idPrefix,
  citationHref,
}: MarkdownLiteProps) {
  const citation = (index: number, key: string): ReactNode | null => {
    const href = citationHref === undefined ? null : citationHref(index);
    if (href === null) return null;
    return (
      <a
        key={key}
        className="ask-ref"
        href={href}
        aria-label={`Jump to source ${index}`}
      >
        {index}
      </a>
    );
  };

  const lines = text.split("\n");
  const blocks: ReactNode[] = [];

  /** Consecutive plain lines, joined into one paragraph. */
  let paragraph: string[] = [];
  /** Consecutive list items, with the list's kind. */
  let list: OpenList | null = null;
  let quote: string[] = [];
  let block = 0;

  const closeParagraph = () => {
    if (paragraph.length === 0) return;
    const key = `${idPrefix}-p${block++}`;
    blocks.push(
      <p key={key}>{inline(paragraph.join(" "), key, citation)}</p>,
    );
    paragraph = [];
  };

  const closeList = () => {
    if (list === null) return;
    const key = `${idPrefix}-l${block++}`;
    const items = list.items.map((item, itemIndex) => (
      <li key={`${key}-${itemIndex}`}>
        {inline(item, `${key}-${itemIndex}`, citation)}
      </li>
    ));
    blocks.push(
      list.ordered ? (
        <ol className="ask-ol" key={key}>
          {items}
        </ol>
      ) : (
        <ul className="ask-ul" key={key}>
          {items}
        </ul>
      ),
    );
    list = null;
  };

  const closeQuote = () => {
    if (quote.length === 0) return;
    const key = `${idPrefix}-q${block++}`;
    blocks.push(
      <blockquote className="ask-quote" key={key}>
        {inline(quote.join(" "), key, citation)}
      </blockquote>,
    );
    quote = [];
  };

  const closeAll = () => {
    closeParagraph();
    closeList();
    closeQuote();
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    // ── fenced code ──────────────────────────────────────────────────────
    const fence = FENCE.exec(line);
    if (fence !== null) {
      closeAll();
      const language = fence[1].trim();
      const code: string[] = [];
      index += 1;
      // Runs to the closing fence, or — mid-stream — to the end of what has
      // arrived. Either way the reader sees the code as code straight away.
      while (index < lines.length && !FENCE.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      const key = `${idPrefix}-f${block++}`;
      blocks.push(
        <pre className="ask-pre" key={key}>
          {language.length > 0 ? (
            <span className="ask-pre-lang hor-label" aria-hidden="true">
              {language}
            </span>
          ) : null}
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // ── blank ────────────────────────────────────────────────────────────
    if (line.trim().length === 0) {
      closeAll();
      continue;
    }

    // ── heading ──────────────────────────────────────────────────────────
    const heading = HEADING.exec(line);
    if (heading !== null) {
      closeAll();
      const key = `${idPrefix}-h${block++}`;
      blocks.push(
        <p className="ask-lead" key={key}>
          <strong>{inline(heading[2], key, citation)}</strong>
        </p>,
      );
      continue;
    }

    // ── list items ───────────────────────────────────────────────────────
    // A local alias, not `list` directly, because `closeList()` assigns `list`
    // from inside a closure — TypeScript rightly refuses to keep a narrowing
    // across that call, and the alias is clearer than a non-null assertion.
    const bullet = BULLET.exec(line);
    if (bullet !== null) {
      closeParagraph();
      closeQuote();
      // Annotated, not inferred: `open` is assigned back into `list` below, and
      // an un-annotated `let` makes that circular for the checker.
      let open: OpenList | null = list;
      if (open === null || open.ordered) {
        closeList();
        open = { ordered: false, items: [] };
        list = open;
      }
      open.items.push(bullet[1]);
      continue;
    }

    const ordered = ORDERED.exec(line);
    if (ordered !== null) {
      closeParagraph();
      closeQuote();
      let open: OpenList | null = list;
      if (open === null || !open.ordered) {
        closeList();
        open = { ordered: true, items: [] };
        list = open;
      }
      open.items.push(ordered[2]);
      continue;
    }

    // ── quote ────────────────────────────────────────────────────────────
    const quoted = QUOTE.exec(line);
    if (quoted !== null) {
      closeParagraph();
      closeList();
      quote.push(quoted[1]);
      continue;
    }

    // ── prose ────────────────────────────────────────────────────────────
    // A plain line directly under a list item is a continuation of it, not a
    // new paragraph — models wrap long bullets.
    if (list !== null && list.items.length > 0) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    closeQuote();
    paragraph.push(line.trim());
  }

  closeAll();
  return <>{blocks}</>;
}
