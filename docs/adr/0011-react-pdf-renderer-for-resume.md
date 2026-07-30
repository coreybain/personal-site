# ADR 0011 — `@react-pdf/renderer` for the PDF resume

- **Date:** 2026-07-30
- **Status:** Accepted

## Context

The resume exists twice: as a web page at `/resume` and as a downloadable PDF at
`/api/resume.pdf`. Both render from the same Resume Document (ADR 0012 and the Glossary), so the
PDF has to be generated on the server, on demand, from Convex data.

The obvious alternative is headless Chrome printing the web page to PDF. That means a heavy
binary in the deployment, cold starts measured in seconds, and a route whose latency is
dominated by browser startup — on a site whose entire premise is speed.

Recruiters and ATS pipelines also need the PDF's text to be real text, not a rasterised page.

## Decision

Render the PDF with **`@react-pdf/renderer`** from `packages/pdf`, server-side, sourced from the
Resume Document.

## Consequences

- A real PDF with selectable, copyable, machine-readable text — which is what an ATS parses.
- Small and fast: no headless-Chrome cold starts, no browser binary in the bundle.
- The PDF layout is written separately from the web layout, in `@react-pdf/renderer`'s own
  primitives. That is duplicated presentation work; the *data* is not duplicated, which is the
  part that matters.
- Page breaks need explicit attention, which is why verification includes generating the PDF,
  opening it, confirming text selection, and checking that breaks are clean.
