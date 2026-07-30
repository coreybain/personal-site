# ADR 0004 — A precomputed Snapshot backs all live data

- **Date:** 2026-07-30
- **Status:** Accepted

## Context

The dashboard homepage (ADR 0003) shows git activity, AI-agent usage, and the latest life
entry. The naive implementation calls the GitHub GraphQL API — and potentially Apple and the
local collector's data — on page load. That costs seconds per request, is subject to third-party
rate limits and outages, and puts the site's most important page at the mercy of the slowest
upstream. A dashboard that is slow to appear defeats the five-second-snapshot goal it exists
to serve.

## Decision

Precompute everything into a **single denormalised Snapshot row** in Convex: `gitStats`,
`aiUsage`, `healthStats`, `latestFunEntry`, `computedAt`. The Snapshot is rebuilt on a schedule
(hourly Convex cron for git; ingest-triggered for health and AI usage), never on request. The
homepage reads exactly one document. Every Signal resolves from the Snapshot — the homepage
never touches GitHub, OpenAI, or Apple at request time.

## Consequences

- Homepage server work is one Convex document read, which is a gate in the performance budget
  and is verified explicitly during testing.
- Data is stale by up to the refresh interval. Acceptable: nobody is making decisions on
  minute-fresh step counts, and `computedAt` is available if freshness ever needs surfacing.
- Denormalisation means write-side complexity: whenever a source changes, something must
  recompute the row. That work is concentrated in the pipelines rather than spread across pages.
- The mock `apps/web/src/lib/snapshot.ts` stands in for this row during early phases, so the
  read shape is fixed before the backend exists.
