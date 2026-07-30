# ADR 0012 — The resume embeds live git statistics

- **Date:** 2026-07-30
- **Status:** Accepted

## Context

A resume is the most adjective-heavy document in a job search, and every candidate's is static —
written once, exported, and progressively out of date from that moment. The whole thesis of this
site is replacing claims with evidence (ADR 0003). A resume that carries the same evidence the
dashboard does inherits that credibility, and the data is already available in the Snapshot
(ADR 0004).

Both surfaces render from one `resumeDocument` record, which carries an `embedGitStats` flag.

## Decision

**Embed live git statistics** — the aggregate contribution totals from the Snapshot — in both the
web resume and the generated PDF, rendered at generation time from the same source of truth.

## Consequences

- Every download is provably current, dated against `computedAt`. No static PDF can make that
  claim, which makes it a genuine differentiator rather than a gimmick.
- A PDF that has been sent or printed is a point-in-time copy. That is fine and expected — the
  number was true when generated, and the canonical version is always at `/resume`.
- The PDF route depends on the Snapshot being populated; a stale or empty Snapshot must degrade to
  omitting the stats block rather than failing the download.
- Verification asserts the embedded figures match the Snapshot exactly, so a formatting or unit
  bug cannot quietly misstate the numbers.
