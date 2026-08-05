# Glossary

The vocabulary this project uses in code, schema names, ADRs, and commit messages. These terms are
load-bearing — several of them name a specific table, a specific privacy boundary, or a specific
performance guarantee, so they are worth using precisely.

| Term | Meaning |
| --- | --- |
| **Snapshot** | A single denormalised Convex row holding every precomputed dashboard statistic. The homepage reads exactly one document. Rebuilt on a schedule, never on request. |
| **Signal** | One live-data element on the dashboard — the git heatmap, AI usage, the latest walk. Signals are read from the Snapshot, never from a third-party API at request time. |
| **Ingest** | Authenticated machine-to-server push of data that cannot be pulled: HealthKit from the phone, AI usage from the local agent. Bearer-token auth, never a user session. |
| **Collector** | The local scheduled script that parses `~/.codex` and `~/.claude`, computes aggregates, and pushes them. Only aggregates leave the machine — never prompts, code, or file contents. |
| **Attribution** | Naming Corporate Interactive as the client or employer on a case study. Required on every CI project. Distinct from **Ownership**, which means the code is theirs. |
| **Case Study** | A portfolio entry for client or employer work. Always attributed, always sanitised, never repo-linked. |
| **Lab** | A personal side project. Curated in deliberately, repo-linked, augmented with live GitHub stats. |
| **Favorite Lab** | The single published Lab explicitly selected in Site Settings for the Off-clock Dashboard. Independent of a Lab's `featured` flag and stable until the owner changes it. |
| **Off-clock Dashboard** | The homepage's personal signal section: up to three fixed peer cards for Favorite Lab, a distinct Lab ranked from fresh public activity, and trailing-seven-day movement. |
| **Fun Entry** | A dated life item — beer, coffee, walk, pub. Photo-first, usually captured from the phone. |
| **Resume Document** | The single Convex-backed record from which both the web resume and the PDF render. One source of truth. |

## Where each term lives

- **Snapshot** → the `snapshot` singleton table; mocked during early phases at
  `apps/web/src/lib/snapshot.ts`.
- **Signal** → dashboard components on `/`.
- **Ingest** → Convex HTTP routes under `/ingest/*`, authenticated against `ingestTokens`.
- **Collector** → `tooling/collector/` (Bun script plus launchd plist).
- **Case Study** → the `projects` table, rendered at `/work` and `/work/[slug]`.
- **Lab** → the `labs` table, rendered at `/labs`.
- **Favorite Lab** → `siteSettings.favoriteLabSlug`, selected from the web or iOS settings UI.
- **Off-clock Dashboard** → the server-rendered fixed-role section on `/`; see
  [ADR 0019](../adr/0019-off-clock-personal-dashboard.md).
- **Fun Entry** → the `funEntries` table, rendered at `/fun`.
- **Resume Document** → the `resumeDocument` singleton, rendered at `/resume` and
  `/api/resume.pdf`.
