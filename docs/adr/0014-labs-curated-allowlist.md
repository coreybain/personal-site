# ADR 0014 — Labs is a curated allowlist with live stats

- **Date:** 2026-07-30
- **Status:** Accepted

## Context

`/labs` shows personal side projects, repo-linked, augmented with live GitHub statistics. The
tempting implementation is to auto-sync from the GitHub account: zero maintenance, always current.

The account's actual contents make that a bad idea. Auto-sync would surface `dddddd`, `test`,
throwaway client scratch repos, and 2016 Udacity coursework directly to hiring managers — noise
that actively undercuts the signal the page exists to send. A page assessing engineering judgement
should demonstrate some.

(That list used to name one of those scratch repos. It was a private client repo, this repository
is public, and ADR 008 says private repo names are never written down here — `tooling/privacy-check`
now catches that class mechanically with `--tree`.)

## Decision

Curate Labs as an explicit **allowlist**: each entry is a `labs` record with a slug, title,
summary, `repoFullName`, links, and `featured`/`published` flags. **Live GitHub stats are fetched
per allowlisted repo** by the git snapshot cron, so entries stay current without the page being
auto-populated.

## Consequences

- Only work worth showing appears, and every entry is a deliberate choice — the curation itself
  is a signal.
- Statistics stay live, so the page does not decay into a stale list; only membership is manual.
- Adding a new project requires an admin action. That is the intended friction, and it is cheap
  from the iOS app.
- Per-repo stats for allowlisted repos are a defined output of the git snapshot pipeline, which
  keeps `/labs` on the same one-read-from-Snapshot discipline as the homepage.
