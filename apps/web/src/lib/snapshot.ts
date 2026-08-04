/**
 * snapshot.ts — the `Snapshot` contract, plus fixed design-study fixture data.
 *
 * Two jobs, and it is worth being precise about which is which:
 *
 *   1. **The types are the contract.** `Snapshot` is the shape every `(site)` page,
 *      every component and all of `@/lib/derive` is written against. Convex does not
 *      widen it, narrow it, or replace it — the read layer maps rows *into* this
 *      shape. Change the contract here and both sources have to follow.
 *
 *   2. **The `snapshot` object is a fixture.** The archived `/v/*` explorations and
 *      `/variants` index are deliberately pinned to deterministic content so they
 *      remain a stable design record. Public `(site)` routes never read this value;
 *      `@/lib/data` maps live Convex rows into the contract and rejects missing data.
 *
 * Production consumers import only the types and take a live `Snapshot` from
 * `@/lib/data`. The `/v/*` exploration routes and `/variants` are the explicit
 * fixture consumers.
 *
 * Everything is deterministic. The contribution calendar is generated at module load
 * from a seeded PRNG (never Math.random), so every import — server render, client
 * hydration, another dev's machine — produces byte-identical output.
 */

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

export type ContributionLevel = 0 | 1 | 2 | 3 | 4;

/**
 * One project's slice of one day's commits — `QuoteCloud · 5 commits`, as the
 * heatmap's day popup prints it.
 *
 * ⚠️ `name` is a DISPLAY NAME and only ever a display name: a case-study title,
 * a Lab title, or `OTHER_WORK` below. Never a repository identifier — not
 * `pricing-portal-v2`, not `coreybain/boca`, not any owner/name pair, public or
 * private. ADR 008 lives or dies on this field, because unlike every other
 * number on the page this one is a *string the producer chose*, and it lands
 * verbatim in a public tooltip. The live pipeline maps repositories to names
 * server-side against a table with no public query; a repository it cannot name
 * folds into `OTHER_WORK` rather than naming itself.
 */
export type ContributionProject = {
  name: string;
  /** Commits attributed to that name on that day. Always ≥ 1. */
  commits: number;
};

/**
 * The neutral bucket for commits the producer will not name — unmapped private
 * work, and public-but-uncurated repos (ADR 014: junk repos stay unsurfaced).
 *
 * Real commits, honestly counted, deliberately not attributed. Hiding them would
 * understate the day; naming them would break ADR 008.
 *
 * `OTHER_WORK_LABEL` in `@home/types` is the canonical declaration. It is copied
 * here rather than imported because this module is import-free by doctrine — it
 * is the zero-dependency fallback the `/v/*` studies render from, and it stays
 * that way. Same string, three files (here, `@home/types`, the Convex cron), one
 * owner.
 */
export const OTHER_WORK = 'Other work';

export type ContributionDay = {
  /** ISO date, `YYYY-MM-DD`, UTC. */
  date: string;
  count: number;
  level: ContributionLevel;
  /**
   * The day's TOP project by commit count; `null` on an inactive day.
   *
   * A summary of `byProject`, not an independent fact: it is
   * `byProject[0].name`, or `null`. It survives alongside the breakdown because
   * it predates it and because consumers that will never grow a popup read it —
   * the eight archived studies under `app/v/*`, which are pinned to this file
   * and must not be touched. A producer may be stricter and leave it `null`
   * while `byProject` is populated (the live cron refuses to label a day whose
   * leader holds only a minority of it), but it may never name something that
   * is absent from `byProject`.
   *
   * It cannot answer "which projects, how many each". That is `byProject`.
   */
  project: string | null;
  /**
   * Per-project commit counts for that day. **Empty on an inactive day**, and
   * legitimately empty on an active one the producer could not attribute — in
   * which case the popup shows the count and no breakdown, which is the honest
   * output rather than a missing one.
   *
   * Sorted by `commits` descending, ties by `name` ascending. Names unique.
   * Every count ≥ 1. `sum(commits) ≤ count`: `count` is GitHub's *contribution*
   * total (commits, but also PRs, reviews and issues), so the two need not meet
   * and nothing may invent commits to close the gap.
   */
  byProject: ContributionProject[];
};

/** Seven days, Sunday → Saturday. One column of the heatmap. */
export type ContributionWeek = ContributionDay[];

export type LanguageShare = {
  name: string;
  /** Percentage of tracked code, 0–100. All shares sum to 100. */
  pct: number;
};

export type AgentUsage = { name: string; sessions: number };

export type ProjectUsage = { name: string; sessions: number };

export type HealthActivityKind = "walking" | "running" | "cycling" | "gym" | "other";

/** A privacy-bounded workout summary read from Apple Health. */
export type HealthActivity = {
  /** Stable HealthKit UUID, used to reconcile repeat syncs. */
  id: string;
  kind: HealthActivityKind;
  title: string;
  startedAt: string;
  durationMinutes: number;
  distanceKm?: number;
};

/** One local calendar day's movement totals, read from Apple Health. */
export type HealthDay = {
  date: string;
  steps: number;
  distanceKm: number;
  activities: HealthActivity[];
};

/** The HealthKit summary folded onto the live Convex snapshot. */
export type HealthStats = {
  latestDay: HealthDay;
  sevenDayAverageSteps: number;
  /** The days currently exposed to the site, oldest first. */
  recentDays: HealthDay[];
  /** The last time the iPhone successfully posted health totals. */
  syncedAt: string;
};

/** Agent sessions and wall-clock hours spent building one thing. */
export type AiBuildStats = { sessions: number; hours: number };

export type Project = {
  slug: string;
  title: string;
  client: string;
  role: string;
  summary: string;
  stack: string[];
  /**
   * A CSS color for the project. Variants render placeholder art procedurally —
   * there are no image assets yet — so this is the seed for gradients, rules and
   * blocks. Pair with `accentHue` when you need to derive a whole ramp:
   * `hsl(${p.accentHue} 90% 60%)`, `hsl(${p.accentHue + 40} 80% 40%)`, etc.
   */
  accent: string;
  /** The same accent expressed as an HSL hue angle in degrees, 0–360. */
  accentHue: number;

  /* ---- case-study detail. ALL OPTIONAL. -------------------------------- *
   * Added for the /work pages. Every field below is optional on purpose:
   * eight archived variants under /v/* read `projects` and none of them know
   * these exist. Never promote one of these to required. */

  /** What was broken before. 2–3 sentences. */
  problem?: string;
  /** How it was solved — architecture, delivery, the shape of the team. */
  approach?: string;
  /** Short, measurable result lines. Render as a list, not a paragraph. */
  outcomes?: string[];
  /** Long-form Markdown for the fuller case-study narrative. */
  body?: string;
  /** Agreed ownership credit for employer or client work. */
  attribution?: string;
  /** Free-form engagement period, where the source record provides one. */
  period?: string;
  /** Public product and press links. Private repositories are never exposed. */
  links?: { live?: string; press?: string };
  /**
   * Agent effort spent on this project. Where the title also appears in
   * `aiUsage.topProjects`, `sessions` matches that number exactly.
   */
  aiBuildStats?: AiBuildStats;
};

