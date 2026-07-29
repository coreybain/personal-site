/**
 * snapshot.ts — the single source of truth every homepage variant reads from.
 *
 * This is MOCK data standing in for the future Convex `snapshot` row (one document,
 * recomputed on a schedule by tooling/collector). The shape here is the contract:
 * when Convex lands, this module gets swapped for a query returning the same object
 * and nothing in the variants should have to change.
 *
 * Everything is deterministic. The contribution calendar is generated at module load
 * from a seeded PRNG (never Math.random), so every import — server render, client
 * hydration, another dev's machine — produces byte-identical output.
 */

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

export type ContributionLevel = 0 | 1 | 2 | 3 | 4;

export type ContributionDay = {
  /** ISO date, `YYYY-MM-DD`, UTC. */
  date: string;
  count: number;
  level: ContributionLevel;
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
};

export type FunEntry =
  | { type: 'beer'; title: string; note: string; daysAgo: number }
  | { type: 'coffee'; title: string; note: string; daysAgo: number }
  | { type: 'walk'; title: string; steps: number; km: number; daysAgo: number };

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

function buildCalendar(): ContributionWeek[] {
  const rand = mulberry32(CALENDAR_SEED);

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

      week.push({ date: isoDate(ms), count, level: levelFor(count) });
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
    }
  }

  return weeks;
}

const calendar: ContributionWeek[] = buildCalendar();

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
    email: 'cbaines.dev@gmail.com',
  },

  gitStats: {
    totalContributionsYear: 6434,
    privateContributions: 5792,
    publicCommits: 573,
    publicRepoCount: 14,
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
    },
  ] as Project[],

  funEntries: [
    {
      type: 'beer',
      title: 'Hazy Pale — Range Brewing',
      note: 'Saturday afternoon',
      daysAgo: 2,
    },
    {
      type: 'coffee',
      title: 'Flat white — Single O',
      note: 'Pre-standup ritual',
      daysAgo: 0,
    },
    {
      type: 'walk',
      title: 'Bay Run',
      steps: 12480,
      km: 8.2,
      daysAgo: 1,
    },
  ] as FunEntry[],

  computedAt: COMPUTED_AT,
};

export type Snapshot = typeof snapshot;
export type Identity = Snapshot['identity'];
export type GitStats = Snapshot['gitStats'];
export type AiUsage = Snapshot['aiUsage'];

export default snapshot;
