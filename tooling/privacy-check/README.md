# `@home/privacy-check` — the ADR 008 gate

> **Snapshot correctness:** … Assert no private repo name appears in any public
> response — automated test over the rendered output.
>
> — the Verification section of the build plan

This is that test. It runs against a **live deployment**, unauthenticated, and
exits non-zero on a finding, so it works as a pre-cutover gate and as CI.

```sh
# the deployment the repo is configured against
bun --env-file=.env run tooling/privacy-check/check.ts

# an explicit deployment
bun run tooling/privacy-check/check.ts --url https://<name>.convex.cloud

# …and the rendered pages of a running site as well
bun run tooling/privacy-check/check.ts --url https://<name>.convex.cloud --site http://localhost:3000

# …and this repository's own source, committed or about to be
bun --env-file=.env run tooling/privacy-check/check.ts --tree
```

No dependencies, no install, no workspace entry — same as `tooling/collector`
and `tooling/seed`.

## Why this check exists at all

The repos are client-owned. ADR 008 is not a preference about tidiness, it is
the term on which this site is allowed to show the 6,433 figure at all:

> Git activity: aggregate totals + named CI projects. Uses the full 6,434
> figure. **Private repos are never named, no repo links, no commit detail.**
> Named case studies only.

A leak here discloses Corporate Interactive's and SpiritDevs' code inventory —
somebody else's information, published under Corey's name. That is the failure
this guards, and it is why the check fails loudly rather than warning.

## What it checks against what

**The corpus** (`repos.ts`) is built from two independent sources, because each
catches leaks the other cannot:

| Source | Catches | Size today |
|---|---|---|
| Every private repo the PAT can see | Pipeline 1 — repos GitHub knows about that were never cloned here | 137 |
| `~/GitHub` working copies | Pipeline 2 — the Collector keys on **directory** names, and several differ from the GitHub name (`client-app-deploy` → `acme-corp/client-app-v2`) | 16 private of 50 |

> Every repository name in this README and in `repos.ts` is **invented**. This
> repo is public, the corpus is built live from `gh api` and `~/GitHub`, and a
> tool that exists to keep private names off the public internet must not be the
> thing that publishes them. See the header of `repos.ts`.

Each contributes three kinds of token: the `owner/name` **identifier**, the bare
repo **name**, and the local **directory** name.

**The surface** (`surface.ts`) is read with `POST /api/query` and no
credentials — deliberately *not* the Convex SDK and emphatically not
`convex run`, which authenticates with the deployment's **admin key** and would
sail straight past the auth checks this is trying to test. If it is readable
from here, it is readable from anywhere.

It follows the site's own link graph rather than a hardcoded list: the zero-arg
list queries supply the slugs that the per-slug queries are then swept with, so
new content is covered automatically.

**The repo tree** (`--tree`) is the third surface, and the one that was missed
first. `coreybain/personal-site` is a **public repository**: a private name in a
code comment, a README table or a test fixture is published exactly as
effectively as one rendered on a page, and the deployment sweep is structurally
blind to it because source is not a query response. That is not hypothetical —
it is how this flag came to exist. Phase 4 landed with real client repo
identifiers written into the privacy tool's own header, and the deployment check
passed the whole time.

Files come from `git ls-files --cached --others --exclude-standard`, i.e.
**tracked plus untracked-minus-ignored**. Both halves matter:

- `--others` is what catches a leak in a file that has not been committed yet,
  which is the only moment it is still free to fix;
- `--exclude-standard` is what keeps `tooling/collector/collector.config.json`
  out of scope. That file *is* a list of private checkout directories, it is
  gitignored for exactly that reason, and it is therefore not public and not
  this check's business. The exclusion is structural, not an exception list.

Paths are matched as well as contents, so `docs/<client>-notes.md` fails on its
own filename.

It also probes three things that are not name matching:

- `projects:list` / `labs:list` with `includeDrafts: true` — a draft case study
  is by definition text that has not been through the ADR 009 sanitisation pass,
  and `includeDrafts` is a *public argument*. (It requires admin. Verified.)
- `contactMessages:list` / `counts` and `ingestTokens:list` must reject an
  anonymous caller outright. (They do — `requireAdmin`.)

## The part that needs a human: `REVIEW`

ADR 008 does not say "no client names". It says the opposite — "**named CI
projects**", "Named case studies only". QuoteCloud, TravelDocs, ZeroRisk and
SoldOnline are each *also* the name of a private repository, so a naive grep
fails on a correct site.

So the check draws the same line the ADR draws:

- A **repository identifier** (`owner/name`, or a github.com URL to one) is
  never permitted, not even for QuoteCloud. That is "no repo links".
- A **bare product name** is permitted exactly when the site has *published* a
  case study or lab under it. Publishing is the sanctioning act: it is a
  hand-written, hand-reviewed row, not something a pipeline can do by itself.

Sanctioned hits are printed as `REVIEW` with a count, not hidden. The sanction
list is read from the deployment at check time rather than hardcoded, so the
tool cannot grant an exemption the site never actually published.

## What it does not prove

A paraphrase ("the bowling-alley site"), a repo name inside a screenshot, or
text baked into an OG image are all invisible to a text search. Ten names are
skipped as too generic to test (`client`, `server`, `website`, …) and are listed
with reasons in `repos.ts`.

This is a regression gate on the mechanical failure mode — a pipeline that
starts emitting a name it used to suppress — which is the one that happens
silently and at 3am. The judgement calls stay with phase 8.

## Current result

```
corpus      295 names (137 private repos on GitHub, 16/50 local working copies private,
                       10 skipped as too generic)
surface     24 responses, 50.8 KB
tree        352 tracked files read, 35 skipped (binary or large)

REVIEW — 5 name(s) published as case studies (ADR 008 permits this):
  QuoteCloud ×84   SoldOnline ×15   TravelDocs ×16   boca ×60   zerorisk ×42

PASS — no private repo identifier, name or directory in 376 public responses and
       tracked files.
```

The first `--tree` run did **not** pass. It found two things the deployment
sweep could not: the client identifiers this tool had written into its own
source, and one private scratch-repo name that had been sitting in a committed
ADR since long before phase 4. Both are gone; the flag is why they are findable
next time.

Notably clean given that the Collector had just pushed real session data: **nine
unmapped repositories** were counted in those totals, and not one of their names
reaches the deployment. That is the funnel in `collector.config.json` working —
a directory with no `slug` entry contributes to the totals and is attributed to
nothing.

Nine is a count, deliberately. Listing which nine here would be the same
disclosure the check exists to prevent, made by hand instead of by a pipeline;
`bun run inventory` in `tooling/collector` prints them to a terminal and nowhere
else.