/**
 * A repo built for its own sake — no client, no invoice.
 *
 * `liveStats` is the part the collector will refresh from the GitHub API; the
 * rest is hand-written copy. Numbers here are personal-repo scale on purpose:
 * a side project has three stars, not three hundred.
 */
export type Lab = {
  slug: string;
  title: string;
  summary: string;
  /** `owner/name`, exactly as GitHub spells it. */
  repoFullName: string;
  /** GitHub's primary-language label for the repo. */
  language: string;
  liveStats: {
    stars: number;
    forks: number;
    /** Commits in the trailing 12 months. */
    commitsYear: number;
    /** Days since the last push, relative to `computedAt`. */
    lastPushDaysAgo: number;
  };
  featured: boolean;
};

export type ResumeRole = {
  company: string;
  title: string;
  /** Free-form, e.g. `'2022'` or `'Mar 2018'`. Rendered verbatim. */
  start: string;
  /** `'Present'` for the current role. */
  end: string;
  summary: string;
  highlights: string[];
};

export type ResumeEducation = {
  institution: string;
  credential: string;
  start: string;
  end: string;
};

export type ResumeDocument = {
  summary: string;
  experience: ResumeRole[];
  capabilities: string[];
  education: ResumeEducation[];
  /**
   * When true, the /resume page splices the live `gitStats` / `aiUsage`
   * readouts into the document instead of quoting stale numbers in prose.
   */
  embedGitStats: boolean;
};

/**
 * An image on a post, as UploadThing stores it (ADR 010).
 *
 * `width`/`height` are optional on the Convex row and therefore optional here,
 * but every renderer should treat their absence as the exceptional case: the
 * blog reserves space for the cover from these two numbers, and without them the
 * only honest options are a CLS-inducing reflow or a fixed-ratio crop. The blog
 * takes the crop — see `<PostCover>`.
 */
export type PostCover = {
  url: string;
  alt: string;
  caption?: string;
  width?: number;
  height?: number;
};

/**
 * One published blog post.
 *
 * ── Why this type is here and the data is not ──────────────────────────────
 *
 * The rule at the top of this file is "the types are the contract, the
 * `snapshot` object is the design fixture". `Post` takes the first half and
 * deliberately refuses the second: there is **no `posts` key on the `snapshot`
 * object**, and `Snapshot` therefore has no `posts` field.
 *
 * That is ADR 018, expressed in the type system. Every other domain falls back
 * to mock data when Convex is empty, because a dashboard with no telemetry is
 * broken. A blog with no posts is not broken — it is a blog nobody has written
 * in yet, which the ADR explicitly permits at launch — and a mock fallback here
 * would do the one thing the ADR forbids: fabricate writing that does not exist,
 * on a site whose entire argument is that its numbers are real. `getPosts()` in
 * `@/lib/data` returns `[]` in exactly the cases every other getter returns the
 * mock, and `/blog` renders its empty state.
 *
 * `body` is **markdown**, not HTML — see `packages/convex/convex/posts.ts` —
 * and is rendered by `@/lib/markdown` on the server. Nothing may hand it to a
 * browser unrendered.
 */
export type Post = {
  slug: string;
  title: string;
  /** One or two sentences. The index card's copy, and the meta description. */
  excerpt: string;
  /** The whole post, in markdown. Server-rendered; never sent raw to a client. */
  body: string;
  coverImage: PostCover;
  tags: string[];
  /**
   * ISO instant of first publication. Non-null on every post this type ever
   * describes: `posts.list` returns published rows only to an anonymous caller,
   * and a published row always carries a date (the `publish` mutation stamps
   * both in one patch, which is why they cannot come apart).
   */
  publishedAt: string;
};

/**
 * One off-the-clock entry.
 *
 * ── Why `id` exists ────────────────────────────────────────────────────────
 *
 * It is the entry's identity, and the only thing on this type that is not
 * rendered. `/fun` groups the log into recency bands and lists it; React needs
 * a stable key per row, and every candidate built out of the *content* is a
 * collision waiting to happen — two coffees on one day share `type-daysAgo`,
 * two visits to the same pub share `type-title`. Both were in use before this
 * field existed, and both were latent bugs kept harmless only by the mock's
 * hand-picked uniqueness. Authoring a second flat white on a Tuesday would have
 * been enough to trip them.
 *
 * ── Where the value comes from ─────────────────────────────────────────────
 *
 * Convex rows hand over their `_id` (see `mapFunEntry` in `@/lib/data`); the
 * mock uses literals of the form `mock-beer-1`, numbered per kind in log order,
 * which keeps this file's determinism doctrine — same import, byte-identical
 * output, forever.
 *
 * It is typed `string`, not `Id<'funEntries'>`, and is deliberately **opaque**:
 * nothing may parse it, link to it, or query with it (`funEntries` has no
 * per-entry route — /fun is a grid). Typing it as an opaque string is what lets
 * one field carry both a Convex document id and a mock literal, and it keeps
 * `@/lib/snapshot` free of any Convex import.
 *
 * ── What it is *not* ───────────────────────────────────────────────────────
 *
 * This is the assembled contract, not a stored shape. The Convex side is
 * untouched: `funEntryFields` in schema.ts has no `id` column (`_id` is the
 * row's identity already), and the denormalised `snapshot.latestFunEntry` copy
 * needs none either — it is display-only, it feeds one tile that links to
 * `/fun`, and nothing in `@/lib/data` reads it. The id is minted at the
 * assembly boundary and lives only above it.
 */
export type FunEntry =
  | { id: string; type: 'beer'; title: string; note: string; daysAgo: number }
  | { id: string; type: 'coffee'; title: string; note: string; daysAgo: number }
  | {
      id: string;
      type: 'walk';
      title: string;
      steps: number;
      km: number;
      daysAgo: number;
    };

/**
 * A pub visit — the fourth kind of fun, added for the /fun page.
 *
 * It is deliberately NOT a member of `FunEntry`. Every archived variant builds
 * an exhaustive `Record<FunEntry['type'], …>` lookup table, so widening that
 * union would fail the typecheck in eight files under /v/* that must not be
 * touched. New kinds go in `funLog` instead; `funEntries` keeps its original
 * three-way shape forever.
 */
