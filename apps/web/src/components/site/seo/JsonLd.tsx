/**
 * JsonLd — the one place this app writes a `<script type="application/ld+json">`.
 *
 * A plain `<script>`, not `next/script`: JSON-LD is data, not executable code,
 * and the Next metadata guide says exactly that. Rendered from a Server
 * Component, so the tag is in the HTML the crawler receives and **no JavaScript
 * ships** — which is the only version of structured data compatible with the
 * homepage's < 100 KB budget.
 *
 * ── The escape, and why it is not optional ─────────────────────────────────
 *
 * `JSON.stringify` leaves the less-than character alone. Everything serialised
 * here is Convex-authored content — a post title, a case-study summary, an
 * availability line — and any one of those containing a literal closing script
 * tag would end this element early and turn the remainder of the payload into
 * markup. Rewriting every less-than to its six-character JSON unicode escape is
 * the mitigation Next's own JSON-LD guide prescribes: that escape is legal
 * inside a JSON string, so a parser reconstitutes the original character while
 * the HTML tokeniser never sees one.
 *
 * That is the whole reason this component exists rather than each page
 * hand-rolling its own tag: the escape is easy to forget once and impossible to
 * notice afterwards.
 */

import type { JsonLdDocument } from "./schema";

export function JsonLd({ data }: { data: JsonLdDocument }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
