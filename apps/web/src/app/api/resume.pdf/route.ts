import { renderResumePdf, resumePdfFilename } from "@home/pdf";
import type { ResumePdfProps } from "@home/pdf";

import { cacheLife } from "next/cache";

import { getSiteData } from "@/lib/data";
import {
  moreProjectsUrl,
  personalProjectsMeta,
  resumeProjects,
  resumeWithProjectSection,
} from "@/lib/resumeProjects";
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

/**
 * The PDF bytes and their filename, cached with the site's five-minute profile.
 *
 * Under Cache Components a `GET` handler cannot be marked `'use cache'` itself,
 * and rendering the document is slow work that would otherwise run on every
 * request. So the render happens here and the handler only wraps the cached
 * bytes in a `Response` — generated once, refreshed at most every five minutes,
 * the same as the `force-static` + `revalidate = 300` it replaces.
 */
async function buildResumePdf(): Promise<{ pdf: Uint8Array<ArrayBuffer>; filename: string }> {
  "use cache";
  cacheLife("site");

  const { identity, gitStats, resumeDocument, computedAt } = await getSiteData();

  /**
   * Annotated rather than inferred: the annotation is what makes a schema change
   * in `@home/types` a compile error *here*, at the seam, instead of an empty
   * line on a printed résumé. `gitStats` is passed whole and narrowed by the
   * `Pick<>` in `ResumePdfProps` — the 365-element calendar and the language
   * shares are screen affordances and never reach the document.
   *
   * `generatedAt` is deliberately not supplied: `renderResumePdf` defaults it to
   * now, which inside the cached render means "when this PDF was last generated" — the honest answer for the footer's `Generated …` line,
   * and distinct from `computedAt`, which says how fresh the numbers are.
   */
  const props: ResumePdfProps = {
    identity,
    availabilityVisible: identity.availabilityVisible,
    resume: resumeWithProjectSection(resumeDocument),
    personalProjects: resumeProjects,
    personalProjectsMeta: personalProjectsMeta(resumeDocument),
    moreProjectsUrl,
    gitStats,
    computedAt,
    siteUrl: RESUME_URL,
  };

  const pdf = new Uint8Array(await renderResumePdf(props));
  return { pdf, filename: resumePdfFilename(identity.name) };
}

export async function GET(): Promise<Response> {
  const { pdf, filename } = await buildResumePdf();

  /**
   * No `try`/`catch`.
   *
   * The two ways this throws are "the vendored fonts did not make it into the
   * deployment" (`@home/pdf` raises a legible error naming the missing file and
   * pointing at the string-literal font specifiers in its `fonts.ts`, which are
   * what the bundler rewrites) and "the document data is malformed". Both are
   * build/deploy faults, not request faults. A throw at build fails `next build`
   * loudly, and a throw during a background refresh leaves the last good
   * PDF being served — both strictly better than the alternative, which would be
   * catching it and caching a 500 response for five minutes.
   */
  return new Response(pdf, {
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
      "content-disposition": `inline; filename="${filename}"`,

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
