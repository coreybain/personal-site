# ADR 0017 — `coreybaines.com` is the primary domain

- **Date:** 2026-07-30
- **Status:** Accepted

## Context

Both domains are owned, and today `coreybaines.com` 307-redirects **to** `spiritdevs.com`. That
made sense for an agency-shaped identity; it does not for the current goal.

The goal is a Principal Engineer role. A hiring manager landing on "SpiritDevs" reads an agency —
a shop that might subcontract, might be a side business, might be a team. When the thing being
assessed is one individual's engineering judgement and seniority, that is the wrong signal, and it
introduces a question the reader has to resolve before they get to the work.

## Decision

Make **`coreybaines.com` the primary domain**. At cutover it points at the new deployment, and
`spiritdevs.com` redirects to it — the exact reverse of today's configuration.

## Consequences

- The site presents as a named individual, which is what is being assessed. The personal-name
  domain also matches the name on the resume, the GitHub profile, and every application.
- `spiritdevs.com` keeps its links working via redirect rather than going dark, so existing
  references and any accumulated SEO value are preserved.
- The redirect flip is a discrete cutover step (build phase 9), sequenced after the new deployment
  is verified — `spiritdevs.com` stays live and untouched until then (ADR 0018).
- SpiritDevs remains available as an org identity; it is simply not the front door.
