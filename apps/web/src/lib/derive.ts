/**
 * derive.ts — every figure the site prints, as a pure function of its input.
 *
 * ── Why this module exists ─────────────────────────────────────────────────
 *
 * `components/site/work/data.ts`, `labs/data.ts`, `fun/data.ts` and
 * `resume/data.ts` each did the same thing: `import { snapshot }` at the top,
 * reduce it at module load, and `export const` the results. That is exactly
 * right for a frozen mock — the reductions have no business running per render —
 * and exactly wrong for data fetched per request, because a module-scope
 * constant is computed once per *process* and can never see a Convex row.
 *
 * So the reductions moved here, unchanged, as functions of their inputs:
 *
 *     deriveWork(projects)                     → WorkDerived
 *     deriveLabs(labs)                         → LabsDerived
 *     deriveFun(funLog, computedAt)            → FunDerived
 *     deriveResume({ gitStats, aiUsage, … })   → ResumeDerived
 *
 * Every field on the returned objects keeps the **name and the semantics** of
 * the `export const` it replaces, so migrating a page is mechanical:
 *
 *     - import { buildSessions, buildHours } from "@/components/site/work/data";
 *     + const { buildSessions, buildHours } = deriveWork(snapshot.projects);
 *
 * The four old modules survive for now as thin wrappers that call these against
 * the mock (see the deprecation notice at the top of each). They are deleted by
 * whichever page agent migrates the page that last imported them.
 *
 * ── Rules for anything added below ─────────────────────────────────────────
 *
 *   • Pure. No imports of `@/lib/snapshot`'s *value*, no `Date.now()`, no
 *     environment reads. Every relative figure is measured against the
 *     `computedAt` that arrives as an argument — the same rule the mock already
 *     followed, and the reason the stamps are identical on server and client in
 *     every timezone.
 *   • Serializable in, serializable out, apart from the handful of closures the
 *     old modules already exported as functions (`buildRank`, `neighbours`,
 *     `isoDaysAgo`, `hueFor`, `axisPos`, `tenureYears`). Those are derived
 *     *behaviour*, so they stay behind the derive call and are never passed
 *     across a server/client boundary — pass the plain values instead.
 *   • Empty collections are live states. Derivations either reduce them to
 *     zeroes or are called only after the owning page has rendered its explicit
 *     empty state.
 */

import type {
  AiUsage,
  FunLogEntry,
  GitStats,
  Lab,
  Post,
  Project,
  ResumeDocument,
} from "@/lib/snapshot";

/* ================================================================== *
 * /work
 *
 * Was: components/site/work/data.ts
 * ================================================================== */

/** A project that carries agent-effort figures. `aiBuildStats` is optional. */
export type BuiltProject = Project & {
  aiBuildStats: NonNullable<Project["aiBuildStats"]>;
};

/** Standalone: a narrowing predicate, not a derivation. */
export function hasBuildStats(project: Project): project is BuiltProject {
  return project.aiBuildStats !== undefined;
}

/** `1` → `01`. Instrument numbering. Standalone — no input to derive from. */
export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

const COUNT_WORDS = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
] as const;

/** `4` → `Four`, falling back to the digits past ten. Standalone. */
export function countWord(n: number): string {
  return COUNT_WORDS[n] ?? String(n);
}

export type WorkDerived = {
  /** The platforms with measured agent effort behind them. */
  buildProjects: BuiltProject[];
  buildSessions: number;
  buildHours: number;
  /** Busiest platform by agent sessions — the scale every ledger bar is drawn to. */
  peakBuildSessions: number;
  /** Mean session length across the client platforms, in whole minutes. */
  avgBuildMinutes: number;
  /** Distinct technologies across every platform, first-appearance order. */
  stackUnion: string[];
  /** 1-based rank of a platform by agent sessions, or 0 if it has no figures. */
  buildRank: (slug: string) => number;
  /** Position of a project in the canonical order, or -1. */
  projectIndex: (slug: string) => number;
  /**
   * The two projects either side of `index`, wrapping at both ends so a case
   * study always has somewhere to go next. With multiple platforms the pair is
   * always distinct from each other and from the current page.
   */
  neighbours: (index: number) => { prev: Project; next: Project };
};

