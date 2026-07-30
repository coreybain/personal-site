# ADR 0005 — Convex is the single backend for web and iOS

- **Date:** 2026-07-30
- **Status:** Accepted

## Context

Two clients need the same data: the Next.js app (public site plus the `/admin` route group)
and the SwiftUI iOS admin. The build also needs scheduled work — an hourly git snapshot
refresh — and authenticated machine ingest endpoints for HealthKit and AI-usage pushes.

Assembling that from parts would mean a database, an API layer, a cron host, and a websocket or
polling story for the phone, each configured and deployed separately. Convex is already in use
in the v2 app, so the operational knowledge exists.

## Decision

Use **Convex** as the single backend for both clients: one schema, reactive queries, scheduled
functions, and HTTP routes for ingest. `packages/convex` holds the schema, queries, mutations,
crons, and HTTP routes; both `apps/web` and `apps/ios` read from it.

## Consequences

- One schema means the web admin and the iOS admin cannot disagree about the shape of a project
  or a post — a real risk with two hand-written API layers.
- Scheduled functions are built in, so there is no separate cron infrastructure to provision or
  monitor for the git snapshot pipeline.
- Reactivity is available to both clients, which is what makes the phone-to-browser live-query
  test in ADR 0007 meaningful.
- It is a platform commitment: Convex's auth integration story constrains the auth choice
  (ADR 0006), and its Swift client constrains the iOS data path (ADR 0007).
