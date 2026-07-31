/**
 * render.ts — the server-side entry point.
 *
 * Two functions, one document. `renderResumePdf` gives a `Buffer` and
 * `streamResumePdf` a readable stream; both register the vendored fonts first,
 * and neither touches the network.
 *
 * ── Why a Buffer is the default ────────────────────────────────────────────
 *
 * A résumé is 40–60 KB. Streaming it buys nothing measurable and costs the one
 * thing the route actually wants: a `Content-Length`. Without it the response is
 * chunked, the browser's download progress bar is indeterminate, and — the real
 * problem — a render that throws *after* the first chunk has already been
 * flushed cannot be turned into a 500, so the user gets a truncated file that
 * their PDF reader reports as corrupt. Buffering means a failure is a failure
 * before any bytes leave.
 *
 * `streamResumePdf` exists anyway because it is the honest primitive underneath
 * and because a future variant (a bundle of every case study, say) would want
 * it. Prefer `renderResumePdf`.
 *
 * ── Server-only ────────────────────────────────────────────────────────────
 *
 * `node:fs` is read at registration time and @react-pdf's node build is used, so
 * this module cannot be imported into a client component or an edge runtime. The
 * route handler that calls it must run on Node.
 */

import { createElement, type ReactElement } from 'react';

import {
  renderToBuffer,
  renderToStream,
  type DocumentProps,
} from '@react-pdf/renderer';

import { registerResumeFonts } from './fonts';
import { ResumePdf } from './ResumePdf';
import type { ResumePdfProps } from './props';

/**
 * Build the element both entry points render.
 *
 * ── The default ────────────────────────────────────────────────────────────
 *
 * `generatedAt` is the only clock read in this package, and it is read here
 * rather than inside `ResumePdf` because a component that reads the clock
 * renders differently on every call, which would make the fixture harness — the
 * only test this document has — useless.
 *
 * ── The cast ───────────────────────────────────────────────────────────────
 *
 * @react-pdf types its render entry points as `ReactElement<DocumentProps>`:
 * the props of the root `<Document>` node. `ResumePdf` is a component that
 * *returns* a `<Document>`, so its element carries `ResumePdfProps` and the two
 * do not unify — a mismatch that applies to every wrapper component anyone has
 * ever written for this library. JSX hides it, because `JSX.Element` is
 * `ReactElement<any, any>` and `any` unifies with everything; `createElement`
 * preserves the real type and so surfaces it.
 *
 * The assertion states the one fact TypeScript cannot see from a component's
 * props and which `ResumePdf`'s own body guarantees: the root of the tree is a
 * `<Document>`. It is the narrowest possible workaround — one expression, one
 * file — and switching this module to `.tsx` would only trade it for the same
 * unsoundness spelled `any`.
 */
function resumeElement(props: ResumePdfProps): ReactElement<DocumentProps> {
  const withDefaults = {
    ...props,
    generatedAt: props.generatedAt ?? new Date().toISOString(),
  };

  return createElement(ResumePdf, withDefaults) as unknown as ReactElement<
    DocumentProps
  >;
}

/**
 * Render the résumé to a PDF buffer.
 *
 * ```ts
 * const pdf = await renderResumePdf({ identity, resume, gitStats, computedAt });
 * return new Response(new Uint8Array(pdf), {
 *   headers: {
 *     'content-type': 'application/pdf',
 *     'content-disposition': 'inline; filename="corey-baines.pdf"',
 *   },
 * });
 * ```
 *
 * Callers pass `apps/web`'s own `identity`, `resumeDocument` and `gitStats`
 * values straight through — the shapes are structurally identical to the
 * `@home/types` picks in props.ts, which is the entire mechanism by which "one
 * Resume Document, two renderers" holds without a shared module.
 */
export async function renderResumePdf(props: ResumePdfProps): Promise<Buffer> {
  registerResumeFonts();
  return renderToBuffer(resumeElement(props));
}

/**
 * The same document as a Node readable stream, for a caller that genuinely wants
 * to pipe. Read the note at the top of this file before choosing it over
 * `renderResumePdf`.
 */
export async function streamResumePdf(
  props: ResumePdfProps,
): Promise<NodeJS.ReadableStream> {
  registerResumeFonts();
  return renderToStream(resumeElement(props));
}

/**
 * The filename a download should carry.
 *
 * Derived from the name rather than hardcoded, lowercased and hyphenated,
 * because `resume.pdf` in a recruiter's downloads folder is indistinguishable
 * from the other nineteen. Kept here rather than in the route so the CLI harness
 * and the web route agree.
 */
export function resumePdfFilename(name: string): string {
  const slug = name
    // NFKD splits `é` into `e` + U+0301; the range then drops every combining
    // mark, so an accented name yields an ASCII filename rather than one a
    // `Content-Disposition` header has to escape.
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug || 'resume'}-resume.pdf`;
}