/**
 * Every derived figure /work and /work/[slug] print, from the project list.
 *
 * `projects` is the *display* order — for Convex that is `by_published_sortOrder`
 * ascending, for the mock it is the array's own order. `projectIndex` and
 * `neighbours` are indices into that same array, so the prev/next pair and the
 * `Case 03` stamp always agree with the grid the visitor just came from.
 */
export function deriveWork(projects: readonly Project[]): WorkDerived {
  const buildProjects: BuiltProject[] = projects.filter(hasBuildStats);

  const buildSessions = buildProjects.reduce(
    (sum, p) => sum + p.aiBuildStats.sessions,
    0,
  );

  const buildHours = buildProjects.reduce(
    (sum, p) => sum + p.aiBuildStats.hours,
    0,
  );

  const peakBuildSessions = buildProjects.reduce(
    (max, p) => Math.max(max, p.aiBuildStats.sessions),
    0,
  );

  const avgBuildMinutes =
    buildSessions === 0 ? 0 : Math.round((buildHours * 60) / buildSessions);

  const stackUnion: string[] = Array.from(
    new Set(projects.flatMap((p) => p.stack)),
  );

  /** Sessions, descending — used for the "rank among platforms" readout. */
  const bySessions = [...buildProjects].sort(
    (a, b) => b.aiBuildStats.sessions - a.aiBuildStats.sessions,
  );

  return {
    buildProjects,
    buildSessions,
    buildHours,
    peakBuildSessions,
    avgBuildMinutes,
    stackUnion,

    buildRank(slug: string): number {
      return bySessions.findIndex((p) => p.slug === slug) + 1;
    },

    projectIndex(slug: string): number {
      return projects.findIndex((p) => p.slug === slug);
    },

    neighbours(index: number): { prev: Project; next: Project } {
      const n = projects.length;
      return {
        prev: projects[(index - 1 + n) % n],
        next: projects[(index + 1) % n],
      };
    },
  };
}

/* ================================================================== *
 * /labs
 *
 * Was: components/site/labs/data.ts
 *
 * The page's whole argument is that a personal repo is measured by
 * *movement*, not by stars, so the ordering and the ramp are both keyed
 * off recency.
 * ================================================================== */

/** Weeks in the trailing window `liveStats.commitsYear` is counted over. */
export const WEEKS = 52;

/** Commits a week, averaged over the trailing window. Standalone. */
export function cadence(lab: Lab): number {
  return lab.liveStats.commitsYear / WEEKS;
}

/**
 * Recency band, 0 (hot) → 3 (cold). Maps onto the shared `--hor-l1…l4` ramp,
 * so a fresh push reads amber exactly like a peak day on the homepage heatmap.
 */
export function band(daysAgo: number): 0 | 1 | 2 | 3 {
  if (daysAgo <= 1) return 0;
  if (daysAgo <= 7) return 1;
  if (daysAgo <= 21) return 2;
  return 3;
}

/** `0 → 'active today'`, otherwise `'active 12d ago'`. */
export function activePhrase(daysAgo: number): string {
  return daysAgo <= 0 ? "active today" : `active ${daysAgo}d ago`;
}

export function repoUrl(lab: Lab): string {
  return `https://github.com/${lab.repoFullName}`;
}

export type LabsDerived = {
  /** Most recently pushed first; commits break a tie. Never mutates the source. */
  labs: Lab[];
  totalCommits: number;
  totalStars: number;
  totalForks: number;
  maxCommits: number;
  /** The freshest repo — the one the recency panel points at. */
  freshest: Lab;
  stalest: Lab;
  featuredCount: number;
  /** Distinct primary languages, in recency order. */
  languages: string[];
  /** The recency axis runs 0 → a whole number of weeks, never shorter than one. */
  axisMax: number;
  axisTicks: number[];
  combinedCadence: number;
  /** Position along the recency axis, 0 (today) → 1 (axis end). */
  axisPos: (daysAgo: number) => number;
};

/**
 * Every derived figure /labs prints, from the lab list.
 *
 * ⚠️ `freshest` and `stalest` are typed as `Lab`, not `Lab | undefined`, because
 * that is what the telemetry panels read. The owning page renders its explicit
 * live empty state before calling this function.
 */
