/**
 * data.ts — the public site's read layer. Convex where there is data, the mock
 * everywhere else, one `Snapshot` out either way.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  SERVER ONLY. The `import "server-only"` below is load-bearing.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `convex/browser` in a `"use client"` graph would pull the Convex client into
 * the public JS bundle, which is exactly the budget `ConvexClientProvider`'s
 * docblock is protecting (it measured the authenticated provider at +76 KB gzip
 * and moved it under `/admin` for that reason alone). Public routes read Convex
 * **only** through this module, from Server Components, over HTTP. There is no
 * `convex/react` anywhere under `(site)`, and importing this file from a client
 * component is a build error rather than a silent regression.
 *
 * `server-only` is a declared dependency of this app, not a borrowed one. Next
 * aliases the bare specifier to its own copy so the build would pass regardless,
 * and `tsc` skips unresolved side-effect-only imports silently — which together
 * meant the package resolved only as a transitive dep of `@clerk/nextjs`. Any
 * non-Next consumer (a test runner, a script, this file moving to a package) and
 * any future without Clerk would have lost the guard without a single error.
 *
 * ── The contract ───────────────────────────────────────────────────────────
 *
 * `Snapshot` in `@/lib/snapshot` stays the contract. This module does not widen
 * it, does not narrow it, and does not invent fields: it returns the same object
 * shape the mock has always returned, assembled from Convex rows where they
 * exist. Every consumer — pages, components, `@/lib/derive` — is written against
 * `Snapshot` and cannot tell which source it got.
 *
 * ── Per-domain fallback ────────────────────────────────────────────────────
 *
 * Fallback is **per domain**, not all-or-nothing. An empty table, a `null`
 * singleton, or a query that throws falls back to the mock for *that domain
 * only*, so a deployment with case studies seeded but no snapshot row renders
 * real projects against mock telemetry rather than nothing at all:
 *
 *     identity      siteSettings.identity → snapshot.identity → mock
 *     gitStats      snapshot row → mock
 *     aiUsage       snapshot row → mock
 *     computedAt    snapshot row → mock
 *     projects      projects.list (published) → mock
 *     labs          labs.list (published) → mock
 *     funEntries    funEntries.list → mock
 *     funLog        funEntries.list → mock
 *     resumeDocument  resume.get → mock
 *
 * With no `NEXT_PUBLIC_CONVEX_URL` at all, nothing is queried and the result is
 * the mock object itself — byte-identical to what the site rendered before this
 * module existed. That is the zero-env rule, and it is a `return` on line one of
 * the assembler rather than a series of `??`s, so it cannot rot.
 *
 * ── Reads per page ─────────────────────────────────────────────────────────
 *
 * Six queries, issued in one `Promise.all`, assembled once and reused for the
 * whole render via React's `cache()`. **Fetch once per page and pass the result
 * down** — never call a getter from inside a leaf component, which is how a
 * "one read" page quietly becomes twelve.
 *
 * PHASE 4 — ADR 004 wants the dashboard at *one* document read. It is six today
 * because the denormalising cron does not exist yet: `snapshot` already embeds
 * `identity` and `latestFunEntry`, and the same cron is what will let the
 * homepage stop reaching for `projects`, `labs`, `funEntries` and `resume`
 * separately. When it lands, the extra reads collapse into the singleton and
 * this file loses five `client.query` calls without any page changing.
 *
 * ── ISR: `export const revalidate = 300` on every wired page ────────────────
 *
 * Cache Components is **not** enabled (`next.config.ts` sets no `cacheComponents`
 * flag), so the previous caching model applies and `revalidate` is still a valid
 * route segment config — Next 16 only removed it under Cache Components.
 *
 * The Convex reads below are plain `fetch` POSTs, and in Next 16 an unconfigured
 * `fetch` is *uncached*. Per the `fetch` API reference that does **not** make the
 * route dynamic: with no Request-time API on the route ((site) pages read no
 * cookies, headers or searchParams) Next still prerenders the page, fetching
 * once during `next build`, and `revalidate` then decides how often the
 * prerendered HTML is regenerated. That is ordinary ISR, and it is why nothing
 * here needs `unstable_cache` (replaced by `use cache` in 16, which needs Cache
 * Components) or a hand-rolled fetch wrapper.
 *
 * **300 seconds.** Chosen, not copied:
 *
 *   • The Snapshot row is rebuilt by an hourly cron (ADR 005), so a window
 *     shorter than a few minutes buys nothing but Convex reads — the numbers
 *     cannot have changed.
 *   • The things that *do* change out of band are admin edits: the availability
 *     line (`siteSettings.setAvailability` exists precisely so it can be changed
 *     from a phone in one tap) and publishing a case study. Five minutes is the
 *     longest an edit can look broken, which is short enough to trust and long
 *     enough that a crawl or a link going around costs at most twelve rebuilds
 *     an hour per route.
 *   • It is the same number on every page, so no route can be staler than the
 *     one that linked to it. (Next takes the *lowest* `revalidate` across a
 *     route's layout and page, so a lower value anywhere silently speeds up the
 *     whole route.)
 *
 * Write the literal in each page — `export const revalidate = 300` — not an
 * import of the constant below. Next requires the value to be statically
 * analysable, so `revalidate = REVALIDATE_SECONDS` is not guaranteed to be read.
 * `/work/[slug]` additionally builds its `generateStaticParams` from
 * `getProjects()`, so a slug that only exists in Convex is prerendered at build
 * time, and keeps `dynamicParams = true` so one published after the last deploy
 * renders on demand instead of 404ing until the next build. See that file for
 * why unknown and draft slugs still 404.
 */

