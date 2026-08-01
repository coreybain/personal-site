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

  /*
   * ⚠️ DRAFT COPY — every `problem` / `approach` / `outcomes` string below is
   * placeholder prose written to exercise the layout, not a claim of record.
   * Corey: rewrite these in your own words (and check the numbers) before this
   * goes public. `slug`, `title`, `client`, `role`, `summary`, `stack`,
   * `accent` and `accentHue` are the original fields — leave them alone.
   */
  projects: [
    {
      slug: 'quotecloud',
      title: 'QuoteCloud',
      client: 'Corporate Interactive',
      role: 'Principal Engineer',
      summary:
        'A document automation platform that turns hours of copy-pasting into a signed proposal in minutes, generating pixel-accurate PDFs from a live block editor at enterprise scale.',
      stack: ['TypeScript', 'React', 'Node.js', '.NET', 'SQL Server', 'Azure'],
      accent: 'hsl(212 88% 58%)',
      accentHue: 212,
      problem:
        'Sales teams were assembling proposals by hand in Word, pasting pricing out of spreadsheets and emailing PDFs that were stale before they landed. A single quote took hours and no two looked alike. Nobody could tell which version a client had actually signed.',
      approach:
        'Rebuilt the quote as structured data rather than a document: a block-based editor writing to a versioned schema, with rendering split into a deterministic layout engine that emits pixel-accurate PDFs. Pricing, templates and approvals became first-class objects instead of copy-paste conventions, and every render is reproducible from its version row.',
      outcomes: [
        'Quote assembly cut from hours to minutes',
        'One rendering path for web, PDF and print',
        'Every signed document traceable to its version',
        'Template changes ship without a release',
      ],
      aiBuildStats: { sessions: 412, hours: 271 },
    },
    {
      slug: 'traveldocs',
      title: 'TravelDocs',
      client: 'Corporate Interactive',
      role: 'Principal Engineer',
      summary:
        'A travel document workflow that collapses visas, itineraries and approvals into one auditable pipeline, so operations teams stop chasing paperwork across six inboxes.',
      stack: ['TypeScript', 'Next.js', 'PostgreSQL', 'Temporal', 'Stripe'],
      accent: 'hsl(28 92% 56%)',
      accentHue: 28,
      problem:
        'Visas, itineraries and approvals lived across six inboxes and a shared drive. Operations staff spent their days chasing status by hand, and a missed document meant a traveller stuck at a border. There was no single answer to "where is this file up to".',
      approach:
        'Modelled every document as a durable workflow rather than a row with a status column, so a stalled step retries itself and every transition is recorded. Built one operations console over the top with the queue, the audit trail and the payment state in a single view.',
      outcomes: [
        'Six inboxes collapsed into one queue',
        'Full audit trail on every document',
        'Stalled steps retry without human chasing',
        'Status answerable in one screen, not a phone call',
      ],
      aiBuildStats: { sessions: 308, hours: 202 },
    },
    {
      slug: 'zerorisk',
      title: 'ZeroRisk',
      client: 'Corporate Interactive',
      role: 'Principal Engineer',
      summary:
        'A compliance and risk platform that models controls, evidence and exposure as one graph, giving boards a defensible answer instead of a spreadsheet.',
      stack: ['TypeScript', 'React', 'C#', '.NET', 'SQL Server', 'Power BI'],
      accent: 'hsl(158 72% 44%)',
      accentHue: 158,
      problem:
        'Risk reporting ran on spreadsheets that were rebuilt by hand each quarter. Controls, the evidence backing them and the exposure they mitigated lived in three unrelated places, so a board question took a week of reconciliation to answer defensibly.',
      approach:
        'Modelled controls, evidence and exposure as one connected graph with a single scoring path, so a change in evidence propagates straight through to reported exposure. Reporting reads the same model the operators work in — there is no separate quarter-end pipeline to reconcile.',
      outcomes: [
        'Quarter-end reconciliation removed entirely',
        'One scoring path from evidence to board report',
        'Every score traceable to its source evidence',
        'Reports regenerate on demand, not on a cycle',
      ],
      aiBuildStats: { sessions: 221, hours: 145 },
    },
    {
      slug: 'soldonline',
      title: 'SoldOnline',
      client: 'Corporate Interactive',
      role: 'Principal Engineer',
      summary:
        'A real-time auction platform where thousands of bidders converge on the final ten seconds and every single one of them sees the same number.',
      stack: ['TypeScript', 'Next.js', 'WebSockets', 'Redis', 'PostgreSQL', 'AWS'],
      accent: 'hsl(288 70% 60%)',
      accentHue: 288,
      problem:
        'Auction traffic is not steady — it is flat for an hour and then every bidder in the country arrives in the last ten seconds. The old polling-based system disagreed with itself under that load, and a bidder seeing a stale price is a disputed sale.',
      approach:
        'Made the bid ledger the single ordering authority and pushed state to clients over websockets from an in-memory fan-out, so every connected bidder observes the same sequence. Load-shed and reconnect behaviour were designed for the closing burst first, then the quiet hour.',
      outcomes: [
        'Same closing price on every screen, every time',
        'Closing-burst load handled without polling',
        'Reconnects resume mid-auction with no gap',
        'Disputed sales from stale prices eliminated',
      ],
      aiBuildStats: { sessions: 164, hours: 108 },
    },
    {
      slug: 'visual-editor',
      title: 'Visual Editor',
      client: 'Corporate Interactive',
      role: 'Principal Engineer',
      summary:
        'A multi-tenant visual site builder and content management platform that powers authenticated editing, project-specific page composition and public rendering from one Next.js application.',
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
      repoFullName: 'coreybain/home',
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
