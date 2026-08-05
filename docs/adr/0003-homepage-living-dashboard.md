# ADR 0003 — The homepage is a living dashboard

- **Date:** 2026-07-30
- **Status:** Accepted

## Context

The measured failure of the current site is its homepage: 548 words of prose, zero images, and
no quick snapshot of who Corey is. It reads as a wall of capability statements — adjectives
asserting competence rather than evidence of it. The goal is a Principal Engineer role, and the
site has roughly five seconds to convey competence to a hiring manager who is skimming.

Prose is the wrong medium for that. A reader scanning for five seconds does not read a
paragraph; they read shapes, numbers and images.

## Decision

Rebuild the homepage as a **living dashboard**: a short statement hero, a git contribution
heatmap carrying the real 6,434-contribution figure, featured work tiles with sanitised
screenshots, an AI-usage Signal, and a life signal strip (latest beer / coffee / walk).
Every element is real data, not copy.

## Consequences

- This is the single highest-leverage fix for the "too wordy, no quick snapshot" complaint —
  it replaces claims with evidence a reader can verify at a glance.
- It creates a hard dependency on live data being fast, which is why the Snapshot exists
  (ADR 0004) and why every dashboard widget renders server-side at fixed dimensions.
- It creates a dependency on imagery, which is why `funEntries` and `labs` carry photo fields
  as required and why case-study screenshots matter (ADR 0009).
- The acceptance criterion is behavioural, not aesthetic: the homepage on a phone at 4G
  throttling has to pass the five-second-snapshot test.

## Amendment (2026-08-05)

The living-dashboard decision stands, but the original “latest beer / coffee / walk” life strip
has evolved into the fixed-role **Off-clock Dashboard** defined by
[ADR 0019](0019-off-clock-personal-dashboard.md). Its three potential peers are an explicitly
selected Favorite Lab, a distinct Lab chosen from fresh public activity, and one trailing-seven-day
movement summary. Fun Entries remain on `/fun` rather than acting as homepage fillers. This keeps
the original real-data and server-rendering principles while replacing three repetitive daily
HealthKit cards with a more useful personal snapshot.
