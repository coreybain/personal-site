# ADR 0015 — Ask Corey: keep it, and upgrade it

- **Date:** 2026-07-30
- **Status:** Accepted

## Context

The v2 site ships an "Ask Corey" feature. Its own finish-todo document records what it actually
is: a lexical matcher, not retrieval. It matches query terms against content strings, so it
answers well only when the asker happens to use the site's own wording — which reads as a demo
rather than a capability.

The instinct is to cut it as unfinished scope. But for a candidate arguing they are AI-native,
a working retrieval system over their own body of work is one of the few genuinely differentiating
things a personal site can contain. Cutting it removes the strongest AI-native claim; shipping it
as-is undermines that claim on inspection.

## Decision

**Keep Ask Corey and rebuild it properly** on embeddings: a `knowledgeDocs` table
(`sourceType`, `sourceSlug`, `title`, `url`, `plainText`, `embedding`, `published`), re-indexed on
publish, with real retrieval and citations. Rate-limit the endpoint.

## Consequences

- Answers work on meaning rather than shared vocabulary, and citations let a reader verify the
  answer against the source page — the same evidence-over-assertion principle as the dashboard.
- Indexing becomes a publish-time side effect (pipeline 4): publishing a project, lab, or post
  re-indexes its document.
- It is the only feature that calls a model at request time, so it needs rate limiting — which v2
  also lacked — and its cost profile is separate from the rest of the site.
- Scoped to build phase 6, after the public site and pipelines, so it never blocks launch-critical
  work.
