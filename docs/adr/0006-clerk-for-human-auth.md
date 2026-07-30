# ADR 0006 — Clerk for all human auth, browser and iOS

- **Date:** 2026-07-30
- **Status:** Accepted

## Context

Exactly one human ever signs in: Corey, to the admin surfaces. But that human signs in from two
places — the `/admin` route group in the browser and the native SwiftUI app — and the iOS side
is where the choice is actually decided.

The v2 app uses better-auth. better-auth has no iOS SDK, so using it would mean hand-rolling
Keychain storage, token refresh, and session lifecycle in Swift: security-sensitive plumbing,
written once, maintained by one person, for a single-user login. Clerk ships a first-class,
actively maintained iOS SDK (`clerk/clerk-ios`, last pushed 2026-07-29), and Clerk↔Convex is a
documented, standard pairing.

## Decision

Use **Clerk** for all human authentication on both clients. Convex validates Clerk identities;
`/admin` in the browser and the iOS app both authenticate through Clerk.

## Consequences

- No hand-written Keychain or refresh logic in Swift. The riskiest part of the iOS auth path is
  delegated to a maintained SDK.
- Dropping better-auth is a clean break rather than a migration, because the repo is fresh
  (ADR 0001) and there is one user account to recreate.
- Clerk becomes a third-party dependency in the sign-in path for admin surfaces. The public site
  does not depend on it, so a Clerk outage cannot take the site down — only editing.
- ConvexMobile expects an `AuthProvider`, and only an Auth0 adapter ships. Choosing Clerk
  therefore incurs the adapter cost recorded in ADR 0007.
- Machine-to-server ingest deliberately does **not** use Clerk — see ADR 0006a.
