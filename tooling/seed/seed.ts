#!/usr/bin/env bun
/**
 * tooling/seed/seed.ts — put the mock Snapshot into the live Convex deployment.
 *
 * The public site renders `apps/web/src/lib/snapshot.ts`, a deterministic mock.
 * The read layer in `apps/web/src/lib/data.ts` now prefers Convex and falls back
 * to that mock **per domain** — an empty table means the mock for that domain
 * only. Which means an empty deployment is indistinguishable from no deployment:
 * the switch to Convex is invisible until something is actually in there.
 *
 * This script is what makes it visible. It imports the mock, maps it into the
 * exact shapes `packages/convex/convex/schema.ts` describes, and hands the whole
 * thing to one insert-only Convex mutation.
 *
 *     bun run seed          # from tooling/seed
 *
 * ── Safety ─────────────────────────────────────────────────────────────────
 *
 * Everything destructive lives in `packages/convex/convex/seed.ts`, and there
 * isn't any: the mutation writes into a table only when that table is currently
 * empty, in one transaction, with no update or delete path. Run it as many times
 * as you like. **The admin owns this data the moment it lands** — the second run
 * is a no-op, not a refresh.
 *
 * ── How it talks to Convex ─────────────────────────────────────────────────
 *
 * `bunx convex run seed:seedAll <json> --push`, spawned with `packages/convex`
 * as its working directory so the CLI picks up `CONVEX_DEPLOYMENT` from that
 * package's `.env.local` exactly as `convex dev` does. Two details:
 *
 *   • `--push` is required, not optional. `convex run` executes the function as
 *     it exists *on the deployment*; `seed.ts` is a new module, so without a
 *     push the CLI would report `Could not find function`.
 *   • The arguments are passed through `Bun.spawn`'s argv array, never a shell
 *     string. The payload is ~40 KB of JSON containing the 52×7 contribution
 *     calendar, and shell-quoting that correctly is a problem worth not having.
 *
 * The mutation is an `internalMutation`, so it is unreachable from a browser,
 * from the iOS client, and from any `ConvexHttpClient`. The CLI can call it
 * because it authenticates with the deploy credentials.
 *
 * ── The mapping decisions ──────────────────────────────────────────────────
 *
 * The mock is not a subset of the schema; it predates it. Every place the two
 * disagree is resolved in one of three ways, and each one is marked at the field
 * with the matching tag:
 *
 *   SYNTHESISED — the schema requires a field the mock does not have, and there
 *                 is an honest value derivable from what the mock *does* have.
 *   DERIVED     — the mock stores a relative value (`daysAgo`, `lastPushDaysAgo`)
 *                 and the schema stores the durable instant behind it.
 *   SKIPPED     — the schema requires something that cannot be produced without
 *                 inventing a fact. Nothing is written; the mock fallback stands.
 */

import { snapshot as mock } from '../../apps/web/src/lib/snapshot';

/* ------------------------------------------------------------------ *
 * Time
 * ------------------------------------------------------------------ */

/**
 * The instant the whole seed is measured against.
 *
 * This is the mock's own `computedAt` (2026-07-29T06:00:00Z), taken verbatim
 * rather than replaced with "now", and that is deliberate. `computedAt` is not
 * decoration — schema.ts calls it "the instant every relative figure on the site
 * is measured against", the contribution calendar is generated ending on that
 * day, `currentStreakDays` is asserted against that grid, and
 * `apps/web/src/lib/derive.ts` computes every "N days ago" from it. Stamping a
 * fresher `computedAt` onto a calendar that ends on the 29th would produce a
 * snapshot that contradicts itself — a day of missing squares, and a streak the
 * grid does not support.
 *
 * Every DERIVED instant below is therefore an offset from this, not from the
 * wall clock.
 */
const COMPUTED_AT = mock.computedAt;
const COMPUTED_AT_MS = Date.parse(COMPUTED_AT);
const DAY_MS = 86_400_000;

/** The durable instant behind a `daysAgo`-style field. See DERIVED above. */
function daysBeforeComputedAt(days: number): string {
  return new Date(COMPUTED_AT_MS - days * DAY_MS).toISOString();
}

/* ------------------------------------------------------------------ *
 * siteSettings
 * ------------------------------------------------------------------ */