export function deriveLabs(source: readonly Lab[]): LabsDerived {
  const labs: Lab[] = [...source].sort(
    (a, b) =>
      a.liveStats.lastPushDaysAgo - b.liveStats.lastPushDaysAgo ||
      b.liveStats.commitsYear - a.liveStats.commitsYear,
  );

  const totalCommits = labs.reduce((n, l) => n + l.liveStats.commitsYear, 0);
  const totalStars = labs.reduce((n, l) => n + l.liveStats.stars, 0);
  const totalForks = labs.reduce((n, l) => n + l.liveStats.forks, 0);

  // `Math.max(...[])` is `-Infinity`; a reduce with a seed is not.
  const maxCommits = labs.reduce((n, l) => Math.max(n, l.liveStats.commitsYear), 0);

  const freshest = labs[0];
  const stalest = labs[labs.length - 1];

  const stalestDaysAgo =
    labs.length === 0 ? 0 : stalest.liveStats.lastPushDaysAgo;

  const axisMax = Math.max(7, Math.ceil(stalestDaysAgo / 7) * 7);

  return {
    labs,
    totalCommits,
    totalStars,
    totalForks,
    maxCommits,
    freshest,
    stalest,
    featuredCount: labs.filter((l) => l.featured).length,
    languages: [...new Set(labs.map((l) => l.language))],
    axisMax,
    axisTicks: Array.from({ length: axisMax / 7 + 1 }, (_, i) => i * 7),
    combinedCadence: totalCommits / WEEKS,

    axisPos(daysAgo: number): number {
      return Math.min(1, daysAgo / axisMax);
    },
  };
}

/* ================================================================== *
 * /fun
 *
 * Was: components/site/fun/data.ts
 *
 * `funLog` is the superset the /fun page renders — `funEntries` (beer,
 * coffee, walks) plus pub visits, newest first. See the `PubEntry` note
 * in snapshot.ts for why pubs live outside the `FunEntry` union.
 * ================================================================== */

export type FunKind = FunLogEntry["type"];

/** A walk, narrowed out of the union so `steps` / `km` are reachable. */
export type WalkEntry = Extract<FunLogEntry, { type: "walk" }>;

export function isWalk(entry: FunLogEntry): entry is WalkEntry {
  return entry.type === "walk";
}

/*
 * `entryKey(entry)` — `${entry.type}-${entry.daysAgo}` — used to live here, and
 * was the documented blocker on authoring real fun entries: it collided for two
 * entries of one kind on one calendar day, which `FunBands` would have turned
 * into duplicate React keys the first time a second flat white was logged on a
 * Tuesday. It is **retired**, exactly as its own docblock said it should be:
 * `FunEntry` / `PubEntry` in `@/lib/snapshot` now carry an `id`, the read layer
 * carries it through from the Convex row's `_id`, and every consumer keys on
 * `entry.id`. Nothing derives a key from content any more — if you are adding
 * one, use the id.
 */

export const KIND_LABEL: Record<FunKind, string> = {
  beer: "Beer",
  coffee: "Coffee",
  walk: "Walk",
  pub: "Pub",
};

/** Reading order for the key row: what you drink, where you walk, where you sit. */
export const KIND_ORDER: readonly FunKind[] = ["coffee", "beer", "pub", "walk"];

/**
 * Base hue per kind, matching the homepage LifeStrip's palette: amber for
 * beer, roasted brown for coffee, the dusk-violet accent for walks. Pubs are
 * new here and take the sun's warm end.
 */
const BASE_HUE: Record<FunKind, number> = {
  beer: 38,
  coffee: 26,
  walk: 256,
  pub: 34,
};

/**
 * A tiny deterministic hue drift so no two cards of a kind paint identically.
 *
 * Indexed by the entry's position *within its own kind*, not within the log —
 * with five distinct steps and at most five entries of any kind, every card of
 * a kind is guaranteed its own hue. (A global index mod 3 collided: three of
 * the four coffees landed on the same drift.)
 */
const HUE_DRIFT = [0, -6, 7, -3, 5] as const;

export type Band = {
  id: string;
  label: string;
  /** One line of context under the band rule. */
  blurb: string;
  entries: FunLogEntry[];
};

/**
 * Page copy, not data: the band headings and the line under each rule. Lifted
 * verbatim from the old module so the migration cannot change a word of it.
 */
