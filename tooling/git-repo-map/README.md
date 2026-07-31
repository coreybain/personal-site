# git repo map

Maps a GitHub repository to the name the site is allowed to call it in the
heatmap's day popup.

```
bun run tooling/git-repo-map/seed.ts            # validate, print, write nothing
bun run tooling/git-repo-map/seed.ts --push     # upsert into Convex
bun run tooling/git-repo-map/seed.ts --counts   # what does the table hold?
```

## Why this exists

The homepage heatmap's day popup answers *"which projects, and how many commits
each"*. Two facts make that harder than it sounds:

1. **Most of Corey's commits are in private repositories.** ADR 008 is absolute
   that a private repository *name* never reaches a stored public field.
2. **The named case studies are private repositories.** QuoteCloud, TravelDocs,
   ZeroRisk and SoldOnline are published, attributed work — their *titles* are
   already on the site. Publishing the case study was the sanctioning act.

So the popup may say `QuoteCloud · 5 commits` and may never say
`contoso-widgets/pricing-portal-v2`. The gap between those two sentences is exactly one
piece of knowledge — *which repository is QuoteCloud* — and this directory is
where that knowledge lives without being published.

## The shape of the guarantee

| | |
|---|---|
| `git-repo-map.json` | **gitignored.** The real mapping. Machine-local. |
| `git-repo-map.example.json` | committed. Same shape, invented repository names. |
| `gitRepoMap` (Convex) | **no public query may ever exist.** Fenced in `schema.ts`, enumerated in `privateTables` in `@home/types` so it is testable rather than remembered. |
| `repoMap.ts` (Convex) | every function is `internalQuery` / `internalMutation`. No `console.*` anywhere in it. |
| `seed.ts` | never prints a `repoFullName` — not on success, not in a validation error, not in a Convex error passed through. |

This is the same pattern as `tooling/collector`, which keeps its
directory→slug mapping in a gitignored `collector.config.json` for the same
reason: `coreybain/personal-site` is a **public** repository, so committing the
mapping would publish the inventory the mapping exists to withhold — a quieter
version of the leak, but permanent and indexable.

The only egress from the table is `gitStats.rebuild`, which reads it, resolves
`repoFullName → displayName`, and emits the display name.
`assertNoRepoIdentifiers` in that file then refuses to write a calendar
containing anything that is not on an allowlist, contains a `/`, or matches a
repository GitHub just named.

## Getting started

```bash
cp tooling/git-repo-map/git-repo-map.example.json tooling/git-repo-map/git-repo-map.json
$EDITOR tooling/git-repo-map/git-repo-map.json
bun run tooling/git-repo-map/seed.ts           # check it parses; prints display names only
bun run tooling/git-repo-map/seed.ts --push
cd packages/convex && bunx convex run gitStats:rebuild '{}'
```

`--push` is required. The default is a dry run, because the failure mode of the
opposite default is "I ran it to see what it would do".

## Entry shape

```json
{ "repoFullName": "owner/name", "displayName": "QuoteCloud", "kind": "project" }
```

`repoFullName` is lowercased on the way in — GitHub is case-insensitive about
repository names and a hand-written file will say `CoreyBain/Boca` as often as
`coreybain/boca`.

| `kind` | meaning |
|---|---|
| `project` | A sanctioned case study. `displayName` **must** equal the `projects` row's `title` exactly, or the site says two names for one thing. |
| `lab` | A curated Lab (ADR 014). Mostly for the private repo a Lab is *built from* — a public Lab is already attributed automatically from its own public `repoFullName`, with no row needed here. |
| `ignore` | Fold into `Other work`, silently. |

Several repositories may share one `displayName`: a case study spanning an API, a
web app and a mobile client is one project to a reader, and their commits merge
into a single popup row.

### `ignore` vs. no row at all

They behave identically — both fold into `Other work`. The difference is that
one is a **decision** and the other is a **gap**. Writing an `ignore` row for a
2016 coursework repo records that somebody looked at it and concluded it stays
unsurfaced (ADR 014's junk repos); leaving it out records nothing. Behaviour
today is the same; the value is to whoever reads the file next year.

## What happens to unmapped repositories

Nothing is ever inferred from a repository name. A heuristic that turns
`pricing-portal-v2` into `QuoteCloud` guesses right nine times and leaks on the
tenth.

| the repo is… | the popup shows |
|---|---|
| mapped, `project` / `lab` | the `displayName` |
| mapped, `ignore` | `Other work` |
| unmapped, publicly visible | `Other work` |
| unmapped, private | nothing — the commits are counted in the day's total and attributed to no one |

The last row is not a bug and cannot be fixed from here:
`contributionsCollection.commitContributionsByRepository` **never itemises
private repositories**, even for the viewer's own token with full `repo` scope.
(Measured: a 30-day window with 972 `restrictedContributionsCount` and 15
actively-pushed private repos returns zero private rows.) `gitStats.ts` works
around that for *mapped* repos by querying their commit history directly — which
is precisely why the set of private repositories the pipeline touches at all is
bounded by this file, and why nothing is ever discovered or enumerated.

`ContributionDaySchema` permits the resulting shortfall explicitly:
`sum(commits) ≤ count`, and the gap is left unexplained rather than papered over.
`Other work` carries real commits the site declines to name — it is never a
remainder.

## `--prune`

Off by default. On, it deletes every row absent from the local file, making the
file the whole truth rather than a set of additions — which is what you want
when an entry has been *removed* because a repo should stop being attributed.

It is opt-in because the payload comes from one machine's file, and a second
machine seeding a partial list would otherwise silently unmap the first
machine's work.

## Verifying

```bash
bun --env-file=.env run tooling/privacy-check/check.ts --tree
```

The sweep reads every public response (including `snapshot:get`, which carries
the calendar) and this repository's tracked *and untracked-but-not-ignored*
files, and fails on any private repository name. `git-repo-map.json` is excluded
by construction rather than by an exception list: it is gitignored, so it is not
public, so it is not that tool's business.

The sweep additionally asserts, structurally, that no name in any
`byProject` entry contains a `/` or is anything other than a published title or
`Other work` — see `auditContributionBreakdown` in
`tooling/privacy-check/surface.ts`.