import "server-only";

import { cache } from "react";
import { ConvexHttpClient } from "convex/browser";

import { api } from "@home/convex/api";
import type { Doc } from "@home/convex/dataModel";

import type {
  AiUsage,
  FunEntry,
  FunLogEntry,
  GitStats,
  Identity,
  Lab,
  Project,
  ResumeDocument,
  Snapshot,
} from "@/lib/snapshot";
import { snapshot as mock } from "@/lib/snapshot";

/* ------------------------------------------------------------------ *
 * Configuration
 * ------------------------------------------------------------------ */

/**
 * The ISR window every `(site)` page declares. Documentation, not plumbing —
 * see the file header for why each page writes the literal `300` instead of
 * importing this.
 */
export const REVALIDATE_SECONDS = 300;

/**
 * The deployment URL, or `undefined` on a zero-env checkout.
 *
 * `NEXT_PUBLIC_` because it is the same variable the admin's browser client
 * reads (`ConvexClientProvider`), and a second name for one deployment is a
 * configuration bug waiting to happen. Being public costs nothing: a Convex
 * deployment URL is not a secret, and every public query behind it is already
 * marked **Public** in `packages/convex`.
 *
 * Note the asymmetry with `useConvexReady`: that hook requires *both* the Convex
 * URL and the Clerk key, because an admin page with no way to authenticate is a
 * runtime error. Nothing below authenticates, so the Clerk key is irrelevant
 * here — a Convex deployment with no Clerk application still serves the public
 * site perfectly.
 */
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;

/* ------------------------------------------------------------------ *
 * Row types
 *
 * Named locally so the mappers below read as `row: LabRow` rather than
 * `Doc<'labs'>`, and so a schema change surfaces as a typecheck failure
 * at one import rather than at nine call sites.
 * ------------------------------------------------------------------ */

type SnapshotRow = Doc<"snapshot">;
type SettingsRow = Doc<"siteSettings">;
type ProjectRow = Doc<"projects">;
type LabRow = Doc<"labs">;
type FunRow = Doc<"funEntries">;
type ResumeRow = Doc<"resumeDocument">;

/**
 * The `identity` block, taken from `siteSettings` rather than `snapshot`.
 *
 * They are the same type — schema.ts exports one `identity` validator and both
 * tables use it — and naming the source-of-truth side is the point: if the two
 * ever diverge, `mapIdentity` fails to compile against the copy rather than
 * silently preferring it.
 */
type IdentityRow = SettingsRow["identity"];

/* ------------------------------------------------------------------ *
 * Time
 * ------------------------------------------------------------------ */

const DAY_MS = 86_400_000;

/** Midnight UTC on the calendar day an ISO instant falls in. */
function utcMidnight(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Number.NaN : Math.floor(ms / DAY_MS) * DAY_MS;
}

