/**
 * lighthouserc.cjs — the Lighthouse half of the performance gate.
 *
 *     bun run --cwd=<repo>/tooling/perf lhci
 *     # or, from anywhere:
 *     tooling/perf/node_modules/.bin/lhci autorun --config=tooling/perf/lighthouserc.cjs
 *
 * CommonJS on purpose: `@lhci/cli` `require()`s its config, and the package is
 * `"type": "module"`, so `.cjs` is the extension that keeps both true.
 *
 * ── What this measures, and what it therefore does not prove ────────────────
 *
 * It measures **the mock build**. `next build` and `next start` run here with no
 * Convex environment at all, which the read layer in `apps/web/src/lib/data.ts`
 * treats as "pure mock" — every page renders from the fixtures in
 * `snapshot.ts`. That is deliberate and it is the only honest way to run this in
 * CI: the alternative is putting a deployment URL in a public workflow file and
 * making every pull request's numbers depend on whether a network round-trip to
 * Convex was warm.
 *
 * The cost of that choice, stated plainly: this gate proves the *shell* is fast
 * — markup, CSS, fonts, images, JavaScript, layout stability. It cannot prove
 * that the live deployment is fast, because it never talks to it. The plan's
 * "Homepage server work: 1 Convex document read" is a different assertion,
 * checked elsewhere, and the mock build cannot make it.
 *
 * ── Desktop, not mobile, and why that is not the easy way out ───────────────
 *
 * Lighthouse's default is mobile with simulated Slow 4G plus a 4× CPU
 * slowdown. The assertions below run on **desktop**, and the reason has changed
 * since this file was written — which is worth recording, because the old
 * reason would now be a lie.
 *
 * It used to be that mobile could not be measured at all: the `hor-rise`
 * entrance suppressed LCP (see the LCP assertion), and Lighthouse derives Total
 * Blocking Time and Time to Interactive from the LCP timestamp, so three of five
 * metrics errored out on six routes in seven. A gate built on that is not a
 * gate. Since the entrance was fixed, mobile resolves everything — measured
 * immediately after, two runs each: `/` LCP 3.81 / 4.15 s, `/resume` 4.22 /
 * 3.64 s, FCP 1.51 s, TBT 34–54 ms, CLS 0.000.
 *
 * So the honest reason today is a different one: **those mobile numbers are
 * real and they are not good**, and a gate is the wrong instrument for a number
 * nobody has tried to fix yet. Slow-4G-with-4×-CPU is a deliberately pessimistic
 * simulation, but 4 s to the hero portrait is over the Core Web Vitals "good"
 * boundary by a factor of 1.6 and it is the LCP element on the homepage. That is
 * an optimisation task with an owner and a lever (the hero image), not a
 * regression to catch, and it is filed as an open item in README.md.
 *
 * Desktop stays the gated preset: it is stable, it is where a regression in the
 * shell shows up first, and it does not encode an unfinished piece of work as a
 * red build. The plan's own phone check — "review the homepage on a phone at 4G
 * throttling — the five-second-snapshot test is the actual acceptance criterion"
 * — is in the Verification section as a *human* step and stays one. Nothing here
 * replaces it; the numbers above are what that human should expect to see.
 */

const { join } = require('node:path');

/** The web app, resolved from this file so the config works from any cwd. */
const WEB = join(__dirname, '..', '..', 'apps', 'web');

/**
 * Not 3000. The developer's own `next dev` habitually holds it, and a Lighthouse
 * run that silently profiles a *development* build would report numbers that are
 * wrong in the flattering direction on some metrics and catastrophic on others.
 */
const PORT = process.env.LHCI_PORT ?? '3111';

/**
 * The public routes, from the plan's Pages table.
 *
 * `/work/[slug]` is represented by one case study rather than all four: the
 * template is identical and the JS is identical (see `budget.ts`, which measures
 * every instance and reports the worst). What differs between case studies is
 * imagery, and that is a content question, not a gate question.
 *
 * `/blog/[slug]` is absent because ADR 018 permits launching with no posts and
 * the zero-env build therefore prerenders none. `/admin/*` is absent because it
 * is Clerk-gated and would redirect. `/v/*` is absent because the seven design
 * explorations are `noindex` and not part of the site's promise.
 */
const ROUTES = [
  '/',
  '/work',
  '/work/quotecloud',
  '/labs',
  '/blog',
  '/fun',
  '/resume',
  '/contact',
];

