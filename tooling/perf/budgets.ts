/**
 * budgets.ts — the numbers the gate enforces, and the numbers the plan asked for.
 *
 * Two columns, deliberately, because they do not agree and pretending they did
 * would be the whole failure mode this file exists to avoid:
 *
 *   plan     what the build plan's performance table asks for. Aspiration.
 *            Never lowered, never quietly deleted. It is the gap that gets
 *            reported.
 *   budget   what CI actually fails on today. A **ratchet**: it starts at the
 *            first honest measurement plus a hair of headroom, and it may only
 *            ever move down. Raising one is a decision somebody has to make in
 *            a diff, with a reason, in front of a reviewer.
 *
 * The headroom is `measured + max(4 KB, 2.5%)`, rounded up to an even KB. That
 * is deliberately a hair and not a cushion, and there are two reasons it is not
 * simply `measured + 1`: these numbers were taken on macOS / Apple silicon and
 * CI builds on Ubuntu, and they were taken while the launch-hygiene work was
 * still landing around them. Tighten them — `budget.ts` prints a ratchet hint
 * the moment a route comes in 6 KB or more under — once CI has produced a
 * fortnight of numbers from one machine on a settled tree.
 *
 * ── Why the two differ, in one paragraph ─────────────────────────────────────
 *
 * The plan says "Homepage JS (gzipped) < 100 KB". Measured on the real build at
 * the time this file was written, the homepage ships **175.2 KB gzipped** — and
 * `/_not-found`, a route whose entire body is a heading and a link, ships
 * **144.9 KB**. That 144.9 KB is not this site's code. It is React 19's DOM
 * client (62.7 KB gzipped, one chunk) plus the Next 16 App Router client runtime
 * (~82 KB across nine chunks: the router reducer, the segment cache, the
 * bfcache, the prefetch scheduler, the error overlay boundary). There is no
 * arrangement of application code that gets an App Router page under 100 KB
 * gzipped on this framework version, because the framework alone is 45% over
 * before a single component of Corey's is loaded.
 *
 * So the plan target is unreachable, not unmet. The honest response is to say
 * so loudly — see README.md, which prints the gap as a standing TODO — and
 * meanwhile gate on the thing that is still worth gating on: **regression**.
 * The budgets below stop the number growing. They do not pretend it is small.
 *
 * See README.md for the full breakdown and for what would actually have to
 * change to reach 100 KB.
 */

/** One budgeted surface. */
export type Budget = {
  /**
   * The route, exactly as the app router names it.
   *
   * A dynamic segment (`/work/[slug]`) matches every prerendered instance and
   * is judged on the **worst** one, because a budget that only checks the
   * cheapest case study is not a budget.
   */
  route: string;
  /**
   * Gzipped first-load JS ceiling, in KB. CI fails above this.
   *
   * Ratchet only. If a measurement comes in comfortably under, the script says
   * so and invites you to lower this line.
   */
  budget: number;
  /**
   * The build plan's target for this route, in KB, or `null` where the plan
   * names no number. Printed next to the measurement, always.
   */
  plan: number | null;
  /** Why this row exists / what it is really measuring. One line, printed. */
  note: string;
};

/**
 * The framework floor, measured rather than assumed.
 *
 * `/_not-found` is the cheapest page the app can produce — no data, no client
 * component of ours, no motion. Whatever it ships is the cost of choosing Next
 * App Router + React 19 at all. It is in the table as a **gate**, not a
 * curiosity: if this number moves, the cause is a framework upgrade or a stray
 * import into the root layout, and both are things a reviewer wants to see
 * before they land rather than after.
 */
export const FLOOR_ROUTE = '/_not-found';

