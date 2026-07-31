/**
 * @home/pdf — the PDF résumé (ADR 011).
 *
 * ┌─ The surface ──────────────────────────────────────────────────────────────┐
 * │ renderResumePdf(props)     → Promise<Buffer>    the one a route calls      │
 * │ streamResumePdf(props)     → Promise<Stream>    the honest primitive       │
 * │ resumePdfFilename(name)    → string             `corey-baines-resume.pdf`  │
 * │ ResumePdf                  React component      the document itself        │
 * │ ResumePdfProps             type                 the input contract         │
 * │ registerResumeFonts()      side effect          vendored Geist + word-break│
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * A just-in-time TypeScript package like `@home/types`: `exports` points at
 * `./src/index.ts` and there is no build step, so a consumer transpiles this
 * source itself.
 *
 * ── Why the input is a narrowing of @home/types ────────────────────────────
 *
 * The Glossary calls the Resume Document "one Convex-backed record, web resume
 * and PDF render from the same data". This package is the second renderer. It
 * imports nothing from `apps/web` — the contract is `ResumePdfProps` in
 * props.ts, built from `@home/types`' `IdentitySchema`, `ResumeDocumentSchema`
 * and `GitStatsSchema` with `Pick<>`, so the page can pass its own values
 * through by structure and a schema rename breaks both renderers at once.
 *
 * ── Node only ──────────────────────────────────────────────────────────────
 *
 * Fonts are read off disk with `node:fs` (fonts.ts explains why they are
 * vendored rather than fetched) and @react-pdf's node build does the rendering.
 * Nothing here may be imported into a client component or an edge runtime.
 *
 * ── Testing it ─────────────────────────────────────────────────────────────
 *
 *     bun run render-fixture        # from packages/pdf
 *
 * writes `tmp/fixture.pdf` and `tmp/fixture-long.pdf` from copies of the web
 * mock, so the layout can be inspected without a running site or a Convex
 * deployment. See scripts/render-fixture.ts.
 */

export { ResumePdf, DEFAULT_SITE_URL } from './ResumePdf';
export {
  renderResumePdf,
  streamResumePdf,
  resumePdfFilename,
} from './render';
export {
  registerResumeFonts,
  resumeHyphenationCallback,
  FONT_FAMILY,
  FONT_WEIGHT,
  RESUME_FONT_FILES,
} from './fonts';
export type {
  ResumePdfProps,
  ResumePdfIdentity,
  ResumePdfGitStats,
  ResumePdfDocument,
} from './props';