module.exports = {
  ci: {
    collect: {
      // A real production server, started and stopped by LHCI. `next start`
      // needs `next build` to have run first; the workflow guarantees that and
      // `budget.ts` fails loudly if it has not.
      startServerCommand: `bun run --cwd=${WEB} start --port ${PORT}`,
      startServerReadyPattern: 'Ready in',
      startServerReadyTimeout: 120000,
      url: ROUTES.map((route) => `http://localhost:${PORT}${route}`),
      // Odd, so "median run" is a run and not an interpolation. Three is the
      // smallest odd number that lets one outlier be outvoted.
      numberOfRuns: 3,
      settings: {
        preset: 'desktop',
        // `--no-sandbox` because GitHub's Ubuntu runner executes as root inside
        // a container and Chrome's sandbox refuses that. It is not needed
        // locally and does nothing there.
        chromeFlags: '--no-sandbox',
      },
    },

    assert: {
      /**
       * Only the metrics below are asserted. Lighthouse's stock presets
       * (`lighthouse:recommended`) fail on a dozen audits that are content or
       * hosting decisions rather than performance regressions — `uses-http2`
       * against a localhost dev server, `csp-xss` against a build with no
       * headers, `unsized-images` on decorative fills. A gate that has to be
       * argued with every week is a gate that gets `continue-on-error: true`
       * bolted onto it, so this asserts a short list and means every entry.
       *
       * Every threshold below is a **measured** number with headroom, not a
       * number from a blog post. Local medians on this build, desktop preset,
       * 3 runs, macOS / Apple silicon:
       *
       *   route              FCP      LCP      SI      TBT     CLS    LCP runs
       *   /                0.29 s   0.83 s   0.41 s    0 ms   0.000    3/3
       *   /work            0.35 s   0.82 s   0.37 s    0 ms   0.000    3/3
       *   /work/quotecloud 0.25 s   0.79 s   0.38 s    0 ms   0.000    3/3
       *   /labs            0.39 s   0.89 s   0.39 s    0 ms   0.000    3/3
       *   /blog            0.35 s   0.79 s   0.36 s    0 ms   0.000    3/3
       *   /fun             0.35 s   0.86 s   0.39 s    0 ms   0.000    3/3
       *   /resume          0.29 s   0.83 s   0.41 s    0 ms   0.000    3/3
       *   /contact         0.35 s   0.86 s   0.38 s    0 ms   0.000    3/3
       *
       * "LCP runs" is how many of the three runs produced a largest-contentful-
       * paint value at all. **Twenty-four of twenty-four**, since the
       * `hor-rise` entrance stopped starting at `opacity: 0` — see the LCP
       * assertion for what that was doing and the one-value change that fixed
       * it. The previous table in this comment recorded 16 of 24, and on the
       * last measurement before the fix the homepage produced none of three.
       *
       * The error thresholds sit at roughly 4–5× those medians. That looks
       * absurdly loose against a laptop and is not loose against a shared
       * 4-vCPU GitHub runner, which is the machine this actually has to be
       * green on and the one machine that could not be measured from here. They
       * are ratchets like the JS budgets: tighten them once CI has produced a
       * fortnight of real numbers. A flaky gate teaches people to ignore gates.
       *
       * One deliberate omission worth naming, because it is the first thing a
       * reviewer will look for: `render-blocking-resources`. It scores 0–0.5 on
       * every route here, and it is *right* — the three stylesheets block the
       * first paint on purpose, because the alternative is an unstyled flash and
       * a CLS score that is currently a flat zero. Asserting it would print a
       * warning on all eight routes forever, and eight permanent warnings are
       * how a person learns to stop reading the warnings.
       */
      assertions: {
        /* ---- the plan's table ---- */

        /**
         * CLS < 0.05 — the plan's target, asserted as an error, met with room
         * to spare.
         *
         * Measured **0.000 on every route, on both presets, on every run**.
         * That is not luck: the dashboard widgets render server-side from the
         * Snapshot at fixed dimensions and there are no skeletons, which is
         * exactly what the plan's design-system section prescribes. This
         * assertion is here to notice the day somebody adds a client-fetched
         * widget and undoes it.
         */
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.05 }],

        /**
         * LCP — an **error** as of the launch-hygiene pass, and the number it
         * carries is not the plan's. Both halves of that need explaining.
         *
         * ── Why it used to be a warning, and is not any more ────────────────
         *
         * It was a warning because a third of runs reported **NO_LCP** — no
         * largest contentful paint at all — and which runs those were moved
         * between invocations. The cause was `.hor-rise` in
         * `apps/web/src/app/(site)/horizon.css`:
         *
         *     .hor .hor-rise { animation: hor-rise 0.85s var(--hor-ease) both; }
         *     @keyframes hor-rise { from { opacity: 0; … } }
         *
         * Chrome does not treat an element painted at `opacity: 0` as an LCP
         * candidate, and `animation-fill-mode: both` held it at zero through a
         * stagger delay of up to 650 ms. Everything above the fold carries the
         * class, so the first *eligible* paint of the real hero was roughly
         * `delay + fade` after first paint — right at the edge of Lighthouse's
         * trace window, and a race the page sometimes lost. That was a real
         * Core Web Vitals problem rather than a Lighthouse quirk: the same
         * eligibility rule governs the field data Chrome reports to CrUX.
         *
         * The `from` keyframe now starts at `opacity: 0.01` — visually
         * identical, LCP-eligible from first paint. Measured immediately after:
         * **24 of 24 runs produce a value**, across all eight routes, and the
         * element Lighthouse names is the real hero on every one of them (the
         * `<h1 class="hor-display hor-rise">`, the portrait `<img>`, the lede)
         * rather than the stray `<span class="hor-sec-meta">` it used to settle
         * for. So the audit is now assertable, and it is asserted.
         *
         * ── Why 2500 ms and not the plan's 1200 ms ──────────────────────────
         *
         * The plan's target is **met, decisively**: 0.71–0.91 s across all 24
         * runs, median 0.83 s, not one over 1.2 s. What is not known is what
         * this costs on a shared 4-vCPU GitHub runner, which is the one machine
         * that could not be measured from here and the only machine this gate
         * has to be green on.
         *
         * That matters more for LCP than for anything else in this file,
         * because LCP here is not paint-bound — it is bound by the 650 ms
         * entrance stagger, which is wall-clock and does not shrink on faster
         * hardware but does get *added to* on slower hardware. A 1200 ms
         * ceiling leaves 350 ms of runner headroom over a 650 ms floor, which
         * is how a gate ends up red for a reason that has nothing to do with a
         * regression, and a gate that is red for the wrong reason is a gate
         * somebody disables.
         *
         * 2500 ms is not an invented cushion: it is the Core Web Vitals "good"
         * boundary for LCP, the number Chrome itself uses to decide whether a
         * real visitor had a good experience. It is also *tighter* than this
         * file's own doctrine for the other metrics (FCP and SI sit at 4–5× the
         * local median; this is 3×).
         *
         * Ratchet it the way `budgets.ts` ratchets: once CI has produced a
         * fortnight of numbers from real runners, walk it down towards the
         * plan's 1200 ms. Down without discussion, up only in a diff with a
         * reason. The plan's figure stays recorded here and in README.md so the
         * gap — currently zero locally — is never quietly lost.
         */
        'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],

        /* ---- what is actually enforceable today ---- */

        /**
         * First Contentful Paint fires on the first pixel of anything —
         * including the page background and the nav chrome — so it is the one
         * metric the entrance animation could never hide. It was the
         * enforceable stand-in for speed while LCP was unreportable; it stays
         * asserted now that LCP is back, because the two answer different
         * questions and a regression in the shell shows here first.
         *
         * 1500 ms against a 0.25–0.39 s local median: ~4× headroom, for the
         * unmeasured-runner reason the LCP assertion sets out at length.
         */
        'first-contentful-paint': ['error', { maxNumericValue: 1500 }],

        /** Same reasoning, same shape: ~5× the 0.36–0.41 s local median. */
        'speed-index': ['error', { maxNumericValue: 2000 }],

        /**
         * **0 ms on every route, every run** — which is what a site with no
         * client data fetching and a ~5 KB motion entrypoint should score. The
         * ceiling is the Core Web Vitals "good" threshold; the point of the
         * assertion is to catch a client component arriving with real work in
         * it, not to shave milliseconds.
         *
         * Promoted from `warn` to `error` alongside LCP, and for the same
         * reason: Lighthouse derives TBT from the LCP timestamp, so while the
         * `hor-rise` entrance was suppressing LCP this audit errored out on the
         * same routes and could not be enforced either. It reports on all eight
         * routes now.
         *
         * Unlike LCP this keeps the plan-adjacent number rather than a ratchet.
         * TBT is CPU-bound, and the measurement is not "small", it is *zero* —
         * there is no long task to be slower at. A shared runner that turns 0 ms
         * into 200 ms would be telling us something worth a red build.
         */
        'total-blocking-time': ['error', { maxNumericValue: 200 }],

        /* ---- cheap correctness that belongs in the same run ---- */

        /**
         * A thrown exception or a failed request on a public page. Cheap to
         * assert, and it is the audit that would have caught a client component
         * quietly erroring after hydration on a page that still *looks* right.
         */
        'errors-in-console': ['error', { minScore: 1 }],
      },
    },

    upload: {
      // Filesystem, not the public temporary-storage server: the reports embed
      // full-page screenshots of an unlaunched site, and `temporary-public-
      // storage` means exactly what it says. The workflow uploads `.lighthouseci`
      // as a build artifact instead, where it is visible to the repo and to
      // nobody else.
      target: 'filesystem',
      outputDir: join(__dirname, '.lighthouseci'),
      reportFilenamePattern: '%%PATHNAME%%-%%DATETIME%%-report.%%EXTENSION%%',
    },
  },
};