export type PubEntry = {
  id: string;
  type: 'pub';
  title: string;
  note: string;
  daysAgo: number;
};

/** The full off-the-clock feed: everything in `funEntries`, plus pub visits. */
export type FunLogEntry = FunEntry | PubEntry;

/* ------------------------------------------------------------------ *
 * Seeded PRNG — mulberry32
 * ------------------------------------------------------------------ */

/** Deterministic 32-bit PRNG. Same seed ⇒ same sequence, forever. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ *
 * Contribution calendar
 * ------------------------------------------------------------------ */

const CALENDAR_SEED = 0x0c0ffee1;
const WEEKS = 52;
const DAY_MS = 86_400_000;

/** The moment this snapshot was computed. Everything below is relative to it. */
const COMPUTED_AT = '2026-07-29T06:00:00Z';

/** Midnight UTC on the day the snapshot was computed. */
const TODAY_MS = Date.UTC(2026, 6, 29);

const CURRENT_STREAK_DAYS = 23;

const CONTRIBUTION_PROJECTS = [
  'QuoteCloud',
  'TravelDocs',
  'ZeroRisk',
  'SoldOnline',
] as const;

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function levelFor(count: number): ContributionLevel {
  if (count === 0) return 0;
  if (count < 9) return 1;
  if (count < 17) return 2;
  if (count < 28) return 3;
  return 4;
}

/**
 * How many *additional* projects a day of `count` commits can carry.
 *
 * The split below guarantees the primary project keeps a strict plurality — the
 * contract says `project === byProject[0].name`, so a tie would make the mock's
 * own summary field ambiguous. That guarantee needs room: with two extras taking
 * at most 28% each, a day needs enough commits that flooring cannot collapse the
 * shares into a three-way tie. Four and eight are where that stops being a risk.
 *
 * The effect is also true to life. A three-commit Sunday is one thing being
 * poked at; a forty-commit Wednesday is a day that touched three.
 */
function extraProjectCapacity(count: number): number {
  if (count < 4) return 0;
  if (count < 8) return 1;
  return 2;
}

function buildCalendar(): ContributionWeek[] {
  const rand = mulberry32(CALENDAR_SEED);
  const projectRand = mulberry32(CALENDAR_SEED ^ 0x51a7c0de);
  /**
   * A THIRD stream, seeded independently, and that is the whole trick.
   *
   * `byProject` was added to a file whose contract is byte-identical output
   * forever. Drawing the split from `rand` or `projectRand` would have shifted
   * every subsequent draw and silently rewritten twelve months of counts and
   * labels — every `/v/*` study, every screenshot, every number anyone has ever
   * quoted off this mock. A separate generator leaves both existing streams
   * consuming exactly what they consumed before, so `date`, `count`, `level` and
   * `project` are unchanged to the byte and `byProject` is pure addition.
   */
  const splitRand = mulberry32(CALENDAR_SEED ^ 0x5b1177e5);

  const nextProjectIndex = (): number => {
    const roll = projectRand();
    if (roll < 0.4) return 0;
    if (roll < 0.66) return 1;
    if (roll < 0.84) return 2;
    return 3;
  };

  /**
   * Split one day's commits across one to three named buckets.
   *
   * Deterministic, exhaustive and ordered — the three properties the popup needs
   * to be worth rendering:
   *
   *   • The shares sum to `count` exactly, so a reader can add the popup up and
   *     get the number on the tile. (The live pipeline is allowed to fall short
   *     — GitHub counts reviews and issues as contributions, and those are not
   *     commits — but a mock that cannot even add up would be demonstrating the
   *     wrong thing.)
   *   • The primary keeps a strict plurality, so `project` stays exactly the
   *     name it was before this field existed.
   *   • Extras are distinct from the primary and from each other, drawn by
   *     rotating through the project list rather than re-rolling, because
   *     re-rolling can collide and "QuoteCloud · 4, QuoteCloud · 2" is not a
   *     thing the contract permits.
   */
  const attribute = (count: number, primaryIndex: number): ContributionProject[] => {
    if (count <= 0) return [];

    const spread = splitRand();
    const rotation = splitRand();

    const wanted = spread < 0.42 ? 0 : spread < 0.78 ? 1 : 2;
    const extras = Math.min(wanted, extraProjectCapacity(count));

    // 0–2, so `1 + ((step + i) % 3)` is 1–3: never 0 (which would collide with
    // the primary) and never repeated across the two extras.
    const step = Math.floor(rotation * 3);

    const entries: ContributionProject[] = [];
    let remaining = count;

    for (let i = 0; i < extras; i++) {
      // 10–28% of what is left, at least one commit. The ceiling is what keeps
      // the primary in front; the floor is what keeps a named project from
      // appearing with zero commits beside it.
      const share = 0.1 + splitRand() * 0.18;
      const commits = Math.max(1, Math.floor(remaining * share));
      remaining -= commits;

      const offset = 1 + ((step + i) % 3);
      entries.push({
        name: CONTRIBUTION_PROJECTS[
          (primaryIndex + offset) % CONTRIBUTION_PROJECTS.length
        ],
        commits,
      });
    }

    // Roughly one day in four with a breakdown hands its smallest slice to the
    // neutral bucket, so the popup demonstrates what the live site does with
    // work it will not name. Only ever the *last* extra: `OTHER_WORK` must never
    // lead a day, or `project` would print it as the day's headline.
    if (entries.length > 0 && splitRand() < 0.28) {
      entries[entries.length - 1] = {
        name: OTHER_WORK,
        commits: entries[entries.length - 1].commits,
      };
    }

    entries.push({ name: CONTRIBUTION_PROJECTS[primaryIndex], commits: remaining });

    // Descending by commits, ties broken by name, exactly as the contract says.
    // The primary is provably the largest, so this is a formality for the
    // extras — but the contract is a total order and a formality that is written
    // down survives someone changing the share maths.
    //
    // Codepoint comparison, never `localeCompare`: this file's whole discipline
    // is that the same import produces byte-identical output on every machine,
    // and collation is exactly the kind of thing that differs between one
    // machine's ICU build and another's.
    entries.sort(
      (a, b) => b.commits - a.commits || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    );

    return entries;
  };

  // Columns run Sunday → Saturday, so the grid ends on the Saturday of the
  // current week and reaches back exactly 52 weeks.
  const todayDow = new Date(TODAY_MS).getUTCDay();
  const lastDayMs = TODAY_MS + (6 - todayDow) * DAY_MS;
  const firstDayMs = lastDayMs - (WEEKS * 7 - 1) * DAY_MS;

  const weeks: ContributionWeek[] = [];

  for (let w = 0; w < WEEKS; w++) {
    const week: ContributionDay[] = [];

    for (let d = 0; d < 7; d++) {
      const ms = firstDayMs + (w * 7 + d) * DAY_MS;
      const isWeekend = d === 0 || d === 6;

      // Roll first regardless of the branch taken, so the PRNG stream stays
      // aligned and future days never shift the rest of the grid.
      const r = rand();
      const quiet = rand();

      let count: number;
      if (ms > TODAY_MS) {
        // Days that haven't happened yet render empty.
        count = 0;
      } else if (isWeekend) {
        // Weekends: mostly quiet, occasional deep-focus Sunday.
        count = quiet < 0.42 ? 0 : Math.floor(r * r * 13) + 1;
      } else {
        // Weekdays: consistently busy, with a long tail. Tuned so the grid
        // sums to roughly `totalContributionsYear` (public + private).
        count = quiet < 0.06 ? 0 : Math.floor(r * 40) + 5;
      }

      // One `nextProjectIndex()` call per active day, exactly as before — the
      // breakdown is derived from the same draw rather than adding one.
      const byProject = count > 0 ? attribute(count, nextProjectIndex()) : [];

      week.push({
        date: isoDate(ms),
        count,
        level: levelFor(count),
        // `byProject` is sorted, so its head IS the top project. Reading the
        // summary off the breakdown rather than tracking it separately is how
        // the two are kept from ever disagreeing.
        project: byProject[0]?.name ?? null,
        byProject,
      });
    }

    weeks.push(week);
  }

  // Keep the grid honest about `currentStreakDays`: the trailing N days up to
  // and including today must all be non-zero.
  const flat = weeks.flat();
  const todayIndex = flat.findIndex((day) => day.date === isoDate(TODAY_MS));
  const streakRand = mulberry32(CALENDAR_SEED ^ 0x5eed);

  for (let i = todayIndex; i > todayIndex - CURRENT_STREAK_DAYS && i >= 0; i--) {
    const day = flat[i];
    if (day.count === 0) {
      day.count = Math.floor(streakRand() * 6) + 1;
      day.level = levelFor(day.count);
      // Same order of operations as an ordinary day: draw the primary, split the
      // count, read the summary back off the head. A day rescued for the streak
      // is a day like any other and must not be the one that violates the
      // `project === byProject[0].name` rule.
      day.byProject = attribute(day.count, nextProjectIndex());
      day.project = day.byProject[0]?.name ?? null;
    }
  }

  return weeks;
}

