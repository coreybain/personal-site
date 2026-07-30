# ADR 0007 — `convex-swift` (ConvexMobile) is the iOS data path

- **Date:** 2026-07-30
- **Status:** Accepted

## Context

The iOS app is the primary admin surface: content CRUD, camera capture for Fun Entries, and
HealthKit ingest. Two options exist for talking to Convex from Swift. Either call Convex
`http.ts` endpoints with `URLSession` and hand-roll request/response handling, or use the
official `get-convex/convex-swift` package (ConvexMobile), which gives live queries — the same
reactive subscription model the browser gets.

`convex-swift` is official but small: 47★. It exposes an `AuthProvider` protocol, and only an
Auth0 adapter ships. Since human auth is Clerk (ADR 0006), an adapter has to be written.

## Decision

Use **`convex-swift` (ConvexMobile)** for the iOS data path, and write the missing Clerk
`AuthProvider` adapter as the **first** task of build phase 7 rather than the last.

## Consequences

- Live queries mean an edit made on the phone appears in the browser admin without a refresh.
  That is the explicit verification test for this decision, and it validates the adapter at the
  same time.
- **Cost:** a Clerk `AuthProvider` adapter must be written and maintained against a 47★ package.
  This is the largest technical risk in the iOS phase, which is why it is sequenced first — a
  failure surfaces while there is still room to change course.
- **Fallback:** if ConvexMobile proves unstable, drop to Convex `http.ts` endpoints plus
  `URLSession`. That loses live queries and nothing else; CRUD and ingest still work.
- Swift `Codable` structs are generated from `packages/types` Zod schemas by a Turbo task, so the
  contract cannot drift regardless of which transport is in use.
