import { renderResumePdf, resumePdfFilename } from "@home/pdf";
import type { ResumePdfProps } from "@home/pdf";

import { getSiteData } from "@/lib/data";
import { SITE_URL } from "@/lib/seo";

/**
 * `GET /api/resume.pdf` — the résumé as a real PDF (ADR 011, ADR 012).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  One Resume Document, two renderers.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The Glossary's rule for the Resume Document is that the web page and the PDF
 * "render from the same data". That is enforced here by construction: this
 * handler reads `getSiteData()` — the *same* function `(site)/resume/page.tsx`
 * calls, the same per-domain Convex-or-mock assembler — and hands the result
 * straight to `@home/pdf`. There is no second query, no PDF-specific document,
 * and no place for the two to drift. Edit `resumeDocument` in the admin and both
 * change together, within one revalidation window.
 *
 * The props are passed through *by structure*. `@home/pdf`'s `ResumePdfProps` is
 * built from `Pick<>`s of `@home/types`, and `@/lib/snapshot`'s `Identity`,
 * `GitStats` and `ResumeDocument` are written against the same schema, so
 * TypeScript accepts them without an adapter. Nothing is remapped below — a
 * remapping layer is exactly where "the same data" quietly stops being true.
 *
 * ── Why `/api/resume.pdf` and not `/api/resume` ────────────────────────────
 *
 * The extension is in the path deliberately. A recruiter who copies this URL
 * into an ATS field, a Slack unfurl, or `wget` gets something that is obviously
 * a PDF before anything has been fetched, and browsers that ignore
 * `Content-Disposition` still name the saved file sensibly. A directory named
 * `resume.pdf` is an ordinary route segment — the dot has no meaning to the
 * router.
 *
 * ── Node runtime, not edge ─────────────────────────────────────────────────
 *
 * Non-negotiable. `@home/pdf` reads five vendored Geist `.woff` files off disk
 * with `node:fs` at registration time (see that package's `fonts.ts` for why
 * they are vendored rather than fetched: a font CDN in the render path is the
 * latency ADR 011 rejected headless Chrome to avoid). `runtime` is declared
 * rather than left to the default so that the constraint is stated where someone
 * would otherwise casually flip it.
 *
 * ── The bundle boundary ────────────────────────────────────────────────────
 *
 * `@react-pdf/renderer` is ~1 MB of layout engine and a fontkit fork. It reaches
 * the client bundle only if some `"use client"` module imports it, and nothing
 * does: it is imported here, in a Route Handler, which has no client graph at
 * all. `<ResumeHeader>`'s download control is a plain `<a href>` for this exact
 * reason — a button that called a rendering function would drag the whole engine
 * into the page's JS.
 */

/**
 * Node, for `node:fs`. See the header.
 */
export const runtime = "nodejs";

/**
 * ISR, five minutes — the same posture as every wired page.
 *
 * ── Why the route is opted into caching at all ─────────────────────────────
 *
 * Route Handlers are *not* cached by default (unlike pages), so without these
 * two exports every request would re-query Convex and re-run the layout engine —
 * ~200 ms and a Convex read to produce bytes that are, by construction,
 * identical to the ones produced 40 ms earlier. `dynamic = "force-static"` is
 * the documented opt-in: the response is prerendered during `next build` and
 * regenerated on demand once it is older than `revalidate` seconds.
 *
 * Cache Components is not enabled (`next.config.ts` sets no flag), so
 * `dynamic` and `revalidate` are still valid route segment config — Next 16 only
 * removed them under Cache Components.
 *
 * ── Why 300, specifically ──────────────────────────────────────────────────
 *
 * Because `/resume` is 300. The full reasoning is in `@/lib/data`'s ISR section
 * and is not repeated here, but the part that matters for *this* route is the
 * consistency claim: a visitor who reads the page and then downloads the PDF
 * must not get two documents that disagree. Sharing the window means the two can
 * be at most one window apart, and in practice are regenerated from the same
 * Convex state. A longer window here would make the PDF the stale one — the
 * worst outcome, because it is the artefact that leaves the site and gets
 * forwarded.
 *
 * So: **an admin edit to `resumeDocument` — including `embedGitStats` — appears
 * in this PDF within five minutes**, exactly as it does on the page.
 *
 * The literal is written out rather than imported: Next requires the value to be
 * statically analysable, and `revalidate = REVALIDATE_SECONDS` is not guaranteed
 * to be read.
 */
export const dynamic = "force-static";
export const revalidate = 300;

/**
 * The canonical résumé address, scheme-less, as printed in the PDF's header and
 * colophon.
 *
 * Derived from `SITE_URL` rather than hardcoded so a preview deployment prints
 * its own origin instead of claiming to be production — and so ADR 017's
 * eventual domain move is one variable, not a string in a PDF nobody thinks to
 * grep. `@home/pdf` strips `www.` itself (`bareUrl`), so only the scheme comes
 * off here.
 */
const RESUME_URL = `${SITE_URL.replace(/^https?:\/\//, "")}/resume`;

export async function GET(): Promise<Response> {
  const { identity, gitStats, resumeDocument, computedAt } = await getSiteData();

  /**
   * Annotated rather than inferred: the annotation is what makes a schema change
   * in `@home/types` a compile error *here*, at the seam, instead of an empty
   * line on a printed résumé. `gitStats` is passed whole and narrowed by the
   * `Pick<>` in `ResumePdfProps` — the 365-element calendar and the language
   * shares are screen affordances and never reach the document.
   *
   * `generatedAt` is deliberately not supplied: `renderResumePdf` defaults it to
   * now, which under `force-static` means "when this response was prerendered or
   * last revalidated" — the honest answer for the footer's `Generated …` line,
   * and distinct from `computedAt`, which says how fresh the numbers are.
   */
  const props: ResumePdfProps = {
    identity,
    resume: resumeDocument,
    gitStats,
    computedAt,
    siteUrl: RESUME_URL,
  };

  const pdf = await renderResumePdf(props);

  /**
   * No `try`/`catch`.
   *
   * The two ways this throws are "the vendored fonts did not make it into the
   * deployment" (`@home/pdf` raises a legible error naming the missing file and
   * pointing at the string-literal font specifiers in its `fonts.ts`, which are
   * what the bundler rewrites) and "the document data is malformed". Both are
   * build/deploy faults, not request faults. Under `force-static` a throw fails
   * `next build` loudly, and a throw during revalidation leaves the last good
   * PDF being served — both strictly better than the alternative, which would be
   * catching it and caching a 500 response for five minutes.
   */
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",

      /**
       * `inline`, not `attachment`. The `download` attribute on the page's link
       * already forces a save for the one visitor who clicked it, and `inline`
       * means everyone else — someone opening the URL from a message, a crawler,
       * an ATS preview pane — sees the document rather than a file in their
       * downloads folder. The filename is still honoured by every browser that
       * saves it afterwards.
       *
       * The name comes from `resumePdfFilename(identity.name)` rather than a
       * literal so the CLI fixture harness and this route cannot disagree, and
       * so it tracks the name in Convex. It is ASCII-folded there, which is why
       * this header needs no RFC 5987 `filename*` escape hatch.
       */
      "content-disposition": `inline; filename="${resumePdfFilename(identity.name)}"`,

      /**
       * Set explicitly because a PDF is worth a real `Content-Length`: without
       * one the response is chunked and the browser's download progress is
       * indeterminate. It is also why `renderResumePdf` returns a buffer rather
       * than a stream — see that function's docblock.
       */
      "content-length": String(pdf.byteLength),
    },
  });
}