const calendar: ContributionWeek[] = buildCalendar();

/* ------------------------------------------------------------------ *
 * Off the clock
 *
 * DRAFT COPY — placeholder entries. Replace with the real log once the
 * collector is wired to whatever ends up recording these.
 *
 * The first three objects are the originals and must stay first and unchanged:
 * every archived variant renders `funEntries` into a three-across grid and was
 * composed against exactly these.
 *
 * `id` is a literal, numbered per kind in the order the entries appear below —
 * `mock-beer-1`, `mock-coffee-1`, … — rather than derived from the content or
 * the position. Derived ids would move when an entry is inserted or a title is
 * reworded, and this file's whole discipline is that the same import produces
 * byte-identical output on every machine. Written ids never drift. The
 * `mock-` prefix is not load-bearing but is worth having: an id in a screenshot
 * or a React warning says out loud which source rendered the page.
 * ------------------------------------------------------------------ */

const funEntries: FunEntry[] = [
  {
    id: 'mock-beer-1',
    type: 'beer',
    title: 'Hazy Pale — Range Brewing',
    note: 'Saturday afternoon',
    daysAgo: 2,
  },
  {
    id: 'mock-coffee-1',
    type: 'coffee',
    title: 'Flat white — Single O',
    note: 'Pre-standup ritual',
    daysAgo: 0,
  },
  {
    id: 'mock-walk-1',
    type: 'walk',
    title: 'Bay Run',
    steps: 12480,
    km: 8.2,
    daysAgo: 1,
  },
  {
    id: 'mock-coffee-2',
    type: 'coffee',
    title: 'Batch brew — Sample Coffee',
    note: 'Reading the diff twice',
    daysAgo: 4,
  },
  {
    id: 'mock-walk-2',
    type: 'walk',
    title: 'Bondi to Coogee',
    steps: 14210,
    km: 9.4,
    daysAgo: 6,
  },
  {
    id: 'mock-beer-2',
    type: 'beer',
    title: 'West Coast IPA — Wayward',
    note: 'Ship-it Friday',
    daysAgo: 9,
  },
  {
    id: 'mock-coffee-3',
    type: 'coffee',
    title: 'Long black — Mecca',
    note: 'Architecture doodles on a napkin',
    daysAgo: 13,
  },
  {
    id: 'mock-walk-3',
    type: 'walk',
    title: 'Barangaroo Reserve loop',
    steps: 9060,
    km: 6.1,
    daysAgo: 18,
  },
  {
    id: 'mock-beer-3',
    type: 'beer',
    title: 'Dark Lager — Grifter',
    note: 'Release night, nothing paged',
    daysAgo: 24,
  },
  {
    id: 'mock-walk-4',
    type: 'walk',
    title: 'Manly to Spit',
    steps: 18740,
    km: 12.6,
    daysAgo: 31,
  },
  {
    id: 'mock-coffee-4',
    type: 'coffee',
    title: 'Piccolo — Toby’s Estate',
    note: 'Sunday planning session',
    daysAgo: 40,
  },
  {
    id: 'mock-walk-5',
    type: 'walk',
    title: 'Centennial Park laps',
    steps: 10320,
    km: 7.0,
    daysAgo: 52,
  },
];

/** DRAFT COPY. Pub visits — the extra kind the /fun page shows. */
const pubEntries: PubEntry[] = [
  {
    id: 'mock-pub-1',
    type: 'pub',
    title: 'The Old Fitz',
    note: 'Two pints and a whiteboard argument',
    daysAgo: 3,
  },
  {
    id: 'mock-pub-2',
    type: 'pub',
    title: 'Union Hotel, Newtown',
    note: 'Schnitzel night with the team',
    daysAgo: 17,
  },
  {
    id: 'mock-pub-3',
    type: 'pub',
    title: 'The Lord Gladstone',
    note: 'Trivia, came fourth',
    daysAgo: 38,
  },
];

/**
 * The whole off-the-clock feed, newest first. Superset of `funEntries`.
 * Sorted here rather than by a consumer so every render agrees.
 */
const funLog: FunLogEntry[] = [...funEntries, ...pubEntries].sort(
  (a, b) => a.daysAgo - b.daysAgo,
);

/* ------------------------------------------------------------------ *
 * The snapshot
 * ------------------------------------------------------------------ */