const BAND_SPEC: { id: string; label: string; blurb: string; upTo: number }[] = [
  {
    id: "week",
    label: "This week",
    blurb: "Still on my hands — the coffee, the walk, the Saturday pint.",
    upTo: 7,
  },
  {
    id: "month",
    label: "Earlier this month",
    blurb: "Ship-it Fridays, schnitzel night, and one properly long walk.",
    upTo: 31,
  },
  {
    id: "back",
    label: "Further back",
    blurb: "The tail of the log, kept because the days were good ones.",
    upTo: Infinity,
  },
];

export type FunTally = {
  entries: number;
  /** Oldest entry in the log, in days before the snapshot. */
  spanDays: number;
  km: number;
  steps: number;
  longestKm: number;
  counts: Record<FunKind, number>;
};

export type FunDerived = {
  /**
   * `daysAgo` back to the ISO date it happened on, relative to the snapshot's
   * own clock rather than the render's — so the stamps are stable in every
   * timezone and identical on server and client.
   */
  isoDaysAgo: (daysAgo: number) => string;
  hueFor: (entry: FunLogEntry) => number;
  tally: FunTally;
  /** ISO date of the newest and oldest entries — the log's actual extent. */
  logRange: { newest: string; oldest: string };
  /**
   * Bands — the only grouping on the page. Recency, not type; type is carried
   * by the artwork and a badge. No filters, so no client JS.
   */
  bands: Band[];
};

const DAY_MS = 86_400_000;

/**
 * Every derived figure /fun prints, from the log and the snapshot's clock.
 *
 * `log` must arrive newest-first (smallest `daysAgo` first); `getFunLog()` sorts
 * it that way, and each band preserves the order it is given.
 */
export function deriveFun(
  log: readonly FunLogEntry[],
  computedAt: string,
): FunDerived {
  const computedMs = Date.parse(computedAt);

  const isoDaysAgo = (daysAgo: number): string =>
    new Date(computedMs - daysAgo * DAY_MS).toISOString().slice(0, 10);

  /**
   * Hue per entry, keyed by `id`. Precomputed rather than derived on demand
   * because the drift depends on the entry's ordinal *within its kind*, which
   * only one pass over the whole log knows — and keyed by id rather than by
   * content so that two identical-looking entries (same kind, same day) still
   * get their own hue instead of sharing one bucket.
   */
  const hueById: ReadonlyMap<string, number> = (() => {
    const seen: Record<FunKind, number> = { beer: 0, coffee: 0, walk: 0, pub: 0 };
    const map = new Map<string, number>();
    for (const entry of log) {
      const nth = seen[entry.type]++;
      map.set(entry.id, BASE_HUE[entry.type] + HUE_DRIFT[nth % HUE_DRIFT.length]);
    }
    return map;
  })();

  const walks = log.filter(isWalk);

  const countOf = (kind: FunKind): number =>
    log.filter((entry) => entry.type === kind).length;

  const tally: FunTally = {
    entries: log.length,
    spanDays: log.reduce((max, e) => Math.max(max, e.daysAgo), 0),
    km: Math.round(walks.reduce((sum, w) => sum + w.km, 0) * 10) / 10,
    steps: walks.reduce((sum, w) => sum + w.steps, 0),
    longestKm: walks.reduce((max, w) => Math.max(max, w.km), 0),
    counts: {
      beer: countOf("beer"),
      coffee: countOf("coffee"),
      walk: countOf("walk"),
      pub: countOf("pub"),
    },
  };

  // `reduce(Math.min, Infinity)` on an empty log would stamp an Invalid Date.
  const newestDaysAgo =
    log.length === 0 ? 0 : log.reduce((min, e) => Math.min(min, e.daysAgo), Infinity);

  return {
    isoDaysAgo,

    hueFor(entry: FunLogEntry): number {
      return hueById.get(entry.id) ?? BASE_HUE[entry.type];
    },

    tally,

    logRange: {
      newest: isoDaysAgo(newestDaysAgo),
      oldest: isoDaysAgo(tally.spanDays),
    },

    bands: BAND_SPEC.map((spec, i) => {
      const from = i === 0 ? -1 : BAND_SPEC[i - 1].upTo;
      return {
        id: spec.id,
        label: spec.label,
        blurb: spec.blurb,
        entries: log.filter((e) => e.daysAgo > from && e.daysAgo <= spec.upTo),
      };
    }).filter((b) => b.entries.length > 0),
  };
}

