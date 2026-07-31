/**
 * The two arrows the blog uses, and nothing else.
 *
 * Deliberately a local copy rather than an import from
 * `@/components/site/work/WorkArt`. That module is the case-study procedural art
 * generator — it happens to also export these two glyphs — and a blog card
 * reaching into /work's art module to borrow an SVG path is a dependency the
 * next reader has to disprove. Every other icon set in this codebase is local to
 * the component that draws it (see `Chrome.tsx`, `ViewOnSite.tsx`); this follows
 * that, at the cost of thirteen duplicated path bytes.
 *
 * `aria-hidden` on both: they always sit inside a link whose text already says
 * where it goes.
 */

export function ArrowRight() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path
        d="M2.6 6.5h7.8M7.2 3.3l3.2 3.2-3.2 3.2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ArrowLeft() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path
        d="M10.4 6.5H2.6M5.8 3.3L2.6 6.5l3.2 3.2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