export const snapshot = {
  identity: {
    name: 'Corey Baines',
    role: 'Principal Engineer',
    company: 'Corporate Interactive',
    location: 'Sydney, Australia',
    availability: 'Open to Principal Engineer roles',
    availabilityVisible: true,
    github: 'coreybain',
    linkedin: 'https://www.linkedin.com/in/coreybaines/',
    x: 'https://x.com/coreybaines',
    email: 'corey@spiritdevs.com',
  },

  gitStats: {
    totalContributionsYear: 6434,
    privateContributions: 5792,
    publicCommits: 573,
    publicRepoCount: 14,
    totalPublicRepoCount: 47,
    currentStreakDays: CURRENT_STREAK_DAYS,
    /** 52 columns × 7 rows, Sunday-first. Feed straight into the heatmap. */
    calendar,
    languages: [
      { name: 'TypeScript', pct: 62 },
      { name: 'Swift', pct: 14 },
      { name: 'C#', pct: 12 },
      { name: 'SQL', pct: 7 },
      { name: 'Other', pct: 5 },
    ] as LanguageShare[],
  },

  aiUsage: {
    totalSessions: 1842,
    totalHours: 1210,
    agents: [
      { name: 'Claude Code', sessions: 1104 },
      { name: 'Codex', sessions: 738 },
    ] as AgentUsage[],
    topProjects: [
      { name: 'QuoteCloud', sessions: 412 },
      { name: 'TravelDocs', sessions: 308 },
      { name: 'ZeroRisk', sessions: 221 },
    ] as ProjectUsage[],
  },

  /* Archived variants do not render the phone's live HealthKit signal. Keep
     their deterministic fixture explicitly empty while widening the property
     to the same nullable contract the public site receives from Convex. */
  healthStats: null as HealthStats | null,

  /*
   * Employer work, written from the public product sites and the implementation
   * history in Corporate Interactive's private repositories. The copy separates
   * product facts from Corey's contribution and never implies sole ownership.
   */
  projects: [
    {
      slug: 'quotecloud',
      title: 'QuoteCloud',
      client: 'Corporate Interactive',
      role: 'Principal Engineer',
      summary:
        'A multi-tenant sales-document platform for creating, approving, sending and e-signing interactive quotes, proposals and contracts, with structured content, pricing and integrations across web and native apps.',
      stack: ['TypeScript', 'Next.js', 'React', 'Convex', 'Drizzle', 'Ably'],
      accent: 'hsl(212 88% 58%)',
      accentHue: 212,
      problem:
        'A sales document is more than formatted text: content, pricing, data, approvals, delivery, signing and integrations all have to agree. As the product grew, the hard problem was keeping that shared document model reliable across the editor, customer-facing viewer, PDF output and connected systems without breaking documents customers had already created.',
      approach:
        'As Principal Engineer within the Corporate Interactive team, I worked across the platform rather than owning one isolated screen. My contribution centred on the document and editor architecture, shared rendering behaviour, pricing and spreadsheet capabilities, integrations, platform migrations and the reliability work needed to evolve a long-lived product safely.',
      outcomes: [
        'A structured editor for proposals, quotes, contracts and other sales documents',
        'Interactive pricing, reusable templates, approvals and e-signing in one workflow',
        'Consistent document behaviour across editing, viewing, PDF and print surfaces',
        'Integration paths for CRM, automation and other business systems',
      ],
      body: `## What the product is

QuoteCloud is Corporate Interactive's sales-document platform. It gives teams a structured way to create proposals, quotes, contracts, reports and other customer-facing documents rather than treating each one as a collection of disconnected files. The public product includes interactive pricing, reusable content and templates, approval and e-signing workflows, delivery tracking, automation and integrations. Its editor supports richer material than ordinary text—including tables and spreadsheets, forms, diagrams, timelines, media and embedded documents—so the same document can carry the commercial detail and the presentation around it.

Behind that experience is a multi-application system. Authors work in a browser-based editor, recipients use an interactive viewer, documents can be rendered for PDF and print, and adjacent services support email, native apps and external integrations. That breadth is why the central engineering challenge is consistency: the same document has to mean the same thing everywhere it appears.

## Working as part of the team

I built QuoteCloud as part of the Corporate Interactive product team, not as a solo project. The repository history reflects a long-running product with contributions from multiple engineers and a steady flow of product, customer and support feedback. Work moved through pull requests and shared packages, with changes often crossing the editor, renderer, data model and integration surfaces at once.

My responsibility at Principal Engineer level was to help the team make those cross-cutting changes without turning every feature into a one-off. That meant establishing clearer contracts between packages, reviewing and integrating other engineers' work, planning migrations, debugging production behaviour and balancing new capability against compatibility with documents already in use.

## My role and contribution

My work has covered the block editor and its selection, drag-and-drop and toolbar behaviour; pricing, fees and spreadsheet functionality; headers, footers and document layout; embedded PDF handling; session recovery; and the shared paths that keep interactive and generated output aligned. I have also worked on platform evolution—including the Next.js application, real-time collaboration and data layers—and on connected products such as Zapier and Salesforce integrations.

The role is deliberately broad. Sometimes the highest-value contribution is an architectural change or migration; sometimes it is tracking a subtle editor interaction through several layers; and sometimes it is making an existing workflow recover cleanly when a session, network request or third-party system fails.

## What I learned

QuoteCloud taught me that a serious editor is an ecosystem, not a text box. A small interaction change can affect selection state, persistence, collaboration, rendering and export, so the durable solution usually lives in the model and contracts rather than in a local UI patch. It also reinforced that technical leadership on a mature product is largely about creating safe paths for change: making boundaries understandable, reviewing carefully, sequencing migrations and leaving the system easier for the next engineer to extend.`,
      links: { live: 'https://www.quote.cloud/' },
      aiBuildStats: { sessions: 412, hours: 271 },
    },
    {
      slug: 'traveldocs',
      title: 'TravelDocs',
      client: 'Corporate Interactive',
      role: 'Principal Engineer',
      summary:
        'A branded travel companion that brings agency itineraries, trip documents, updates and traveller communication into native iOS and Android apps with offline access.',
      stack: ['Swift', 'Kotlin', 'JavaScript', 'Node.js', 'MongoDB', 'Sabre'],
      accent: 'hsl(28 92% 56%)',
      accentHue: 28,
      problem:
        'Travel information originates in several systems and continues to change after a booking is made. Travellers need flights, hotels, transfers, documents and agency messages to remain understandable and available on a phone—even when source data is irregular, a trip is updated or connectivity disappears.',
      approach:
        'Within the Corporate Interactive team, I worked across the itinerary service and both native platforms, connecting Sabre and QuoteCloud data to traveller-facing experiences. My role combined maintaining the established delivery pipeline with modernising the iOS and Android clients, especially around persistence, synchronisation, background behaviour and native platform features.',
      outcomes: [
        'Flights, accommodation, transfers and other trip segments organised in one itinerary',
        'Agency documents and traveller uploads available alongside each trip',
        'Offline access with explicit handling for updates and removed itineraries',
        'Native notifications, messaging, widgets, Live Activities and watch experiences',
      ],
      body: `## What the product is

TravelDocs is a mobile travel companion delivered by Corporate Interactive for travel agencies and their customers. It takes itinerary data and documents supplied through QuoteCloud and connected travel systems such as Sabre, then presents them as a trip the traveller can actually use. Flights, accommodation, transfers and other segments sit alongside tickets and supporting documents, agency messages, weather, trip costs, check-in links and real-time notifications. Agencies can provide a branded experience while travellers keep important information available offline.

The product spans more than a mobile interface. A server-side itinerary pipeline receives and interprets travel data, generates or attaches documents and publishes changes to the native applications. The iOS and Android clients then have to preserve a useful local view of that trip through background updates, intermittent networks, time-zone changes and the normal lifecycle constraints of a phone.

## Working as part of the team

I worked on TravelDocs as part of the Corporate Interactive engineering team across several generations of the product. The work involved coordinating changes between the itinerary service, shared product expectations and two native clients rather than optimising one repository in isolation. Existing travel-agency workflows had to keep operating while the apps became more capable, so delivery depended on small compatible steps, careful review and feedback from the people supporting real travellers.

As Principal Engineer, I helped trace issues across those boundaries and turn them into changes the team could maintain. That included reading imperfect source data, agreeing how a state should be represented on each client, and making sure a change that looked correct online still behaved sensibly after an app restart or without a connection.

## My role and contribution

On the service side, my work included Sabre queue and agency configuration, itinerary parsing, flight and hotel segments, document generation, account and session flows, travel-safety information and operational monitoring. On the native side, I have worked deeply in the Swift application and contributed to Android, with recent iOS work covering persistence and synchronisation, document grouping, time-zone tools, deep links, app locking, attachments, weather fallbacks and handling trips that have been removed on the server.

I also developed native extensions that put timely travel information where it is most useful: widgets, Live Activities and Apple Watch experiences. Those features were not separate demos; they had to read the same trip state and degrade safely when the app or network could not refresh it.

## What I learned

TravelDocs made offline-first behaviour concrete for me. Caching a successful response is the easy part; the real work is reconciliation—knowing what changed, what was deleted, which copy is authoritative and what the traveller should see while that answer is unavailable. It also taught me to treat inconsistent dates, segments and identifiers as normal integration conditions rather than exceptional data. In travel software, time zones, background execution, notifications and deep links are core domain concerns, and reliable teams design them into the workflow from the beginning.`,
      links: { live: 'https://www.quote.cloud/traveldocs-mobile-app' },
      aiBuildStats: { sessions: 308, hours: 202 },
    },
    {
      slug: 'zerorisk',
      title: 'ZeroRisk',
      client: 'Corporate Interactive',
      role: 'Principal Engineer',
      summary:
        'A travel-safety platform that combines location-aware security and health alerts, SOS and check-in flows, traveller communication and an operator map across mobile and web.',
      stack: ['Next.js', 'Expo', 'Convex', 'PostgreSQL', 'PostGIS', 'AWS'],
      accent: 'hsl(158 72% 44%)',
      accentHue: 158,
      problem:
        'Travel-safety software has to coordinate people, locations, alerts and incidents while permissions, connectivity and device capabilities vary. A failure path is part of the safety experience: travellers need a calm way to ask for help, while operators need current, role-appropriate context without exposing another organisation\'s data.',
      approach:
        'I worked with the Corporate Interactive team across the long-running native applications and the newer shared platform. As Principal Engineer, I focused on modernising lifecycle, location, notification and security behaviour while shaping a multi-tenant web and Expo architecture with explicit authorisation, map scope and durable geospatial storage boundaries.',
      outcomes: [
        'Location-aware security and health alerts delivered to travellers',
        'SOS, check-in and emergency-information flows across native mobile apps',
        'Role-scoped operator maps for alerts, incidents, messages and device health',
        'A modern shared platform designed around tenant and spatial data boundaries',
      ],
      body: `## What the product is

ZeroRisk is a travel-security platform built by Corporate Interactive for ZeroRisk International. The public SecApp experience provides location-relevant security and health alerts, emergency assistance, check-ins, traveller tracking, learning material and current security information. Behind the traveller experience, operators need to understand where people may be affected, communicate with them and coordinate an incident without mixing data between customer organisations.

The product has a long native history and is now also represented by a modern map-first platform. The current architecture brings together a Next.js operations dashboard, a role-aware Expo application, real-time Convex workflows and durable AWS data services including PostgreSQL/PostGIS and object storage. That combination supports immediate interaction while keeping location and operational records behind explicit ownership boundaries.

## Working as part of the team

This work has been a team effort across Corporate Interactive, the customer domain and multiple application generations. I have collaborated with other engineers while responding to operational requirements that do not fit neatly into a single screen: what a traveller sees after denying location access, how an operator's scope is calculated, what happens when a push token changes, and how an emergency flow behaves when the network is poor.

My role has included helping the team modernise incrementally. The established iOS and Android products still represent real user behaviour, so the newer platform cannot be designed as if history does not exist. We have used those existing workflows to define parity, document architecture decisions and sequence the transition without losing the safety behaviours people rely on.

## My role and contribution

In the native applications, my work has included location and notification lifecycle fixes, SOS and “I'm okay” flows, emergency and embassy information, typed application state, service decomposition, push-token handling, security hardening and more recent iOS platform work such as StoreKit 2 and scene lifecycle updates. These changes often concentrated on the paths around the happy path: permission changes, background transitions, stale credentials and unavailable services.

On the current platform, I have worked across authentication and two-factor flows, tenant-aware permissions, alert authoring, map layers and scope, mobile layouts, SOS handling and real-time data hydration. I have also helped define the architectural boundaries between real-time application state and durable geospatial storage so that speed does not weaken ownership or auditability.

## What I learned

ZeroRisk taught me that reliability in safety software is a product quality, not a backend metric. The interface has to remain direct and reassuring under stress, and permissions or network failures need explicit user states rather than silent degradation. It also reinforced that multi-tenancy and map scope belong in the data model: filtering after a broad query is not an adequate security boundary. Finally, modernisation works best when the team treats the old product as evidence—preserving proven behaviour while being willing to replace the structures that made it hard to reason about.`,
      links: { live: 'https://zeroriskinternational.com/' },
      aiBuildStats: { sessions: 221, hours: 145 },
    },
    {
      slug: 'soldonline',
      title: 'SoldOnline',
      client: 'Corporate Interactive',
      role: 'Principal Engineer',
      summary:
        'An Australian online property-sales platform where agents, vendors and qualified buyers collaborate through live auctions, private treaty offers, documents and communication.',
      stack: ['React', 'Java', 'Spring', 'WebSockets', 'AWS', 'Stripe'],
      accent: 'hsl(288 70% 60%)',
      accentHue: 288,
      problem:
        'Moving a property sale online means translating more than the auction-room countdown. Buyer qualification, state-specific registration, property documents, role-based visibility, offers and counteroffers, payments, notifications and the closing state all need to stay coherent for agents, vendors and buyers.',
      approach:
        'As part of the Corporate Interactive delivery team, I worked across the React front end and established Java/Spring platform. My contribution covered the live auction experience and websocket lifecycle as well as the less visible operational workflows—property setup, team administration, permissions, offers, notifications, payments and AWS delivery—that make the public transaction possible.',
      outcomes: [
        'Online auction, private treaty and timed private treaty sale paths',
        'Live auction-room updates, bidder communication and reconnect handling',
        'Central property information, documents, registrations and notifications',
        'Role-aware workflows for agents, vendors, buyers and platform administrators',
      ],
      body: `## What the product is

SoldOnline brings the property auction room and private-treaty process into one online platform. Agents can prepare and manage a property sale, vendors can follow its progress, and qualified buyers can register, review the available information and participate from wherever they are. The product supports live auctions as well as private and timed-private-treaty offers, with property documents, communication, offers and counteroffers collected around the same transaction.

That public experience sits on top of a wider operational system. A property has agencies and team members, contacts and vendors, registration requirements, visibility rules, sale settings, notifications, payment decisions and administrative support. Live bidding is the most visible moment, but its integrity depends on all of those states being correct before the auction starts.

## Working as part of the team

I developed SoldOnline within the Corporate Interactive team alongside other engineers working in the same established platform. The repository shows a collaborative delivery model with feature branches, pull requests and frequent integration across the React application, Java services and AWS deployment work. We had to evolve existing workflows without treating the older server or the operational knowledge embedded in it as disposable.

As Principal Engineer, I worked between product behaviour and implementation detail. That meant helping the team turn real-estate rules into explicit interface states, tracing bugs across front end and server behaviour, reviewing changes, and making sure improvements to the bidder experience did not leave agents or support staff without the controls they needed.

## My role and contribution

My contribution included the auction-room interface, alerts and bidder history; shared websocket connections and dispatch behaviour; buyer registration and terms; offer and auto-bid presentation; vendor and agent visibility; mobile adjustments; property upload and configuration; team-member and administration tools; billing and payment flows; and AWS release integration. Much of that work was about making roles and transitions visible—who can see a contact, whether an auction is pending, suspended or complete, and which action is valid next.

I also spent time on the small operational details that determine whether a platform is usable in practice: clearer support paths, resilient property imagery, useful alerts, correct time handling and responsive controls during a live event.

## What I learned

SoldOnline taught me that “real time” is primarily a correctness problem. Websockets can deliver an update quickly, but the product still needs ordering, reconnection behaviour, permission checks and unambiguous state transitions. It also reinforced the importance of building the operational side with the same care as the headline experience. An elegant auction screen is not enough if an agent cannot configure the sale, a buyer cannot complete registration or support cannot understand what happened. Mature delivery means designing that whole chain with the team, not optimising the most visible screen in isolation.`,
      links: { live: 'https://soldonline.com.au/' },
      aiBuildStats: { sessions: 164, hours: 108 },
    },
    {
      slug: 'visual-editor',
      title: 'Visual Editor',
      client: 'Corporate Interactive',
      role: 'Principal Engineer',
      summary:
        'Corporate Interactive\'s multi-tenant visual CMS and website builder, combining structured page composition, content and asset management, publishing, forms, commerce and public rendering.',
      stack: [
        'Next.js',
        'React',
        'TypeScript',
        'tRPC',
        'Drizzle',
        'MySQL',
        'Zustand',
      ],
      accent: 'hsl(252 84% 62%)',
      accentHue: 252,
      problem:
        'A visual CMS has to give editors freedom without allowing the saved page to become inconsistent or unsafe. Responsive layout, reusable content, custom HTML, assets, navigation, publishing, SEO and public performance all meet in the same system, often across many customer sites and years of stored content.',
      approach:
        'Within the Corporate Interactive team, I have helped modernise the established WebDirector platform while continuing to ship editor improvements. My Principal Engineer role spans the responsive layout model, editor state and interaction, content and file tooling, caching, security and the Next.js/tRPC/Drizzle architecture that connects authenticated editing to public delivery.',
      outcomes: [
        'Structured visual page building with responsive layout controls and preview',
        'Shared content, assets, navigation, blogs, forms and commerce in one CMS',
        'Safer custom-code handling and role-aware authenticated editing',
        'Modern cacheable public rendering backed by a typed application stack',
      ],
      body: `## What the product is

Visual Editor is the editing experience within Corporate Interactive's WebDirector platform: a multi-tenant content management system and website builder for businesses that need more than a collection of static pages. Editors compose pages visually from structured rows, columns and content blocks, manage shared content and files, preview responsive layouts and publish into the same system that serves the public site. The wider product includes navigation, blogs, calendars, forms and data capture, ecommerce, SEO controls and reusable modules.

The platform has evolved over many years and currently combines a modern Next.js and React application with typed APIs, a Drizzle/MySQL data layer, AWS-backed assets and a large set of project-specific modules. That history is valuable—real sites and workflows already exist—but it also makes compatibility, performance and clear boundaries essential.

## Working as part of the team

I work on Visual Editor as part of the Corporate Interactive engineering team. Multiple engineers contribute to the editor and the surrounding CMS, so significant changes need a shared model and migration path rather than assumptions held by one person. We collaborate through reviews and integration work, and we use feedback from live customer sites to distinguish a local interaction problem from a deeper issue in layout, persistence or public rendering.

As Principal Engineer, I help connect those layers. I have been responsible for architectural direction and difficult cross-cutting work, but also for making that direction usable by the rest of the team: documenting constraints, extracting reusable behaviour, reviewing implementation choices and improving the system in increments that existing sites can absorb.

## My role and contribution

My editor work includes responsive preview and breakpoint behaviour, row sizing and full-width layouts, contextual controls, drag-and-drop state, rich-text tooling and reusable widgets. Around the editor, I have worked on file-management performance and image compression, public-shell caching, authentication and two-factor flows, route and content caching, and safer sandboxing for customer-supplied HTML.

I have also contributed to the platform's modern application structure using Next.js, tRPC, Drizzle and shared TypeScript contracts. The goal has not been a cosmetic rewrite; it has been to make authenticated editing, persistence and public rendering easier to reason about while continuing to serve the capabilities already used across customer projects.

## What I learned

Visual Editor taught me to see a page builder as a constraint and serialisation system. The visible canvas is only one projection of a structured model, and responsive preview, persistence and public output must all interpret that model consistently. It also reinforced that extensibility needs boundaries: custom content and project modules are valuable, but they need security isolation, predictable APIs and performance budgets. Most importantly, I learned that modernising a mature platform is a team discipline—progress comes from creating reliable seams where old and new code can coexist, then moving those seams deliberately.`,
      links: { live: 'https://www.webdirector.net/' },
    },
  ] as Project[],

  /**
   * Repos built for their own sake. Personal-repo scale on purpose — these are
   * side projects, not frameworks.
   *
   * ⚠️ DRAFT COPY — titles, summaries and every number in `liveStats` are
   * placeholders. `liveStats` is the slice the collector will overwrite from
   * the GitHub API; the summaries are yours to rewrite.
   */
  labs: [
    {
      slug: 'boca',
      title: 'Boca',
      summary:
        'An independent product build — the thing I work on when nobody is paying me to. Shipped in public from the first commit, agents in the loop the whole way.',
      repoFullName: 'coreybain/boca',
      language: 'TypeScript',
      liveStats: { stars: 4, forks: 0, commitsYear: 418, lastPushDaysAgo: 1 },
      featured: true,
    },
    {
      slug: 'home',
      title: 'coreybaines.com',
      summary:
        'This site. Eight full-fidelity design explorations, one shared snapshot, and a build log kept in the open — including the parts that did not work.',
      repoFullName: 'coreybain/personal-site',
      language: 'TypeScript',
      liveStats: { stars: 3, forks: 1, commitsYear: 186, lastPushDaysAgo: 0 },
      featured: true,
    },
    {
      slug: 'statline',
      title: 'statline',
      summary:
        'A small CLI that pulls contribution, repo and agent-session numbers into one deterministic JSON document. It is what feeds every number on this site.',
      repoFullName: 'coreybain/statline',
      language: 'TypeScript',
      liveStats: { stars: 11, forks: 2, commitsYear: 94, lastPushDaysAgo: 12 },
      featured: true,
    },
    {
      slug: 'pintlog',
      title: 'Pintlog',
      summary:
        'A weekend Swift app for logging what I drank and where. Genuinely useless, entirely enjoyable, and the source of the beer entries further down this site.',
      repoFullName: 'coreybain/pintlog',
      language: 'Swift',
      liveStats: { stars: 6, forks: 0, commitsYear: 128, lastPushDaysAgo: 5 },
      featured: false,
    },
  ] as Lab[],

  /**
   * The /resume page reads this instead of shipping a PDF as the source of
   * truth. `embedGitStats` tells that page to splice the live `gitStats` and
   * `aiUsage` readouts in rather than quoting numbers in prose.
   *
   * ⚠️ DRAFT COPY — every string below is placeholder prose, and the dates,
   * employers and education entries are plausible fillers, NOT Corey's real
   * history. Replace all of it before this page is published.
   */
  resumeDocument: {
    summary:
      'Principal engineer with a decade building the platforms other teams depend on — document automation, compliance, real-time auctions. I work end to end: the architecture, the delivery, and the people around both. For the last two years that has meant running agents in the loop every day, which is why the numbers on this site are measured rather than claimed.',
    experience: [
      {
        company: 'Corporate Interactive',
        title: 'Principal Engineer',
        start: '2022',
        end: 'Present',
        summary:
          'Technical lead across four production platforms, owning architecture, delivery standards and the engineering practice around them.',
        highlights: [
          'Set the architecture for four platforms serving enterprise customers',
          'Introduced agent-assisted delivery across the engineering team',
          'Mentored engineers from mid-level to senior ownership',
        ],
      },
      {
        company: 'Corporate Interactive',
        title: 'Senior Software Engineer',
        start: '2018',
        end: '2022',
        summary:
          'Built and shipped the first versions of the document and compliance platforms, moving from feature work into system ownership.',
        highlights: [
          'Shipped the first production release of the quoting platform',
          'Rebuilt the rendering pipeline behind pixel-accurate PDF output',
          'Established the testing and release process still in use',
        ],
      },
      {
        company: 'Freelance & contract',
        title: 'Full-stack Developer',
        start: '2015',
        end: '2018',
        summary:
          'Independent delivery for small teams and startups — full-stack web work, usually as the only engineer on the project.',
        highlights: [
          'Delivered end-to-end web products as sole engineer',
          'Worked directly with founders on scope and trade-offs',
          'Learned to ship small, ship often and own the consequences',
        ],
      },
    ],
    capabilities: [
      'Platform architecture and system design',
      'TypeScript, React and Next.js at production scale',
      '.NET and C# services',
      'Relational data modelling — PostgreSQL and SQL Server',
      'Real-time systems: websockets, queues, durable workflows',
      'Cloud delivery on Azure and AWS',
      'Agent-assisted engineering workflows',
      'Technical leadership, mentoring and hiring',
    ],
    education: [
      {
        institution: 'University of Technology Sydney',
        credential: 'BSc, Computer Science',
        start: '2011',
        end: '2014',
      },
    ],
    embedGitStats: true,
    /*
     * `satisfies` checks the literal against the contract; the `as` then widens
     * the *inferred* type back to `ResumeDocument`.
     *
     * Without the second half, `Snapshot['resumeDocument']['embedGitStats']` is
     * the literal type `true` rather than `boolean` — a boolean literal keeps its
     * literal type when the contextual type contains it — which makes the
     * contract unsatisfiable by any document that is not this one. A Convex row
     * with `embedGitStats: false` could not be assigned to `Snapshot`, and
     * /resume's `embedGitStats ? … : null` would have a provably dead branch.
     *
     * No runtime change: this is types only, and the rendered output is
     * byte-identical.
     */
  } satisfies ResumeDocument as ResumeDocument,

  funEntries,

  /**
   * Superset of `funEntries` for the /fun page — adds pub visits, which are
   * intentionally outside the `FunEntry` union. See `PubEntry` for why.
   */
  funLog,

  computedAt: COMPUTED_AT,
};

export type Snapshot = typeof snapshot;
export type Identity = Snapshot['identity'];
export type GitStats = Snapshot['gitStats'];
export type AiUsage = Snapshot['aiUsage'];

export default snapshot;
