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
    note: 'post — no prerendered instances while the blog is empty (167.2 KB measured against a fixture)',
  },
  { route: '/fun', budget: 172, plan: null, note: 'photo grid' },
  { route: '/resume', budget: 172, plan: null, note: 'web resume + PDF link' },
  { route: '/contact', budget: 180, plan: null, note: 'contact form' },
  {
    route: '/ask',
    budget: 298,
    plan: null,
    // MEASURED, and the number is bad. 290.3 KB gzipped on the build that
    // landed the route; 298 is that plus the table's standard headroom
    // (`measured + max(4 KB, 2.5%)`, rounded up to an even KB). It replaces the
    // 200 KB placeholder that was written here before anyone had built the page
    // — that guess was 90 KB optimistic.
    //
    // ── Where the 290 KB goes, measured rather than assumed ─────────────────
    //
    //   144.9 KB   the framework floor, identical to every other route
    //   122.6 KB   ONE chunk (515.9 KB raw): the AI SDK's client runtime
    //    ~22.8 KB  everything else this route adds — the console, the
    //              markdown-lite renderer, the notices, the page's own CSS-in-
    //              JS-free components
    //
    // The 122.6 KB is not an import that could have been written more tightly.
    // It was verified by deleting the `import { DefaultChatTransport } from
    // 'ai'` entirely and building again: **290.1 KB**, a 0.2 KB difference.
    // `@ai-sdk/react` depends on `ai` and pulls the same graph through
    // `useChat` whatever the calling code imports, and the barrel does not
    // shake down under Turbopack. Nothing in `components/site/ask` can move
    // this number materially; only a different chat client could.
    //
    // ── Two things that would actually reduce it, neither done here ─────────
    //
    //   1. Defer the island (`next/dynamic`, load on first interaction). The
    //      122.6 KB stops being *first-load* JS and becomes on-demand JS. That
    //      is a real improvement for a reader who never types anything — and it
    //      is also the move that makes this row look good without the page
    //      getting lighter, so it should be taken deliberately, for the reader,
    //      and the note here should say the total is unchanged.
    //   2. Hand-write a transport against the SSE protocol and drop `useChat`.
    //      Cheaper bytes, considerably more code to own, and the streaming
    //      protocol becomes this repo's problem on every SDK release.
    //
    // Until one of those is chosen, this route is 1.7× the floor and the number
    // is written down where a reviewer has to look at it.
    note: 'Ask Corey — the one public route with chat JS (ADR 015). 122.6 KB of it is the AI SDK client runtime',
  },
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
