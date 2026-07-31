# `@home/perf` — the performance gate

> **Performance budget** — these are gates, not aspirations.
>
> — the Design system section of the build plan

This package is the "gate" half of that sentence. Two tools:

| | |
|---|---|
| `budget.ts` | Gzipped first-load JS per public route, read out of the production build's prerendered HTML. Exits non-zero on a breach. Zero dependencies. |
| `lighthouserc.cjs` | Lighthouse CI against a locally built and started production server, asserting the plan's LCP and CLS numbers. |

```sh
cd apps/web && bun run build     # both tools read this build
bun run tooling/perf/budget.ts   # from anywhere in the repo
bun run tooling/perf/budget.ts --verbose   # + per-chunk breakdown
bun run --cwd=tooling/perf lhci
```

`.github/workflows/ci.yml` runs both on every push and pull request.

---

## TODO — the homepage is 75% over the plan's JS target

This is the headline and it is not buried on purpose.

| Metric | Plan target | Measured today | Gap |
|---|---|---|---|
| **Homepage JS (gzipped)** | **< 100 KB** | **175.2 KB** | **+75.2 KB — 75% over** |
| LCP (desktop) | < 1.2 s | 0.71–0.91 s, median 0.83 s, **24 of 24 runs** | met, decisively |
| LCP (mobile, Slow 4G + 4× CPU) | — | **3.6–4.2 s** | the open item below |
| CLS | < 0.05 | **0.000 on every route, every run, both presets** | met, decisively |

The JS gap is **not closeable by application changes**, and the measurement that
settles it is `/_not-found` — a page whose entire body is a heading and a link:

```
route             gzip     brotli    budget    plan   status
/_not-found     144.9 KB  125.2 KB   150 KB       —   pass     ← framework floor
/               175.2 KB  152.4 KB   180 KB     100   pass
```

**144.9 KB is the floor.** None of it is Corey's code:

| Chunk group | gzip | What |
|---|---:|---|
| React + React DOM client | 62.7 KB | one chunk, `react-dom` 19.3 canary |
| Next 16 App Router client runtime | 82.2 KB | nine chunks — router reducer, segment cache, bfcache, prefetch scheduler, route announcer, error boundaries, Turbopack runtime |
| **floor** | **144.9 KB** | before one line of this site loads |

The homepage adds 30.3 KB on top of that:

| | gzip | |
|---|---:|---|
| `motion`'s `domAnimation` feature bundle | 12.7 KB | **see "the one addressable item" below** |
| `motion`'s `m` + `LazyMotion` + `MotionConfig`, bundled with the footer theme picker | 9.7 KB | the shared `(site)` layout chunk — ADR 013's ~5 KB entrypoint plus a component |
| the homepage's own client components | 8.0 KB | the `npx coreybaines` copy picker |

So: even deleting every client component and all of `motion` from the homepage
lands at 144.9 KB, still 45% over the plan's number. Reaching 100 KB would mean
not shipping the App Router client runtime at all — a different architecture,
not a diet. The plan's figure was written before Next 16 and React 19 were
measured; it is kept in the table above and printed by `budget.ts` on every run
rather than quietly revised away, because it is a real number a real person
wrote down and the gap is the interesting part.

**What is gated instead:** a per-route ratchet in `budgets.ts`, set at the first
honest measurement plus a few KB of headroom. It cannot stop the site being
heavy. It can stop it getting heavier, which is the failure that actually
happens — and it is the only failure that was ever going to happen silently.

### The one addressable item

`motion`'s `domAnimation` feature bundle — 12.7 KB gzipped, 7% of the homepage —
is emitted as a `<script async>` in the prerendered HTML of **every** `(site)`
route, so it is fetched and executed on first load.

ADR 013 intends otherwise: `MotionProvider` loads it with
`() => import("./features")` precisely so it lands *after* paint. The dynamic
import is written correctly; the chunk arrives in the initial script set anyway.
Worth an hour with the Turbopack chunking docs before anyone concludes the
budget is immovable. It is the largest single win available and it is still only
12.7 KB.