/* ================================================================== *
 * /resume
 *
 * Was: components/site/resume/data.ts
 * ================================================================== */

/**
 * Everything /resume derives from. A structural subset of `Snapshot`, so
 * `deriveResume(await getSiteData())` typechecks without a projection step.
 */
export type ResumeInput = {
  gitStats: GitStats;
  aiUsage: AiUsage;
  resumeDocument: ResumeDocument;
  computedAt: string;
};

export type ResumeDerived = {
  /* ---- calendar ---- */
  weekCount: number;
  days: GitStats["calendar"][number];
  firstDay: string;
  lastDay: string;
  activeDays: number;
  coveragePct: number;
  /** One total per column — the cadence sparkline reads straight off this. */
  weeklyTotals: number[];
  peakWeekTotal: number;
  peakWeekIndex: number;
  peakWeekStart: string;
  perWeek: number;
  privatePct: number;

  /* ---- agents ---- */
  sessionsPerWeek: number;
  avgSessionMinutes: number;

  /* ---- the document ---- */
  snapshotYear: number;
  careerStartYear: number;
  yearsShipping: number;
  /** Tenure in whole years; an open-ended role runs to the snapshot year. */
  tenureYears: (start: string, end: string) => number;
  companyCount: number;
  currentRole: ResumeDocument["experience"][number];
};

/** First four digits of a free-form date string (`'2018'`, `'Mar 2018'`). */
function year(value: string): number | null {
  const match = value.match(/\d{4}/);
  return match ? Number(match[0]) : null;
}

/**
 * Every derived figure /resume prints.
 *
 * Note what it does *not* take: `identity`. The old module re-exported it for
 * convenience, but nothing here computes from it — pages read it straight off
 * the snapshot instead.
 *
 * The calendar guards below matter more than the others: an empty `calendar`
 * would make `firstDay` throw rather than render badly, and the git cron does
 * not exist until phase 4.
 */
export function deriveResume(input: ResumeInput): ResumeDerived {
  const { gitStats, aiUsage, resumeDocument, computedAt } = input;

  const weekCount = gitStats.calendar.length;
  const days = gitStats.calendar.flat();
  const firstWeek = gitStats.calendar[0];
  const lastWeek = gitStats.calendar[weekCount - 1];

  const activeDays = days.filter((day) => day.count > 0).length;

  const weeklyTotals: number[] = gitStats.calendar.map((week) =>
    week.reduce((sum, day) => sum + day.count, 0),
  );

  const peakWeekTotal = weeklyTotals.reduce((max, n) => Math.max(max, n), 0);
  const peakWeekIndex = weeklyTotals.indexOf(peakWeekTotal);

  const snapshotYear = new Date(computedAt).getUTCFullYear();

  const startYears = resumeDocument.experience
    .map((role) => year(role.start))
    .filter((value): value is number => value !== null);

  const careerStartYear = startYears.length
    ? Math.min(...startYears)
    : snapshotYear;

  return {
    weekCount,
    days,
    firstDay: weekCount === 0 ? "" : firstWeek[0].date,
    lastDay: weekCount === 0 ? "" : lastWeek[6].date,
    activeDays,
    coveragePct: days.length === 0 ? 0 : Math.round((activeDays / days.length) * 100),
    weeklyTotals,
    peakWeekTotal,
    peakWeekIndex,
    peakWeekStart:
      peakWeekIndex === -1 ? "" : gitStats.calendar[peakWeekIndex][0].date,
    perWeek:
      weekCount === 0 ? 0 : Math.round(gitStats.totalContributionsYear / weekCount),
    privatePct:
      gitStats.totalContributionsYear === 0
        ? 0
        : Math.round(
            (gitStats.privateContributions / gitStats.totalContributionsYear) * 100,
          ),

    sessionsPerWeek:
      weekCount === 0 ? 0 : Math.round(aiUsage.totalSessions / weekCount),
    avgSessionMinutes:
      aiUsage.totalSessions === 0
        ? 0
        : Math.round((aiUsage.totalHours * 60) / aiUsage.totalSessions),

    snapshotYear,
    careerStartYear,
    yearsShipping: Math.max(1, snapshotYear - careerStartYear),

    tenureYears(start: string, end: string): number {
      const from = year(start);
      const to = year(end) ?? snapshotYear;
      if (from === null) return 0;
      return Math.max(1, to - from);
    },

    companyCount: new Set(resumeDocument.experience.map((role) => role.company))
      .size,
    currentRole: resumeDocument.experience[0],
  };
}

