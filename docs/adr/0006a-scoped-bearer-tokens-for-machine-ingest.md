# ADR 0006a — Scoped bearer tokens for machine ingest

- **Date:** 2026-07-30
- **Status:** Accepted

## Context

Three data sources push into the backend without a human present: HealthKit summaries from the
phone's background delivery, AI-usage aggregates from the launchd collector on the Mac, and git
statistics jobs. None of these have, or should have, a user session. A launchd script cannot
complete an interactive sign-in, and background HealthKit delivery fires when nobody is looking
at the phone.

Reusing the human session (ADR 0006) for these would mean long-lived user credentials sitting on
disk in a plist-launched script — impossible to revoke without locking Corey out of his own
admin, and impossible to reason about per-source.

## Decision

Authenticate machine ingest with **scoped bearer tokens**, stored hashed in an `ingestTokens`
table (`name`, `hashedToken`, `scopes[]`, `lastUsedAt`, `revokedAt`) and issued/revoked from the
admin. Each source gets its own token with only the scopes it needs. Ingest endpoints are
Convex HTTP routes and never accept a user session.

## Consequences

- Every automated source is independently revocable: leaking the collector's token costs the
  collector's token, not the account.
- `lastUsedAt` gives a cheap liveness signal — a collector that silently stopped running is
  visible without extra monitoring.
- Tokens are stored hashed, so the plaintext is shown once at issue time and cannot be recovered
  from the database.
- Issue and revoke flows are real admin work in build phase 2, not an afterthought, and the
  verification plan explicitly asserts that a revoked token is rejected.
