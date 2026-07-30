# ADR 0009 — Imagery is real screenshots, sanitised

- **Date:** 2026-07-30
- **Status:** Accepted

> **Amendment (2026-07-30):** Corporate Interactive sign-off obtained — **all projects
> approved** for sanitised screenshots. The blocking dependency below is resolved; the
> fallback (abstracted mockups + architecture diagrams) is no longer needed. Per-image
> sanitisation remains manual work in build phase 8.

## Context

The current site has zero images on its homepage and only Next.js starter SVGs in `public/`.
Fixing that is not a matter of adding decoration — the images have to do argumentative work.
A hiring manager assessing a Principal Engineer is most convinced by seeing the actual thing
that was built: real product UI, real complexity, real polish. Abstract illustration or generic
device mockups say nothing about capability.

The projects worth showing are client-owned, so their screens contain client branding and
potentially customer data.

## Decision

Use **real screenshots, sanitised** — client data scrubbed, identifiers removed — as the primary
imagery across the case-study grid, case-study pages, and the featured tiles on the dashboard.

## Consequences

- The most persuasive available evidence, in the medium a skim-reader actually processes.
- **Blocked on Corporate Interactive sign-off, per project.** This is the largest unresolved
  dependency in the whole plan and the visual concept depends on it, so it must be raised with
  CI early — during build phase 1, not when the grid is being built.
- **Fallback:** abstracted device mockups plus per-project architecture diagrams. That is a
  design decision best made *before* the grid is built rather than retrofitted, so the sign-off
  answer is needed early even if the answer is no.
- Sanitisation is manual per-image work and belongs to build phase 8 (content load), which the
  plan treats as the real critical path.