/**
 * Whole calendar days between two ISO instants — the `daysAgo` the mock stores
 * and every renderer reads.
 *
 * `@home/types` is explicit that this is the right direction of travel:
 * `occurredAt` is the stored fact and `daysAgo` is "a presentation value derived
 * at render time against `snapshot.computedAt` … deliberately absent from this
 * contract, so a stale snapshot cannot make an entry claim to be from today".
 *
 * Measured between UTC *midnights* rather than as elapsed hours, for two
 * reasons. It is what "2 days ago" means to a reader — a coffee at 08:00 and one
 * at 22:00 on the same day are both "today" — and it is what makes
 * `deriveFun().isoDaysAgo(daysAgo)` round-trip back to the entry's own date,
 * which is the property /fun's date stamps depend on.
 *
 * Clamped at 0: an entry timestamped after `computedAt` (the cron is behind, or
 * the phone posted a moment ago) is "today", never "-1 days ago".
 */
function daysAgo(occurredAt: string, computedAt: string): number {
  const from = utcMidnight(occurredAt);
  const to = utcMidnight(computedAt);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, Math.round((to - from) / DAY_MS));
}

/* ------------------------------------------------------------------ *
 * Convex
 * ------------------------------------------------------------------ */

/**
 * One query, or `null` if it cannot be answered.
 *
 * Every read below goes through this. A query that throws — deployment asleep,
 * network gone, a function renamed under us — degrades to the mock for its own
 * domain instead of 500-ing a page whose entire job is being read by a stranger
 * who may be about to offer Corey a job. The warning is deliberately loud in the
 * server log, because the *silent* version of this is the failure mode: a site
 * that has served mock data for three weeks and looks fine.
 */
