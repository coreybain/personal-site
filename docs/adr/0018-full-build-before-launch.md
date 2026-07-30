# ADR 0018 — Full build before launch; the blog may launch empty

- **Date:** 2026-07-30
- **Status:** Accepted

## Context

There are two ways to ship this. Launch incrementally — put the dashboard up early and add work,
labs, and resume over time — or build the whole thing and cut over once. Incremental launching
gets the better homepage in front of employers sooner, but it means a period where the new site is
visibly thin, which is a worse signal than a wordy-but-complete one.

The blog is a special case: it is empty today, and writing posts is not a prerequisite for
demonstrating engineering capability.

## Decision

**Build fully before launching.** Work and Labs must be complete at cutover; the **blog may launch
empty**, with its nav entry hidden until it has content. This is the user's call, made explicitly.

## Consequences

- Nothing half-built is ever public. The first impression of the new site is the finished one.
- **The cost is a long window in which employers still see the wordy v2 site.** Accepted knowingly.
- **Mitigation:** build against a Vercel preview URL, kept `noindex` until launch (verified as part
  of the cutover rehearsal). `spiritdevs.com` stays live and unmodified throughout, so there is no
  regression risk from the build itself.
- Phases 1–6 deliver a complete, launchable web experience on their own. If the timeline slips, the
  iOS app (phase 7) can be decoupled from launch without blocking it.
- Hiding the blog nav until populated avoids repeating v2's most visible flaw — a published section
  that says "No blog posts published yet".