/**
 * SYNTHESISED. The mock has no `headline` — the homepage hero has the string
 * hard-coded in `components/site/Hero.tsx`, which is where this is lifted from
 * verbatim (first sentence of the lede; the second, "Everything below this line
 * is measured, not claimed", is a caption for the Signals below it rather than
 * part of the statement, and the pair together exceeds the 180-character bound
 * `siteSettings.upsert` enforces).
 *
 * Seeding it means the admin's settings form opens on the copy that is actually
 * on the page instead of an empty box.
 */
const HEADLINE =
  'I build the platforms teams depend on — document automation, ' +
  'compliance, real-time infrastructure — and I ship them with agents in the ' +
  'loop, every day.';

/**
 * SYNTHESISED. Which top-level routes exist, read off the filesystem rather than
 * guessed: `apps/web/src/app/(site)` has `work`, `labs`, `fun`, `resume` and
 * `contact` and nothing else.
 *
 * `blog: false` is ADR 018 — the blog may launch empty and a nav link to an
 * empty list is worse than no link.
 *
 * `ask: false` because there is no `/ask` route to link to: Ask Corey (ADR 015)
 * is a launcher fixed to the corner of every public page, not a nav key. The
 * field is seeded rather than dropped because it is part of `navVisibility` in
 * the schema and the seed has to write the whole object; nothing reads it.
 */
const NAV = {
  work: true,
  labs: true,
  blog: false,
  fun: true,
  resume: true,
  ask: false,
  contact: true,
};

const siteSettings = {
  headline: HEADLINE,
  // Both copies, from one input — the same invariant `siteSettings.upsert`
  // maintains. See that file's header for why the field is stored twice.
  availability: mock.identity.availability,
  identity: { ...mock.identity },
  featured: {
    /**
     * SYNTHESISED, from behaviour rather than from a field. The mock's projects
     * carry no `featured` flag, and `components/site/FeaturedWork.tsx` renders
     * `snapshot.projects` in full — so on the site as it stands today, all four
     * are featured, in mock array order. That is what is recorded here, and it
     * is the selection an editor is most likely to trim rather than rebuild.
     */
    projectSlugs: mock.projects.map((project) => project.slug),
    /** The mock's labs DO carry `featured`, so this is read, not invented. */
    labSlugs: mock.labs.filter((lab) => lab.featured).map((lab) => lab.slug),
    /** SKIPPED — no posts. See `posts` at the bottom of this file. */
    postSlugs: [],
  },
  nav: NAV,
  /**
   * "Last edit, shown in admin" — so this one genuinely is the wall clock. It
   * is the only non-deterministic value in the payload, and it is honest: the
   * settings row was in fact written now.
   */
  updatedAt: new Date().toISOString(),
};

/* ------------------------------------------------------------------ *
 * snapshot
 * ------------------------------------------------------------------ */

const snapshotRow = {
  /**
   * The denormalised copy of `siteSettings.identity` (schema.ts: settings are
   * the source of truth, this is what the phase-4 cron mirrors). Seeded from the
   * same object, so the two agree on arrival and the cron has nothing to repair.
   */
  identity: { ...mock.identity },

  /** Straight copy, calendar and all. 52 columns × 7 rows, Sunday-first. */
  gitStats: {
    totalContributionsYear: mock.gitStats.totalContributionsYear,
    privateContributions: mock.gitStats.privateContributions,
    publicCommits: mock.gitStats.publicCommits,
    publicRepoCount: mock.gitStats.publicRepoCount,
    currentStreakDays: mock.gitStats.currentStreakDays,
    calendar: mock.gitStats.calendar,
    languages: mock.gitStats.languages,
  },

  /** Straight copy. Aggregates only — there are no prompts in the mock either. */
  aiUsage: {
    totalSessions: mock.aiUsage.totalSessions,
    totalHours: mock.aiUsage.totalHours,
    agents: mock.aiUsage.agents,
    topProjects: mock.aiUsage.topProjects,
  },

  /**
   * SKIPPED, as an explicit `null`. The health pipeline depends on a phone that
   * does not exist until phase 7, and the schema is nullable rather than
   * optional precisely so the row carries the key and the life strip degrades to
   * the Fun Entry alone instead of rendering zeroes.
   */
  healthStats: null,

  /**
   * SKIPPED, as an explicit `null`, for the same reason `funEntries` is not
   * seeded at all: `funEntryFields.photo` is a required `MediaAsset` and the
   * mock's fun entries have no imagery. Copying a photo-less entry in here is
   * not possible, and inventing a photo URL is not honest.
   */
  latestFunEntry: null,

  computedAt: COMPUTED_AT,
};

/* ------------------------------------------------------------------ *
 * projects
 * ------------------------------------------------------------------ */

