# ADR 0021 — No human sign-in; manage content through the MCP server

- **Date:** 2026-09-29
- **Status:** Accepted
- **Supersedes:** ADR 0006

## Context

ADR 0006 made Clerk the sign-in for the browser admin and the iOS app. The
browser admin has been removed, and Corey now manages everything through the
MCP server (`packages/mcp`), which authenticates against Convex with scoped,
revocable management tokens and never uses a Clerk session. The last web route
that read a Clerk identity, the iOS image upload `/api/native/upload`, had never
worked in production (its admin allowlist was never set in Vercel).

## Decision

Remove Clerk everywhere it runs:

- **Website:** delete `/api/native/upload`, `src/proxy.ts`,
  `lib/adminAuthorization.ts` and `@clerk/nextjs`. The site has no sign-in,
  middleware or session of any kind.
- **Convex:** delete `auth.config.ts`, so no JWT is accepted from any client.
  Owner-only functions (`requireAdmin`) remain and are reachable only through
  the Convex CLI with deploy credentials and `--identity`.
- **Environment:** remove `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and
  `CLERK_SECRET_KEY` from Vercel and `.env`, and `CLERK_JWT_ISSUER_DOMAIN` from
  Convex. `ADMIN_CLERK_USER_ID` stays in Convex as the owner identifier that
  management tokens belong to.

## Consequences

- Content changes go through the MCP server, or the Convex CLI for operations
  it does not cover yet.
- The iOS app's sign-in, editing screens, token screen and photo upload no
  longer work; its source still contains the Clerk SDK. HealthKit sync keeps
  working with an already-stored ingest token, because ingestion uses scoped
  bearer tokens (ADR 006a), not Clerk.
- Ingest tokens can no longer be issued from a signed-in client; use
  `ingestTokens:issueForMachine` from the CLI.