### And a note on what is *not* counted

Next emits a 38.6 KB gzipped (110 KB raw) legacy polyfill chunk marked
`noModule`. No browser released this decade downloads it. `budget.ts` excludes it
by attribute. Counting it would inflate every route by ~22% and the number would
be a fiction — a *pessimistic* fiction, which is the kind that is hardest to
argue with and just as wrong.

---

## FIXED — LCP used to report two runs in three

Kept as a record rather than deleted, because the mechanism is a trap anyone
adding an entrance animation to this site can walk back into.

For most of phase 3, **8 of 24 Lighthouse runs reported NO_LCP** — no largest
contentful paint value at all — and which runs those were moved between
invocations. On the last measurement before the fix the homepage produced *none*
of three. The cause was `.hor-rise` in `apps/web/src/app/(site)/horizon.css`:

```css
.hor .hor-rise { animation: hor-rise 0.85s var(--hor-ease) both; }
@keyframes hor-rise { from { opacity: 0; transform: translate3d(0, 12px, 0); } }
```

Chrome does not treat an element painted at `opacity: 0` as an LCP candidate,
and `animation-fill-mode: both` held it at zero through its stagger delay — up
to 650 ms on the homepage. Everything above the fold carries the class, so the
hero's first *eligible* paint was roughly `delay + fade` after first paint, which
on a localhost load that has otherwise settled inside 400 ms lands at the edge of
Lighthouse's trace window. Whether a run got a number was a race between the CSS
entrance and the end of the trace. Not a Lighthouse quirk: the same eligibility
rule governs the field data Chrome reports to CrUX.

**The remedy was one value**: `from { opacity: 0 }` → `from { opacity: 0.01 }`.
One percent alpha under a 12 px-travel fade is not perceivable, and the element
is an LCP candidate from its first paint.

Measured immediately after, desktop preset, three runs per route:

| | before | after |
|---|---|---|
| runs producing an LCP value | 16 / 24 | **24 / 24** |
| homepage | **0 / 3** | 3 / 3, median 0.83 s |
| element Lighthouse names | sometimes `<span class="hor-sec-meta">` | the `<h1>`, the portrait, the lede — every time |

`largest-contentful-paint` and `total-blocking-time` were promoted from **warn**
to **error** on the strength of that. TBT had the same root cause — Lighthouse
derives it from the LCP timestamp, so it errored out on the same routes.

The LCP assertion is set at **2500 ms**, not the plan's 1200 ms, and
`lighthouserc.cjs` gives the whole argument next to the number: the plan's target
is met on every run here, but LCP on this site is bound by the 650 ms entrance
stagger rather than by paint, and nobody has measured what a shared 4-vCPU GitHub
runner does to that. 2500 ms is the Core Web Vitals "good" boundary — a real
number, and still tighter than this file's 4–5× doctrine for FCP and Speed Index.
Ratchet it down towards 1200 ms once CI has produced a fortnight of numbers.

---

## TODO — mobile LCP is 4 s

New, and only visible *because* the entrance fix made the mobile preset
measurable at all. On Lighthouse's default mobile preset (simulated Slow 4G,
4× CPU slowdown), two runs each:

| route | FCP | LCP | TBT | CLS | LCP element |
|---|---|---|---|---|---|
| `/` | 1.51 s | **3.81 / 4.15 s** | 54 ms | 0.000 | the portrait `<img>` |
| `/resume` | 1.51 s | **4.22 / 3.64 s** | 34 ms | 0.000 | the lede `<p>` |

That preset is deliberately pessimistic and these are not field numbers, but 4 s
is 1.6× the Core Web Vitals "good" boundary and the homepage's LCP element is a
single large hero image — which is a lever, not a mystery. Worth a pass on the
portrait's dimensions, `sizes` and format before cutover.

It is **not** gated: the assertions run on desktop, because encoding an
unstarted optimisation as a red build is how a gate gets disabled. See the
"Desktop, not mobile" section of `lighthouserc.cjs`, which now says this rather
than the obsolete "mobile cannot be measured".