export const BUDGETS: Budget[] = [
  {
    route: FLOOR_ROUTE,
    budget: 150,
    plan: null,
    note: 'framework floor — React + App Router runtime, no app code',
  },
  {
    route: '/',
    budget: 180,
    plan: 100,
    note: 'the living dashboard (ADR 003) — the plan target lives here',
  },
  { route: '/work', budget: 174, plan: null, note: 'case study grid' },
  { route: '/work/[slug]', budget: 172, plan: null, note: 'case study, worst prerendered instance' },
  { route: '/labs', budget: 178, plan: null, note: 'curated labs + live stats' },
  { route: '/blog', budget: 172, plan: null, note: 'writing index — may be empty (ADR 018)' },
  {
    route: '/blog/[slug]',
    budget: 172,
    plan: null,
    // Not an error when it is missing: ADR 018 permits launching with no posts,
    // and a zero-env CI build has none by construction, so this reads "—" on
    // every CI run until the first post is published.
    //
    // The ceiling is not therefore a guess. Measured once against a temporary
    // three-post fixture during the launch-hygiene pass: **167.2 KB gzip**,
    // identical to /blog and /fun, with no contraband — the post page ships no
    // client component of its own and the markdown is compiled to HTML on the
    // server. The row will go green rather than grey the day it is exercised.
    //
    // ⚠️ That figure predates the Ask launcher. It tracked /blog and /fun
    // exactly, and both moved 167.2 → 168.9 when the launcher landed, so read
    // it as ~168.9 KB today. Not re-measured against a fixture, and not worth
    // re-measuring until there is a real post.
    note: 'post — no prerendered instances while the blog is empty (~168.9 KB, tracks /blog exactly)',
  },
  { route: '/fun', budget: 172, plan: null, note: 'photo grid' },
  { route: '/resume', budget: 172, plan: null, note: 'web resume + PDF link' },
  { route: '/contact', budget: 180, plan: null, note: 'contact form' },
  /*
   * ── `/ask` used to be a row here, and this is what happened to it ─────────
   *
   * It was the worst line in the table: **290.3 KB gzipped**, budgeted at 298,
   * against a 144.9 KB framework floor. The breakdown, measured at the time:
   *
   *   144.9 KB   the framework floor, identical to every other route
   *   122.6 KB   ONE chunk (515.9 KB raw): the AI SDK's client runtime
   *    ~22.8 KB  the console, the markdown-lite renderer, the notices
   *
   * That note ended by listing two things that would actually reduce it. The
   * first — "defer the island (`next/dynamic`, load on first interaction)" —
   * has now been done, and taken further than the note imagined: Ask Corey is
   * no longer a route at all. It is a launcher mounted in the `(site)` layout,
   * and the AI SDK is behind `next/dynamic({ ssr: false })` in `AskPanel`,
   * fetched on the reader's first click.
   *
   * So the row is deleted rather than moved, because the surface it measured no
   * longer exists. ⚠️ **The old note's warning still stands**: deferring did not
   * make the chat smaller. A reader who opens the widget still downloads
   * ~122.6 KB gzipped of AI SDK, just at a moment when they have asked for it.
   * What changed is who pays: every visitor to `/ask` before, only the people
   * who click now, and nobody at all on a cold load of any page.
   *
   * ── The launcher's cost, which every `(site)` route now carries ───────────
   *
   * `AskLauncher` is a client component in the shared layout, so its bytes land
   * in every row below: `/`, `/work`, `/work/[slug]`, `/labs`, `/blog`,
   * `/blog/[slug]`, `/fun`, `/resume`, `/contact`. It imports React and
   * `next/dynamic` and nothing else — a button, a dialog frame, a focus trap —
   * so the expected delta is **single-digit KB gzipped**, and the existing
   * headroom in those rows (4–8 KB by construction, see the header) should
   * absorb it.
   *
   * That prediction was then **measured**, because this file does not keep
   * predictions. Two production builds of the same tree, differing only in
   * whether the layout mounts `<AskLauncher>`:
   *
   *   route          without    with    delta
   *   /               175.5    177.2    +1.7
   *   /work           167.9    169.5    +1.6
   *   /work/[slug]    167.2    168.9    +1.7
   *   /labs           172.6    174.2    +1.6
   *   /blog           167.2    168.9    +1.7
   *   /fun            167.2    168.9    +1.7
   *   /resume         167.2    168.9    +1.7
   *   /contact        174.3    175.9    +1.6
   *   /_not-found     144.9    144.9     0.0   ← control
   *   /variants       148.3    148.3     0.0   ← control
   *   /v/[variant]    149.8    149.8     0.0   ← control
   *
   * **+1.7 KB gzipped**, everywhere it applies, for a chat on every page. The
   * three controls render under the root layout rather than `(site)` and did
   * not move by a single byte, which is the check that the number above is the
   * launcher and not build noise.
   *
   * **No ceiling below moved.** Every row still passes on the number it already
   * had, so raising one would have been unnecessary and lowering one to
   * `measured + headroom` would have *raised* four of them (`/fun`, `/blog`,
   * `/resume`, `/work/[slug]` sit at 172 and the formula would issue 174) —
   * which is the thing this table's ratchet exists to stop.
   *
   * ⚠️ What did change is the slack, and it is worth saying out loud: the
   * `(site)` rows now run 2.8–4.5 KB under their ceilings rather than 4.5–6.2.
   * The launcher fit in the headroom, and it used a third of it. The next thing
   * that wants to live in the shared shell has materially less room to do it in
   * than this one did, and should expect to be asked why it is not lazy too.
   */
  {
    route: '/variants',
    budget: 154,
    plan: null,
    note: 'exploration index — noindex, kept deliberately',
  },
  {
    route: '/v/[variant]',
    budget: 154,
    plan: null,
    // The seven design explorations are mock-fed and noindex. They still get a
    // ceiling: they share the root layout, so a regression there shows up here
    // first, and "it is only the variants" is how a shared-layout regression
    // gets waved through.
    note: 'design explorations — noindex, mock-fed, worst of seven',
  },
];

/**
 * Routes that are never measured, with the reason.
 *
 * `/admin/*` is Clerk-gated, dynamic, and deliberately heavy — it carries the
 * Convex React client, Tiptap and UploadThing, none of which may appear in a
 * public chunk. It is excluded because it is not a public surface, **not**
 * because its weight does not matter; the invariant that matters for admin is
 * "none of this reaches a public route", and that is asserted separately in
 * `budget.ts` (see `CONTRABAND`).
 */
export const IGNORED_PREFIXES = ['/admin', '/api', '/_global-error'];
