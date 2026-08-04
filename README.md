# home

Monorepo for **coreybaines.com V3** — a personal site built around a live "snapshot" of
what I'm actually doing: git activity, AI-agent usage, project case studies, and the
occasional beer.

Managed with [Turborepo](https://turbo.build) + [Bun](https://bun.sh).

## Layout

```
home/
├── apps/
│   ├── web/            # Next.js (App Router) — the site. LIVE NOW.
│   └── ios/            # SwiftUI companion app.            (to come)
├── packages/
│   ├── convex/         # Convex backend: schema, queries, snapshot row.  (to come)
│   ├── ui/             # Shared React primitives and design tokens.
│   ├── types/          # Shared TS types (snapshot contract, etc.).      (to come)
│   └── pdf/            # PDF/resume generation.                          (to come)
└── tooling/
    └── collector/      # Ingest jobs: GitHub stats, AI session logs, fun entries. (to come)
```

Only `apps/web` exists today. Everything else is scaffolded as the plan lands.

## Getting started

```bash
bun install
bun run dev            # turbo run dev across all apps
```

Or just the web app:

```bash
cd apps/web
bun run dev            # http://localhost:3000
```

## Tasks

| Command              | What it does                                  |
| -------------------- | --------------------------------------------- |
| `bun run dev`        | Dev servers (persistent, uncached)            |
| `bun run build`      | Production builds                             |
| `bun run lint`       | ESLint across workspaces                      |
| `bun run typecheck`  | `tsc --noEmit` across workspaces               |
