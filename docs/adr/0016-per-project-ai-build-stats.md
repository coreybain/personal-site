# ADR 0016 — Per-project AI build stats on case studies

- **Date:** 2026-07-30
- **Status:** Accepted

## Context

"AI-native delivery" is the kind of claim every candidate now makes and almost none can evidence.
Corey can: the local agent history is substantial (`~/.codex/sessions` at 5.9 GB,
`~/.claude/projects` at 436 MB), and it is attributable per project. Claude's directory names are
path-encoded (`-Users-coreybaines-GitHub-quotecloud-v2`), and Codex writes `cwd` into the
`session_meta` record on line 1 of each session JSONL. Both decode to a repo path, and a repo path
maps to a project slug.

This data is local only — there is no server-side API to pull it from — so it has to be pushed.

## Decision

Store an optional **`aiBuildStats`** field on `projects` and render it on case studies where
present. The local collector aggregates agent usage by repo, maps repo → project slug via admin
configuration, and pushes the result to `/ingest/ai-usage`.

## Consequences

- Case studies carry concrete per-project evidence of how the work was actually delivered, not an
  adjective about it.
- The same collector run feeds both the homepage AI Signal and these per-project figures — one
  pipeline, two surfaces.
- **Only aggregates leave the machine**: counts and durations, plus repo slugs. Never prompts,
  never code, never file contents. A unit test asserts the payload contains nothing else.
- The repo → slug mapping is manual admin configuration, and the field is optional, so projects
  without a mapping simply omit the block.
