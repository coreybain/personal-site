# ADR 0008 — Git activity: aggregate totals plus named CI projects

- **Date:** 2026-07-30
- **Status:** Accepted

## Context

Corey's trailing-year contribution figure is **6,434**, of which **5,792 are private or
restricted** — the public number is 573 across 14 repos. Showing only public activity
understates the work by an order of magnitude and is the least accurate thing the site could
say. But the private work is client-owned: QuoteCloud, TravelDocs, ZeroRisk and SoldOnline all
belong to Corporate Interactive, and their repos, names and commit history are not Corey's to
publish.

The full figure is only obtainable at all because a stored personal access token can see private
contributions (see the git snapshot pipeline).

## Decision

Publish **aggregate totals** — the full 6,434 figure, the contribution calendar, and language
mix — alongside **named case studies** for the CI projects. Private repositories are never
named, never linked, and no commit-level detail is exposed. Named projects appear only as
attributed case studies, which is what the current site already does.

## Consequences

- The heatmap and the headline number reflect reality, which is the entire point of a dashboard
  built on evidence (ADR 0003).
- The separation is enforceable and is enforced: an automated test asserts that no private repo
  name appears in any public response, and the cron's totals are checked against a manual
  `gh api graphql contributionsCollection` call.
- Named-but-unlinked case studies mean a reader cannot independently verify a specific project.
  Attribution (ADR 0009 and the Glossary) is what carries credibility instead.
- Curated Labs entries are the exception that proves the rule — those are personal repos and
  *are* linked (ADR 0014).