async function read<T>(label: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    console.warn(`[data] Convex read "${label}" failed; falling back to mock.`, error);
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Mappers — Convex row ⇢ Snapshot field
 *
 * Every one of these is a *narrowing*. The Convex rows carry more than
 * the Snapshot contract models (attribution, media, links, photos,
 * coordinates, publish flags); this module drops what the contract has
 * no field for rather than smuggling it through as an extra property.
 * Each mapper names what it drops so the next person to widen the
 * contract knows where the data already is.
 * ------------------------------------------------------------------ */

/**
 * `identity` — a straight copy, with one repair.
 *
 * `x` is optional on the Convex row and required (`string`) on the mock's
 * inferred type, so an absent handle borrows the mock's rather than widening the
 * contract to `string | undefined` and breaking eight archived variants that
 * read `identity.x`.
 */
function mapIdentity(source: IdentityRow): Identity {
  return {
    name: source.name,
    role: source.role,
    company: source.company,
    location: source.location,
    availability: source.availability,
    github: source.github,
    linkedin: source.linkedin,
    x: source.x ?? mock.identity.x,
    email: source.email,
  };
}

/**
 * `gitStats` — field-for-field, with the calendar guarded.
 *
 * The one substitution: an *empty* `calendar` borrows the mock's grid. A snapshot
 * row written before the git cron exists (phase 4) has real totals and no grid,
 * and `deriveResume` reads `calendar[0][0].date` — so the honest-looking option
 * here is a thrown exception on /resume, which is worse than an obviously
 * placeholder heatmap next to real numbers. Everything else is passed straight
 * through, including a `languages` list that may legitimately be empty.
 */
function mapGitStats(source: SnapshotRow["gitStats"]): GitStats {
  return {
    totalContributionsYear: source.totalContributionsYear,
    privateContributions: source.privateContributions,
    publicCommits: source.publicCommits,
    publicRepoCount: source.publicRepoCount,
    currentStreakDays: source.currentStreakDays,
    calendar:
      source.calendar.length > 0 ? source.calendar : mock.gitStats.calendar,
    languages: source.languages.map((l) => ({ name: l.name, pct: l.pct })),
  };
}

/** `aiUsage` — field-for-field. Aggregates only; there is nothing to drop. */
function mapAiUsage(source: SnapshotRow["aiUsage"]): AiUsage {
  return {
    totalSessions: source.totalSessions,
    totalHours: source.totalHours,
    agents: source.agents.map((a) => ({ name: a.name, sessions: a.sessions })),
    topProjects: source.topProjects.map((p) => ({
      name: p.name,
      sessions: p.sessions,
    })),
  };
}

/**
 * `projects[n]` — the case-study fields the site renders.
 *
 * Dropped, because `Project` has no field for them: `attribution`, `period`,
 * `body`, `media`, `links`, and the three publish-control fields (`published`,
 * `featured`, `sortOrder` — the last of which is already expressed as the array
 * order). `media` is the significant one: ADR 009 sanitised screenshots exist on
 * the row and `/work/[slug]` still draws procedural art, which stays true until
 * the contract grows an image field.
 *
 * The optional trio is assigned rather than spread so an absent Convex field
 * stays an absent key — a renderer testing `project.problem` and one testing
 * `"problem" in project` then agree, which is the same reasoning `projectRole`
 * in `packages/convex/convex/resume.ts` applies to `skills`.
 */
function mapProject(row: ProjectRow): Project {
  const project: Project = {
    slug: row.slug,
    title: row.title,
    client: row.client,
    role: row.role,
    summary: row.summary,
    stack: [...row.stack],
    accent: row.accent,
    accentHue: row.accentHue,
  };

  if (row.problem !== undefined) project.problem = row.problem;
  if (row.approach !== undefined) project.approach = row.approach;
  if (row.outcomes !== undefined) project.outcomes = [...row.outcomes];
  if (row.aiBuildStats !== undefined) {
    project.aiBuildStats = {
      sessions: row.aiBuildStats.sessions,
      hours: row.aiBuildStats.hours,
    };
  }

  return project;
}

/**
 * `labs[n]` — the four `liveStats` figures the recency wall is drawn from.
 *
 * Dropped: `coverImage` (required on the Convex row and on `LabSchema`, absent
 * from the mock's `Lab` — `/labs` renders its own capture assets from
 * `FeaturedLabs.tsx` today), `links`, and the publish-control fields.
 *
 * **`lastPushDaysAgo` is recomputed, not copied.** `@home/types` flags this as a
 * DIVERGENCE and says which side is the fact: "`lastPushedAt` is the fact,
 * `lastPushDaysAgo` is the precomputed display value", one that "silently rots if
 * the cron stalls". So when the row carries the absolute timestamp it wins,
 * measured against the same `computedAt` every other relative figure on the page
 * is measured against; the stored integer is the fallback for rows written
 * before the cron set one.
 */
function mapLab(row: LabRow, computedAt: string): Lab {
  const { lastPushedAt } = row.liveStats;

  return {
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    repoFullName: row.repoFullName,
    language: row.language,
    liveStats: {
      stars: row.liveStats.stars,
      forks: row.liveStats.forks,
      commitsYear: row.liveStats.commitsYear,
      lastPushDaysAgo:
        lastPushedAt !== undefined
          ? daysAgo(lastPushedAt, computedAt)
          : row.liveStats.lastPushDaysAgo,
    },
    featured: row.featured,
  };
}

/**
 * `funLog[n]` — one dated life item, in the mock's four-way shape.
 *
 * Dropped: `photo`, `rating`, `location`. All three are on the Convex row and
 * none has a home in `FunEntry` / `PubEntry`. `photo` is the one that matters —
 * `@home/types` calls Fun Entries "photo-first" and the whole point of the table
 * is that /fun has images — so widening the contract to carry it is the obvious
 * next change, and deliberately not this agent's to make.
 *
 * `note` and the walk metrics are optional on the row and required on the mock's
 * union (`note` for beer/coffee/pub, `steps`/`km` for walks), so they take empty
 * defaults. A walk never gets a `note` key at all: the mock's walk member does
 * not declare one, and adding it would fail the union's excess-property check.
 */
function mapFunEntry(row: FunRow, computedAt: string): FunLogEntry {
  const when = daysAgo(row.occurredAt, computedAt);

  if (row.type === "walk") {
    return {
      type: "walk",
      title: row.title,
      steps: row.steps ?? 0,
      km: row.km ?? 0,
      daysAgo: when,
    };
  }

  return {
    type: row.type,
    title: row.title,
    note: row.note ?? "",
    daysAgo: when,
  };
}

/** Pubs are the one kind outside the `FunEntry` union. See `PubEntry` in snapshot.ts. */
function isFunEntry(entry: FunLogEntry): entry is FunEntry {
  return entry.type !== "pub";
}

/**
 * `resumeDocument` — the render-ready projection, copied as it is stored.
 *
 * Dropped: `skills` on each role. `ResumeRole` in the mock has no such field,
 * and `resumeDocument.experience` is a *projection* — the source of truth is
 * `experienceEntries.skills`, which is still one query away for whoever adds a
 * skills cluster to /resume.
 *
 * `experience` is not re-sorted. `packages/convex/convex/resume.ts` builds the
 * projection in `by_sortOrder` ascending, which is the admin's chosen print
 * order and is newest role first — "a resume sometimes leads with the role that
 * argues best rather than the latest", and `deriveResume().currentRole` reads
 * `experience[0]` on exactly that basis.
 */
function mapResume(row: ResumeRow): ResumeDocument {
  return {
    summary: row.summary,
    experience: row.experience.map((role) => ({
      company: role.company,
      title: role.title,
      start: role.start,
      end: role.end,
      summary: role.summary,
      highlights: [...role.highlights],
    })),
    capabilities: [...row.capabilities],
    education: row.education.map((entry) => ({
      institution: entry.institution,
      credential: entry.credential,
      start: entry.start,
      end: entry.end,
    })),
    embedGitStats: row.embedGitStats,
  };
}

/* ------------------------------------------------------------------ *
 * The assembler
 * ------------------------------------------------------------------ */

/**
 * The whole public site's data, as one `Snapshot`.
 *
 * ── `cache()`, and why it is not optional ──────────────────────────────────
 *
 * Wrapped in React's `cache()` so the six queries run **once per request** no
 * matter how many callers ask. Next memoises identical `fetch` calls
 * automatically, but only for `GET` — Convex queries are `POST`, so nothing
 * de-duplicates them for us and the narrow getters below would otherwise each
 * pay for a full round of reads.
 *
 * `cache()` is per-request, not persistent: it does not cache across renders,
 * and it is not what makes the page cheap between visitors. That is the ISR
 * window (see the file header) — `cache()` only makes one render coherent, which
 * also means every figure on a page is measured against a single `computedAt`.
 *
 * ── The zero-env path ──────────────────────────────────────────────────────
 *
 * No `NEXT_PUBLIC_CONVEX_URL` returns the mock object itself — not a copy, not a
 * rebuild. That keeps a checkout with no environment rendering byte-identical
 * output to what it rendered before this module existed, which is the property
 * the whole build is held to.
 */
export const getSiteData = cache(async (): Promise<Snapshot> => {
  if (!CONVEX_URL) return mock;

  // A fresh client per request. Convex's own docs warn that `ConvexHttpClient`
  // is stateful (it holds credentials and a mutation queue) and "take care to
  // avoid sharing it between requests in a server". Nothing here authenticates
  // or mutates, so a module-scope client would in fact be safe — but a cheap
  // constructor is a poor reason to keep a shared mutable object around a
  // server, and `cache()` already limits this to one per request.
  const client = new ConvexHttpClient(CONVEX_URL, { logger: false });

  // One round trip's worth of latency, not six. Each read fails independently —
  // `read()` maps a rejection to `null`, so `Promise.all` cannot reject and one
  // sick table cannot take the page down.
  const [snapshotRow, settingsRow, projectRows, labRows, funRows, resumeRow] =
    await Promise.all([
      read("snapshot.get", () => client.query(api.snapshot.get, {})),
      read("siteSettings.get", () => client.query(api.siteSettings.get, {})),
      read("projects.list", () => client.query(api.projects.list, {})),
      read("labs.list", () => client.query(api.labs.list, {})),
      read("funEntries.list", () => client.query(api.funEntries.list, {})),
      read("resume.get", () => client.query(api.resume.get, {})),
    ]);

  /* ---- the clock -------------------------------------------------- *
   * Every relative figure below (`daysAgo`, `lastPushDaysAgo`, the /fun
   * date stamps) is measured against this one instant, so a stalled cron
   * produces stale-but-consistent output rather than a page that
   * contradicts itself. Without a snapshot row there is no such instant,
   * and the mock's own `computedAt` stands in — which is right, because
   * without a snapshot row the telemetry is the mock's too. */
  const computedAt = snapshotRow?.computedAt ?? mock.computedAt;

  /* ---- identity --------------------------------------------------- *
   * `siteSettings` first. schema.ts is explicit that it is the source of
   * truth and that `snapshot.identity` is a denormalised copy rebuilt by
   * the hourly cron — a cron that does not exist until phase 4, so the
   * copy is the *staler* of the two today. Reading settings first is also
   * what makes `setAvailability` ("I just accepted an offer, take the
   * banner down") visible within one ISR window instead of at the next
   * tick of a job nobody has written. */
  const identity =
    settingsRow !== null
      ? mapIdentity(settingsRow.identity)
      : snapshotRow !== null
        ? mapIdentity(snapshotRow.identity)
        : mock.identity;

  /* ---- fun -------------------------------------------------------- *
   * One table, two views. `funEntries.list` returns all four kinds
   * newest-first off `by_occurredAt`; `funLog` is that list, and
   * `funEntries` is the same list with pubs removed — the mock's split,
   * kept because eight archived variants build an exhaustive
   * `Record<FunEntry['type'], …>` and widening that union breaks them.
   *
   * Re-sorted by `daysAgo` rather than trusted: the index orders by
   * instant, the page groups by calendar day, and two entries on the same
   * day must not swap places between renders. `sort` is stable in every
   * runtime this ships to, so same-day entries keep the index's order. */
  const funLog: FunLogEntry[] | null =
    funRows !== null && funRows.length > 0
      ? funRows
          .map((row) => mapFunEntry(row, computedAt))
          .sort((a, b) => a.daysAgo - b.daysAgo)
      : null;

  return {
    identity,

    gitStats: snapshotRow !== null ? mapGitStats(snapshotRow.gitStats) : mock.gitStats,
    aiUsage: snapshotRow !== null ? mapAiUsage(snapshotRow.aiUsage) : mock.aiUsage,

    projects:
      projectRows !== null && projectRows.length > 0
        ? projectRows.map(mapProject)
        : mock.projects,

    labs:
      labRows !== null && labRows.length > 0
        ? labRows.map((row) => mapLab(row, computedAt))
        : mock.labs,

    resumeDocument: resumeRow !== null ? mapResume(resumeRow) : mock.resumeDocument,

    funEntries: funLog !== null ? funLog.filter(isFunEntry) : mock.funEntries,
    funLog: funLog ?? mock.funLog,

    computedAt,
  };
});

/* ------------------------------------------------------------------ *
 * Narrow getters
 *
 * Convenience over `getSiteData()`, not extra reads: every one of these
 * awaits the same cached assembly, so a page that calls three of them
 * still costs one round of queries. They exist so a page that needs one
 * domain does not have to destructure a whole Snapshot, and so the
 * import in a page says what the page is about.
 * ------------------------------------------------------------------ */

/** Who the site is about. `siteSettings` first — see the assembler. */
export async function getIdentity(): Promise<Identity> {
  return (await getSiteData()).identity;
}

/** Published case studies, in display order (`by_published_sortOrder`). */
export async function getProjects(): Promise<Project[]> {
  return (await getSiteData()).projects;
}

/**
 * One case study, or `undefined` — which `/work/[slug]` renders as `notFound()`.
 *
 * Finds within the published list rather than issuing `projects.getBySlug`, so
 * the row, its index in the grid and its prev/next neighbours all come from one
 * consistent read. A draft slug is `undefined` here for the same reason it is
 * `null` there: a draft URL must 404 for the public exactly as a nonexistent one
 * does.
 */
export async function getProjectBySlug(slug: string): Promise<Project | undefined> {
  return (await getProjects()).find((project) => project.slug === slug);
}

/**
 * Published labs, in `sortOrder`.
 *
 * Not in recency order — `deriveLabs()` owns that, because the sort is a
 * property of the page's argument rather than of the data.
 */
export async function getLabs(): Promise<Lab[]> {
  return (await getSiteData()).labs;
}

/** The whole off-the-clock feed, newest first. All four kinds, pubs included. */
export async function getFunLog(): Promise<FunLogEntry[]> {
  return (await getSiteData()).funLog;
}

/**
 * The feed without pub visits, newest first — the narrower union the homepage's
 * LifeStrip and every archived variant read. See `PubEntry` in snapshot.ts.
 */
export async function getFunEntries(): Promise<FunEntry[]> {
  return (await getSiteData()).funEntries;
}

/** The Resume Document: summary, the experience projection, capabilities, education. */
export async function getResume(): Promise<ResumeDocument> {
  return (await getSiteData()).resumeDocument;
}
