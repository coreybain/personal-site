# ADR 0002 — Turborepo monorepo, managed with Bun

- **Date:** 2026-07-30
- **Status:** Accepted

## Context

The outcome this build is aiming at is not one app. It is a public Next.js site with an
embedded admin, a native SwiftUI iOS admin, a Convex backend shared by both, a PDF resume
renderer, and a local collector script — all of which have to agree on one data contract.
Those pieces need shared types and a single install/build/lint/typecheck story, or the contract
drifts and every change becomes a cross-repo coordination problem.

Bun is already the de-facto toolchain: `bun.lock` is committed, dev scripts call `bunx`, and
Bun is in use across the work repos. Introducing a second package manager here would mean two
lockfile formats and two sets of install semantics for no gain.

## Decision

Use a **Turborepo monorepo** with **Bun** as the package manager and task runner underneath
Turbo. Workspaces are `apps/*` and `packages/*` (plus `tooling/*` for the collector). Internal
packages are named `@home/<name>` and are just-in-time TypeScript — `exports` point at
`./src/*.ts`, there is no build step, and each package carries a `typecheck` script
(`tsc --noEmit`).

## Consequences

- One `bun install`, one dependency graph, one place to change a shared type. `packages/types`
  can be the real source of truth rather than a copy-paste convention.
- Turbo gives cached, parallel `build` / `lint` / `typecheck` across workspaces, which is what
  makes enforcing the performance budget in CI (ADR 0013, and the budget table) affordable.
- No build step for internal packages means no stale `dist/`, but it also means consumers must
  be able to transpile TypeScript from `node_modules` — fine for Next.js and for Bun scripts.
- Xcode does not consume npm packages, so `apps/ios` gains nothing from the install graph
  directly; it gains the *contract* (see ADR 0007 and the generated Swift `Codable` structs).