/* ================================================================== *
 * /blog
 *
 * New in phase 3. There was no `components/site/blog/data.ts` to be
 * "was:" — the blog is the one section that was never built against the
 * mock, because per ADR 018 it has no mock to be built against.
 *
 * ⚠️ The module rule "callers pass non-empty collections" does NOT hold
 * here and every function below is written for the empty case first.
 * `getPosts()` returns `[]` on a deployment with nothing published — that
 * is the launch state, not a degraded one.
 * ================================================================== */

/**
 * Words per minute, for the reading estimate.
 *
 * 220 is the middle of the range usually quoted for adults reading prose on a
 * screen (200–250). It is rounded *up* to the nearest minute at the call site
 * rather than reported as "4.3 min", because the number is a courtesy — "have I
 * got time for this before my meeting" — and false precision on an estimate
 * built from a word count is the kind of thing this site should not do.
 */
const WORDS_PER_MINUTE = 220;

/**
 * Reading time in whole minutes, never less than one.
 *
 * Counted on the **markdown source**, which slightly over-counts: fence markers,
 * link targets and table pipes are not read. The alternative is to render the
 * post to HTML and strip tags, which means running the whole unified pipeline
 * (twice, on the index) to refine an estimate that is rounded to the minute
 * anyway. Markdown syntax is a rounding error against a 220-word minute.
 */
export function readingMinutes(post: Post): number {
  const words = post.body.split(/\s+/u).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}

export type BlogDerived = {
  /** The posts as given: published, newest first. Possibly empty. */
  posts: readonly Post[];
  count: number;
  /** Every tag used, most-used first, ties broken by most recent use. */
  tags: string[];
  /** The newest post, or `null` on an empty blog. */
  latest: Post | null;
  /** Summed reading estimate across every post. Zero on an empty blog. */
  totalMinutes: number;
  /** Position of a slug in `posts`, or -1. Drives the `01 / 04` stamps. */
  postIndex: (slug: string) => number;
  /**
   * The posts either side of `index`, **without wrapping**.
   *
   * Unlike `deriveWork().neighbours`, which wraps so a case study always has two
   * cards, this returns `null` at the ends. A case-study grid of four is a set
   * you can circle; a blog is a timeline, and "next" past the newest post would
   * be a lie about chronology.
   */
  neighbours: (index: number) => { prev: Post | null; next: Post | null };
};

/**
 * Reduce the published posts to everything /blog and /blog/[slug] print.
 *
 * No sorting: `getPosts()` hands over `by_published_publishedAt` descending,
 * which is genuine reverse-chronological order from the index. Re-sorting here
 * would be a second opinion about the same fact.
 *
 * "prev" and "next" are in **reading** terms, not array terms: `posts` is newest
 * first, so `prev` (the older post) is the *later* array entry. The naming
 * follows the reader's mental model rather than the data structure's, which is
 * why the two are spelled out here rather than left to the call site.
 */
export function deriveBlog(posts: readonly Post[]): BlogDerived {
  const frequency = new Map<string, number>();
  for (const post of posts) {
    for (const tag of post.tags) {
      frequency.set(tag, (frequency.get(tag) ?? 0) + 1);
    }
  }

  return {
    posts,
    count: posts.length,

    // `Map` preserves insertion order, and insertion order here is newest post
    // first — so a stable sort on the count alone leaves ties in recency order,
    // which is the tie-break worth having on a blog.
    tags: [...frequency.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([tag]) => tag),

    latest: posts[0] ?? null,
    totalMinutes: posts.reduce((sum, post) => sum + readingMinutes(post), 0),

    postIndex(slug: string): number {
      return posts.findIndex((post) => post.slug === slug);
    },

    neighbours(index: number) {
      return {
        prev: posts[index + 1] ?? null,
        next: index > 0 ? (posts[index - 1] ?? null) : null,
      };
    },
  };
}