const projects = mock.projects.map((project, index) => ({
  /**
   * `published: true`. The mock has no publish flag because everything in it is
   * live by construction — all four render on `/work` and on the dashboard
   * today. Seeding them as drafts would make wiring the site to Convex look like
   * a regression.
   *
   * ADR 009 is satisfied, not bypassed: the gate in `projects.publish` refuses a
   * row holding a `media` asset without `sanitised: true`, and `media` here is
   * empty (see below). "Nothing unsanitised goes public" is true of a row with
   * no imagery at all.
   */
  published: true,
  /** See `siteSettings.featured.projectSlugs` — the site features all four. */
  featured: true,
  /** Mock array order, densely from 0 — the convention `projects.create` uses. */
  sortOrder: index,

  slug: project.slug,
  title: project.title,

  client: project.client,
  /**
   * SYNTHESISED, from `client`. The schema requires a credit line and the
   * glossary rule behind it (Attribution ≠ Ownership) is the reason: a case
   * study without one misrepresents who owns the work. `'Built at <client>'` is
   * schema.ts's own worked example, and every project in the mock has the same
   * employer, so this states the true relationship and nothing more.
   */
  attribution: `Built at ${project.client}`,
  role: project.role,
  /**
   * SKIPPED. `period` is optional and the mock has no engagement dates. The
   * resume says the Principal Engineer role runs 2022–Present, but attributing
   * that span to each individual platform would be a claim the mock never makes.
   */

  summary: project.summary,
  problem: project.problem,
  approach: project.approach,
  outcomes: project.outcomes,

  stack: project.stack,
  /**
   * SKIPPED — deliberately empty, and this is the ADR 009 call.
   *
   * ADR 009 says imagery is real screenshots, sanitised, and its 2026-07-30
   * amendment records that Corporate Interactive have signed off on all four
   * projects. But sign-off is permission to do the work, not the work: the
   * sanitisation pass is manual, belongs to build phase 8, and has not happened.
   * There are no screenshots in this repo to seed — `FeaturedWork.tsx` states it
   * outright ("There are no image assets, so the art is generated") and draws the
   * tiles from `accentHue` as CSS gradients.
   *
   * So there is no "seed art" to mark `sanitised: true`. The procedural art is
   * not a `MediaAsset`; it is a hue and a stylesheet, and it stays that way.
   * Writing a row with `media: [{ ..., sanitised: true }]` pointing at a
   * placeholder would put a lie in the exact field the publish gate reads.
   */
  media: [],
  /**
   * Empty. ADR 008 is why there is no `repo` key to fill in at all, and the mock
   * carries no live or press URLs.
   */
  links: {},
  accent: project.accent,
  accentHue: project.accentHue,

  /** Present on all four in the mock (ADR 016). Copied as-is. */
  aiBuildStats: project.aiBuildStats,
}));

/* ------------------------------------------------------------------ *
 * labs
 * ------------------------------------------------------------------ */

const labs = mock.labs.map((lab, index) => ({
  /** Curated in by hand (ADR 014) and all four render on `/labs` today. */
  published: true,
  /** Read from the mock, which does carry this flag. Three of four. */
  featured: lab.featured,
  sortOrder: index,

  slug: lab.slug,
  title: lab.title,
  summary: lab.summary,
  repoFullName: lab.repoFullName,
  language: lab.language,

  /**
   * SYNTHESISED, and the least comfortable field in this file — worth reading
   * before changing it.
   *
   * `labs.coverImage` is a required `MediaAsset` and the mock's `Lab` type has
   * no imagery whatsoever. Unlike `projects.media`, this cannot be left empty:
   * the schema requires the object. The options were to skip the labs table
   * entirely — losing a whole domain to keep one field honest — or to find a
   * real image that already exists for every one of these rows.
   *
   * GitHub generates an OpenGraph social card for every repository at this
   * deterministic URL. It is real, it is procedural, it contains no client
   * pixels, and it is derived from `repoFullName` rather than invented. The
   * `alt` text says exactly what the image is, so nothing is misrepresented to
   * a screen reader either.
   *
   * `sanitised` is absent, which is correct rather than an omission: schema.ts
   * scopes that flag to case-study screenshots and says it does not apply to
   * "Labs covers and Fun photos". ADR 009 is a rule about client work.
   *
   * Nothing renders this today — the `Lab` type in `apps/web/src/lib/snapshot.ts`
   * has no cover field, so the read layer drops it. It exists to satisfy the
   * schema and to give phase 8 something to replace.
   */
  coverImage: {
    kind: 'image' as const,
    url: `https://opengraph.githubassets.com/1/${lab.repoFullName}`,
    alt: `GitHub repository card for ${lab.repoFullName}`,
  },

  links: {
    /**
     * SYNTHESISED, from `repoFullName`. Required — "a Lab without a repo is a
     * Case Study" — and `owner/name` is exactly what a GitHub URL is built from,
     * so this is a spelling of a fact the mock already holds, not a new one.
     */
    repo: `https://github.com/${lab.repoFullName}`,
  },

  liveStats: {
    stars: lab.liveStats.stars,
    forks: lab.liveStats.forks,
    commitsYear: lab.liveStats.commitsYear,
    /** Kept as stored, so it and `lastPushedAt` below cannot disagree. */
    lastPushDaysAgo: lab.liveStats.lastPushDaysAgo,
    /**
     * DERIVED. The schema keeps the durable instant beside the display value
     * because the display value "silently rots if the cron stalls". The mock has
     * only the display value, and the schema itself defines what it is relative
     * to — `snapshot.computedAt` — so this is that subtraction and nothing more.
     */
    lastPushedAt: daysBeforeComputedAt(lab.liveStats.lastPushDaysAgo),
    /**
     * DERIVED. "When the cron last refreshed this block" — and the block came
     * from the same snapshot build, so it is that build's instant.
     */
    syncedAt: COMPUTED_AT,
  },
}));