This is also the closest instrument the repo has to the plan's own human
acceptance criterion — "review the homepage on a phone at 4G throttling, the
five-second-snapshot test" — and it says: currently passes, with 0.8 s to spare
and no margin for a heavier hero.

---

## Measured baseline

Everything below is from a local run: macOS on Apple silicon, production build
with **no Convex environment** (mock data), Lighthouse desktop preset, three runs
per route, median. Reproduce with the two commands at the top of this file.

### First-load JS — gzip, level 9, per chunk, `noModule` excluded

```
route             gzip     brotli    budget    plan   status
/_not-found     144.9 KB  125.2 KB   150 KB       —   pass
/               175.2 KB  152.4 KB   180 KB     100   pass
/work           167.9 KB  145.8 KB   174 KB       —   pass
/work/[slug]    167.2 KB  145.3 KB   172 KB       —   pass
/labs           172.6 KB  150.0 KB   178 KB       —   pass
/blog           167.2 KB  145.3 KB   172 KB       —   pass
/blog/[slug]           —         —   172 KB       —   none     (ADR 018: no posts)
/fun            167.2 KB  145.3 KB   172 KB       —   pass
/resume         167.2 KB  145.3 KB   172 KB       —   pass
/contact        174.3 KB  151.5 KB   180 KB       —   pass
/variants       148.3 KB  128.3 KB   154 KB       —   pass
/v/[variant]    149.8 KB  129.6 KB   154 KB       —   pass
```

### Lighthouse — desktop preset, median of 3

```
route              FCP      LCP      SI      TBT     CLS    LCP runs
/                0.29 s   0.83 s   0.41 s    0 ms   0.000     3/3
/work            0.35 s   0.82 s   0.37 s    0 ms   0.000     3/3
/work/quotecloud 0.25 s   0.79 s   0.38 s    0 ms   0.000     3/3
/labs            0.39 s   0.89 s   0.39 s    0 ms   0.000     3/3
/blog            0.35 s   0.79 s   0.36 s    0 ms   0.000     3/3
/fun             0.35 s   0.86 s   0.39 s    0 ms   0.000     3/3
/resume          0.29 s   0.83 s   0.41 s    0 ms   0.000     3/3
/contact         0.35 s   0.86 s   0.38 s    0 ms   0.000     3/3
```

"LCP runs" is how many of the three runs produced a value at all — **24 of 24**
since the entrance fix, against 16 of 24 before it. Every route beats the plan's
1.2 s target; the slowest single run of the twenty-four is 0.91 s.

Total Blocking Time is **0 ms** on every route that reports it, and CLS is a flat
zero everywhere. Those two are the plan's design-system claims — "dashboard
widgets render server-side from the Snapshot with fixed dimensions — no
skeletons, no layout shift" — holding up under measurement.

### Mobile, for completeness

On Lighthouse's default mobile preset (simulated Slow 4G, 4× CPU) every metric
now resolves — before the `hor-rise` fix, LCP landed on exactly **one** route of
seven and TBT and TTI only on that same one, because Lighthouse derives both from
the LCP timestamp and the harsher throttling stretched the fade well past the
trace window. Post-fix, two runs each: FCP 1.51 s, LCP 3.6–4.2 s, TBT 34–54 ms,
CLS 0.000. See the mobile TODO above — the numbers are real and the homepage's
LCP element is the hero portrait.

The assertions still run on desktop, but the reason is now "mobile has an
unstarted optimisation in it" rather than "mobile cannot be measured". The plan's
own phone check —

> review the homepage on a phone at 4G throttling — the five-second-snapshot
> test is the actual acceptance criterion

— is in the Verification section as a human step and stays one. Nothing here
replaces it.

---

## Design notes

### Why the budget is read from HTML, not from a manifest

`budget.ts` parses the `<script src>` tags of each prerendered page. Three
reasons, in increasing order of importance:

