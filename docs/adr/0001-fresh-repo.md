# ADR 0001 — Fresh repo, not an evolution of `coreybain/coreybain`

- **Date:** 2026-07-30
- **Status:** Accepted (amended 2026-07-30 — see Amendment)

## Context

`spiritdevs.com` is already a "v2" build: a Next.js app living in the `coreybain/coreybain`
repo, deployed on Vercel, wired to Convex, better-auth, Tailwind v4 and the AI SDK. It fails
its own goal measurably — the homepage is 548 words of prose with zero `<img>` tags, `public/`
still holds only the Next.js starter SVGs, the blog is empty, and the repo's own
`personal-site-v2-finish-todo.md` documents content as static in `src/lib/site/content.ts`
with placeholder admin tables.

V3 changes the data model, the auth story, the backend contract and the entire design system.
Carrying that through the v2 repo would mean a long-lived migration against code that is
already being deleted, inside a repo whose name doubles as Corey's GitHub profile README.

## Decision

Start a **fresh repository** with a clean slate for the data model and design system. The old
`coreybain/coreybain` repo reverts to being purely a GitHub profile README; its Next.js app is
archived at cutover (build phase 9) with the profile README preserved.

## Consequences

- No migration burden, no half-deleted v2 code paths, and no compatibility shims — the Snapshot
  contract can be designed for the dashboard rather than retrofitted onto v2's content module.
- Git history for the old site is not carried forward. That history has no ongoing value: the
  site it describes is being replaced wholesale.
- `spiritdevs.com` keeps serving from the old repo, untouched, for the whole build window
  (see ADR 0018), so there is no window where the live site is broken.
- The profile README stays where GitHub expects it, at `coreybain/coreybain`.

## Amendment (2026-07-30)

The Decision Record originally named the fresh repo `~/GitHub/home`
(and the monorepo layout was sketched with a `home/` root). The repo actually landed at
**`~/GitHub/personal-site`**, remote **`github.com/coreybain/personal-site`**.

The decision itself is unchanged — fresh repo, clean slate, old repo reverts to a profile
README. Only the local path and repo name differ. Where other documents, the plan, or older
ADRs say `home/` or `~/GitHub/home`, read `personal-site/` and `~/GitHub/personal-site`. The
root `package.json` still declares the package name `home`, and internal packages are still
named `@home/<name>`; that naming is deliberate and is not affected by this amendment.