/* ------------------------------------------------------------------ *
 * experienceEntries + resumeDocument
 * ------------------------------------------------------------------ */

/**
 * The mock's resume roles carry free-form period labels (`'2022'`, `'Present'`)
 * because that is what gets printed. `experienceEntries` stores machine-
 * comparable `YYYY-MM-DD` instead, since sorting and duration maths run on it,
 * and the projection turns it back into a label.
 *
 * DERIVED, and it round-trips exactly: `resume.ts`'s `periodLabel` is
 * `date.slice(0, 4)`, so `'2022-01-01'` prints as `'2022'` and a null `endDate`
 * prints as `'Present'` — byte-identical to the strings `/resume` renders from
 * the mock today. Switching that page to Convex is a data change, not a copy
 * change.
 *
 * January 1st is the honest reading of a year-only label: the mock asserts the
 * year and says nothing about the month, and boundaries that touch (Senior ends
 * `2022-01-01`, Principal starts `2022-01-01`) are exactly what "2018–2022" then
 * "2022–Present" means. `assertPeriod` only rejects `end < start`.
 */
function yearToCalendarDate(label: string): string {
  return `${label}-01-01`;
}

const experienceEntries = mock.resumeDocument.experience.map((role, index) => ({
  company: role.company,
  title: role.title,
  startDate: yearToCalendarDate(role.start),
  /** `'Present'` is the current role, which the schema stores as `null`. */
  endDate: role.end === 'Present' ? null : yearToCalendarDate(role.end),
  summary: role.summary,
  highlights: role.highlights,
  /**
   * SKIPPED, as an empty array. `skills` is required on the table and the mock's
   * roles have none. An empty list is the truthful answer — "no skills have been
   * recorded against this role" — and `projectRole` writes an empty list as an
   * *absent* key on the projection, so the rendered resume is unchanged. Reading
   * the capability list back onto individual roles would be inventing an
   * attribution the mock never makes.
   */
  skills: [] as string[],
  /** Mock array order — newest role first, which is resume order. */
  sortOrder: index,
  /**
   * SYNTHESISED, and only for the current role. Every project in the mock has
   * `role: 'Principal Engineer'` and `client: 'Corporate Interactive'`, which is
   * this entry and no other, so pointing it at all four case studies restates
   * what the mock already says rather than guessing. Omitted entirely on the
   * other two entries: an absent key means "never asked", which is true.
   */
  ...(role.title === 'Principal Engineer' && role.company === 'Corporate Interactive'
    ? { projectSlugs: mock.projects.map((project) => project.slug) }
    : {}),
}));