1. **There is no per-route manifest.** Under Turbopack this build emits
   `build-manifest.json` with `rootMainFiles` and nothing else; there is no
   `app-build-manifest.json` at all. Trusting it would have measured the shared
   runtime and reported it as the homepage — a number that is both wrong and
   stable, which is the worst combination.
2. **Only the HTML knows about `noModule`.** See above.
3. **The HTML is what ships.** A manifest is a description of intent.

Chunks are gzipped individually at level 9, which is what `gzip-size` — and
therefore Next's own historical build output — does, so these numbers are
comparable with numbers from that era rather than with a whole-response gzip.
Brotli is printed alongside because it is what a CDN actually serves; the plan
says "gzipped", so the gate is gzip.

### The second assertion: contraband

A byte total cannot see an architecture violation. A Convex client that fits
inside the existing headroom passes a size check and breaks the rule that public
pages ship **zero Convex bytes**. So the same walk greps every public chunk for
markers of the four packages that are legitimate in `/admin` and are a defect
anywhere else: `ConvexReactClient`, `ConvexHttpClient`, `ClerkProvider`,
`__clerk`, `ProseMirror`, `uploadthing`.

Note what is deliberately *not* a marker: the bare string `convex`. The contact
page prints "convex · stored, then read by one person" as visible copy, and a
check that fails on the site's own honest description of where a message goes is
a check that gets deleted by Friday.

Currently: **clean**. None of the four appears in any chunk referenced by any
public route.

### Why `tooling/perf` is a workspace and the other tooling packages are not

`tooling/collector`, `tooling/seed` and `tooling/privacy-check` depend on nothing
— they use Bun and the platform, which is what lets them run from a bare
checkout. `@lhci/cli` is not optional and cannot be reimplemented, so this
package needs `node_modules`, so it is listed in the root `workspaces` array by
exact path (`tooling/perf`) rather than as `tooling/*`. That keeps the other
three exactly as they were.

The side effect is worth having: `@home/perf` now participates in
`turbo run typecheck`, so the gate is itself gated.

---

## In CI

`.github/workflows/ci.yml` runs three jobs. `verify` (typecheck, lint, collector
tests) and `performance` (build → budget → Lighthouse) run in parallel and gate
every push and pull request. `privacy` — the ADR 008 gate — is the interesting
one, and it does **not** run by default.

It reads like `tooling/privacy-check --tree` should need no credentials, since
the tree sweep only greps files. It needs two:

1. **The corpus.** `repos.ts` builds it from `gh api user/repos` plus the working
   copies in `~/GitHub`. A runner has neither. With no token the corpus is empty,
   nothing can match, and the check prints `PASS` — a green tick that proves
   nothing, which is worse than a red one.
2. **The sanction list.** ADR 008 *requires* the site to name its case studies,
   and QuoteCloud, TravelDocs, ZeroRisk and SoldOnline are each also the name of
   a private repository. `check.ts` resolves that by reading which names the
   deployment has actually *published* and downgrading those hits to `REVIEW`.
   Without the deployment there is no sanction list, so a correct source tree
   fails with five fabricated leaks. (Measured: the local run reports
   `REVIEW — 5 name(s)`.)

So the job runs the real check — `--url <deployment> --tree` — when
`PRIVACY_CHECK_GH_TOKEN` and `CONVEX_URL` are set on the repository, and emits a
workflow warning explaining itself when they are not. It never runs empty. It is
also skipped on pull requests from forks, which cannot receive secrets.

Local run, with the repo's own `.env`: **PASS**, 406 responses and tracked files,
295-name corpus, 5 sanctioned `REVIEW` hits.

## Ratcheting

`budget.ts` prints a hint whenever a route comes in 6 KB or more under its
ceiling:

```
  Ratchet — comfortably under budget; lower these in tooling/perf/budgets.ts:
    /work  160.1 KB measured vs 174 KB budget
```

Lower it. Budgets in this repo move down without discussion and up only in a
diff, with a reason, in front of a reviewer. That asymmetry is the entire
mechanism.