const resumeDocument = {
  summary: mock.resumeDocument.summary,
  /**
   * A best effort only. `resumeDocument.experience` is a projection of
   * `experienceEntries`, never authored directly, and the seed mutation replaces
   * this with the output of `rebuildResumeExperience` — the same function the
   * admin's own save path runs. It is sent anyway so the payload is a complete
   * document rather than one that depends on a later step to be valid.
   *
   * `skills` is absent here for the reason given above, matching what
   * `projectRole` would produce.
   */
  experience: mock.resumeDocument.experience.map((role) => ({
    company: role.company,
    title: role.title,
    start: role.start,
    end: role.end,
    summary: role.summary,
    highlights: role.highlights,
  })),
  capabilities: mock.resumeDocument.capabilities,
  education: mock.resumeDocument.education,
  /** ADR 012. The mock ships `true` and so does this. */
  embedGitStats: mock.resumeDocument.embedGitStats,
};

/* ------------------------------------------------------------------ *
 * Tables this script deliberately does not write
 *
 * SKIPPED — funEntries. The schema makes `photo` a required `MediaAsset`
 * ("Fun Entries are photo-first, and are why /fun has images at all"), and the
 * mock's fifteen entries have no imagery at all — `FunEntry` is a type, a title,
 * a note and a `daysAgo`. Mapping them would mean inventing a CDN URL and alt
 * text for every one. So the table is left alone, `snapshot.latestFunEntry`
 * stays `null`, and `/fun` and the life strip keep rendering from the mock via
 * the per-domain fallback in `apps/web/src/lib/data.ts`. This is the one domain
 * the seed cannot make visible, and phase 8 (real photos) is what unblocks it.
 *
 * SKIPPED — posts. The mock has no blog and ADR 018 ships `nav.blog: false`.
 * SKIPPED — contactMessages, ingestTokens, knowledgeDocs. Not content: an inbox,
 * a set of credentials, and a derived search index. Nothing to seed from a mock.
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------ */

const payload = {
  siteSettings,
  snapshot: snapshotRow,
  projects,
  labs,
  experienceEntries,
  resumeDocument,
};

/** `packages/convex`, so the CLI reads that package's `.env.local`. */
const convexDir = new URL('../../packages/convex/', import.meta.url).pathname;

type TableResult = { seeded: boolean; rows: number; alreadyPopulated: boolean };
type SeedResult = { tables: Record<string, TableResult>; notes: string[] };

console.log('Seeding Convex from apps/web/src/lib/snapshot.ts');
console.log(`  computedAt   ${COMPUTED_AT}`);
console.log(
  `  payload      ${projects.length} projects, ${labs.length} labs, ` +
    `${experienceEntries.length} experience entries, ` +
    `${snapshotRow.gitStats.calendar.length} calendar weeks`,
);
console.log('');

// argv array, not a shell string — see the header. `--push` is required because
// `seed:seedAll` is a new module and `convex run` executes deployed code.
const proc = Bun.spawn(
  [
    'bunx',
    'convex',
    'run',
    'seed:seedAll',
    JSON.stringify({ payload }),
    '--push',
  ],
  { cwd: convexDir, stdout: 'pipe', stderr: 'inherit' },
);

const stdout = await new Response(proc.stdout).text();
const status = await proc.exited;

if (status !== 0) {
  console.error(stdout);
  console.error(`\nconvex run exited ${status}. Nothing was written.`);
  process.exit(status);
}

/**
 * `convex run` prints the function's return value as JSON, but `--push` writes
 * progress above it and the Node runtime may add a warning or two. So rather
 * than assuming a prefix length, walk the `{` positions from the end backwards
 * and take the first one that parses — the return value is the last complete
 * JSON object in the stream, and it is the only one that reaches the end of it.
 */
function parseResult(output: string): SeedResult | null {
  for (let i = output.lastIndexOf('{'); i !== -1; i = output.lastIndexOf('{', i - 1)) {
    try {
      return JSON.parse(output.slice(i)) as SeedResult;
    } catch {
      // Not the start of the return value. Keep walking left.
    }
  }
  return null;
}

const result = parseResult(stdout);

if (result === null) {
  console.log(stdout);
  console.error('\nCould not parse the mutation result. Raw output above.');
  process.exit(1);
}

/* ---- summary ------------------------------------------------------- */

const width = Math.max(...Object.keys(result.tables).map((name) => name.length));

console.log('table'.padEnd(width), ' result');
console.log('-'.repeat(width), '-------');

for (const [table, outcome] of Object.entries(result.tables)) {
  const verdict = outcome.seeded
    ? `seeded  ${outcome.rows} row${outcome.rows === 1 ? '' : 's'}`
    : 'skipped — already populated, left untouched';
  console.log(table.padEnd(width), ` ${verdict}`);
}

console.log('');
for (const note of result.notes) {
  console.log(`• ${note}`);
}
