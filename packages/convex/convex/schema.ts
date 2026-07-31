/**
 * schema.ts — the Convex table definitions for the whole site.
 *
 * ⚠️ THIS SCHEMA IS A MIRROR, NOT THE CONTRACT.
 *
 * `@home/types` holds the Zod schemas, and those are the authoritative shape of
 * every entity here. Convex validators cannot be derived from Zod at deploy time
 * (the CLI evaluates this file on its own runtime), so the two are kept in step
 * by hand: change the Zod schema first, then mirror it below. A field that
 * exists here and not there is a field the iOS app and the web app cannot see —
 * `packages/types` is what the Swift `Codable` generator reads.
 *
 * The mirror is field-for-field. Every table below names the Zod schema it
 * mirrors; a field added here without being added there is a field the next
 * reconciliation pass deletes.
 *
 * The other document worth reading before editing is
 * `apps/web/src/lib/snapshot.ts`. That is the mock Snapshot the site renders
 * from today; the `snapshot` table below is the row that eventually replaces
 * it. Where the mock and `@home/types` disagree, `@home/types` models the
 * superset and documents the difference at the field (search it for
 * `DIVERGENCE`) — this file follows `@home/types`, not the mock.
 *
 * ── Timestamps are ISO 8601 strings. Decided once, here is why ──────────────
 *
 * Every instant in this schema is an RFC 3339 string with a `Z` suffix
 * (`'2026-07-30T06:00:00Z'`), matching `IsoDateTimeSchema`. This file used to
 * store epoch milliseconds, which reads as the more "native" Convex choice. The
 * decision went the other way, and these are the reasons so it does not get
 * relitigated per field:
 *
 *   • One decoder. `packages/types` is the contract the generated Swift
 *     `Codable` structs are built from. ISO strings decode with a single
 *     `ISO8601DateFormatter` on iOS and `new Date(s)` in TypeScript; an epoch
 *     number needs a bespoke coding key on every date field on the Swift side.
 *   • Indexes still work. A fixed-width UTC ISO 8601 string sorts
 *     lexicographically in exactly chronological order, which is the ordering
 *     Convex's B-tree indexes provide. `by_occurredAt`, `by_status_createdAt`
 *     and `by_published_publishedAt` are unaffected by the change.
 *   • Arithmetic is rare and always at the edges. Streaks, `lastPushDaysAgo`
 *     and "2 days ago" are computed by the cron that writes the row, not by
 *     readers, so a parse is paid once per rebuild rather than once per render.
 *   • A JSON payload stays readable in a log, which matters more to the ingest
 *     endpoints than a few bytes do.
 *
 * Three things are deliberately not ISO instants:
 *   • `_creationTime`, which Convex owns and stores as epoch milliseconds.
 *     Nothing below re-declares it; `systemFieldsShape` in `@home/types`
 *     documents it as the one epoch number in the model.
 *   • Calendar dates (`contributionDay.date`, `healthDay.date`,
 *     `experienceEntries.startDate`) are `YYYY-MM-DD` labels, because the *day*
 *     is the fact — see `IsoDateSchema`.
 *   • Free-form period labels on the resume projection (`'2022'`, `'Present'`)
 *     stay strings; they are rendered verbatim and are not sortable data.
 *
 * Other conventions used throughout:
 *   • `v.union(x, v.null())` mirrors a Zod `.nullable()`, `v.optional(x)`
 *     mirrors `.optional()`, and the difference is kept because it is
 *     meaningful: a stored `null` says "computed, and there is nothing" (the
 *     health pipeline ran and had no data), while an absent key says "never
 *     written".
 *   • Convex validators are structural only. Formats that `@home/types`
 *     enforces — kebab-case slugs, `owner/name`, a 64-char hex digest, a rating
 *     of 1–5, seven days to a calendar week — are checked by the Zod schema at
 *     the mutation boundary, not here. Do not read a bare `v.string()` as
 *     "anything goes".
 *   • `_id` and `_creationTime` are added by Convex. Nothing below re-declares
 *     them, and no field name starts with an underscore.
 *   • Singletons (`snapshot`, `resumeDocument`, `siteSettings`) are tables with
 *     exactly one row. Convex has no other notion of a single document; the
 *     invariant is enforced by the mutations that write them, and readers take
 *     the newest row (see `snapshot.get`).
 *   • No table stores a `v.id()` reference to another table. Everything joins on
 *     `slug`, and the two places that need another table's data
 *     (`snapshot.latestFunEntry`, `resumeDocument.experience`) embed a
 *     projection instead. A Convex id is a Convex concept and cannot appear in
 *     `@home/types` without leaking into the Swift contract.
 */

import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

/* ------------------------------------------------------------------ *
 * Scalars
 *
 * Aliases, not new validator kinds — Convex has no date type, so these
 * are `v.string()` with a name that says *which* string. Using them
 * keeps the conventions above visible at every field that follows one.
 * ------------------------------------------------------------------ */

/** RFC 3339 instant with a `Z`, e.g. `'2026-07-30T06:00:00Z'`. `IsoDateTimeSchema`. */
const isoDateTime = v.string();

/** Calendar date, `YYYY-MM-DD`, UTC. `IsoDateSchema`. */
const isoDate = v.string();

/** Lowercase kebab-case identifier. `SlugSchema`. */
const slug = v.string();

/**
 * Short operator-chosen machine label, e.g. `'laptop'`. `MachineLabelSchema`.
 *
 * NOT a hostname and never derived from one — the length and alphabet limits in
 * `@home/types` exist to make an accidental `os.hostname()` a rejected request.
 * The Zod schema is where that is enforced; this alias is the mirror's reminder
 * that a bare `v.string()` here is not "anything goes".
 */
const machineLabel = v.string();

/* ------------------------------------------------------------------ *
 * Shared validators
 *
 * Anything used by more than one table lives here and is exported, so
 * mutation argument validators can reuse the exact same definition
 * instead of re-typing it and drifting.
 * ------------------------------------------------------------------ */

/**
 * An uploaded image or video. Mirrors `MediaAssetSchema`.
 *
 * URLs are UploadThing CDN URLs (ADR 010) — the iOS client uploads via
 * presigned URL and stores the result here, so Convex never holds the bytes.
 */
export const mediaAsset = v.object({
  kind: v.union(v.literal('image'), v.literal('video')),
  url: v.string(),
  /** Required. Every image on the site is described; there is no decorative media. */
  alt: v.string(),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  caption: v.optional(v.string()),
  /**
   * UploadThing file key. Kept so a delete can reach the CDN copy and not just
   * the row, and so iOS can request a presigned re-upload of an existing asset.
   */
  storageKey: v.optional(v.string()),
  /**
   * Whether this asset has been through the client-sanitisation pass (ADR 009).
   * The publish gate — "`sanitised: true` on every entry in `projects.media`
   * before `published` flips on" — is asserted against this field, so it has to
   * exist here for the gate to be enforceable at all. Absent where the concept
   * does not apply, i.e. Labs covers and Fun photos.
   */
  sanitised: v.optional(v.boolean()),
});

/** The four kinds of Fun Entry. Mirrors `FunEntryKindSchema`. */
export const funEntryType = v.union(
  v.literal('beer'),
  v.literal('coffee'),
  v.literal('walk'),
  v.literal('pub'),
);

/**
 * What an ingest token is allowed to do. Mirrors `IngestScopeSchema` (ADR 006a).
 *
 * Extracted out of the `ingestTokens` table in build phase 2 (backend core) so
 * `ingestTokens.issue`'s argument validator is literally the same definition as
 * the stored field — a scope added to one and not the other would otherwise be a
 * token that can be issued and never used, or used and never issued.
 */
export const ingestScope = v.union(
  v.literal('ai-usage:write'),
  v.literal('health:write'),
  v.literal('git:write'),
);

/**
 * Contact triage state. Mirrors `ContactStatusSchema`.
 *
 * Extracted in build phase 2 (backend core) for `contactMessages.setStatus`,
 * which must accept exactly the states the column stores and nothing else.
 */
export const contactStatus = v.union(
  v.literal('new'),
  v.literal('read'),
  v.literal('replied'),
  v.literal('archived'),
  v.literal('spam'),
);

/** `{ name, sessions }` — mirrors `AgentUsageSchema` and `ProjectUsageSchema`. */
const namedSessions = v.object({ name: v.string(), sessions: v.number() });

/**
 * Which agent produced a session. Mirrors `AiAgentSchema` (ADR 016).
 *
 * The machine id, never the display name: `aiUsageDays.agent` stores this and
 * `by_agent_day` indexes it, while `snapshot.aiUsage.agents[].name` carries the
 * product name the dashboard prints. `AI_AGENT_LABELS` in `@home/types` is the
 * one place the two are associated.
 *
 * Exported for the phase 4 ingest route's argument validator — the same reason
 * `ingestScope` is exported: an agent the endpoint accepts but the column cannot
 * store is a push that 200s and vanishes.
 */
export const aiAgent = v.union(v.literal('claude'), v.literal('codex'));

/**
 * One project's slice of one agent-day. Mirrors `AiUsageProjectSchema`.
 *
 * A slug, never a path. The Collector decodes Claude's path-encoded directory
 * names and Codex's `session_meta.cwd` on the machine, maps the repo to a
 * project slug, and discards the path before it builds this object — so a
 * private repo's directory name has no field to arrive in (ADR 008).
 */
const aiUsageProject = v.object({
  /** Joins to `projects.slug`. Unmapped repos are dropped by the Collector. */
  projectSlug: slug,
  sessions: v.number(),
  /** Wall-clock hours across those sessions. Fractional. */
  hours: v.number(),
});

/** Who measured a day of movement. Mirrors `HealthSourceSchema`. */
export const healthSource = v.union(
  v.literal('healthkit'),
  v.literal('manual'),
);

/** Agent effort spent building one thing (ADR 016). `AiBuildStatsSchema`. */
export const aiBuildStats = v.object({ sessions: v.number(), hours: v.number() });

/**
 * One project's slice of one day's commits. Mirrors `ContributionProjectSchema`.
 *
 * ⚠️ `name` IS A DISPLAY NAME. A case-study title (`'QuoteCloud'`), a Lab title
 * (`'statline'`), or the neutral bucket `'Other work'`. It is **never** a
 * repository identifier — not `pricing-portal-v2`, not `coreybain/boca`, not any
 * owner/name pair, public or private. ADR 008 in the one place it is easiest to
 * break: this is a producer-chosen string that lands verbatim in a public
 * tooltip, so the mapping from repo → name happens in the git cron against
 * `gitRepoMap` (below) and a repo with no entry folds into `'Other work'`
 * rather than naming itself.
 */
const contributionProject = v.object({
  /** Display name. See the warning above. */
  name: v.string(),
  /** Commits attributed to that name on that day. Always ≥ 1. */
  commits: v.number(),
});

/**
 * One cell of the GitHub contribution heatmap. Mirrors `ContributionDaySchema`.
 *
 * `level` is the 0–4 bucket the UI colours from. It is precomputed rather than
 * derived at render time so the thresholds live in one place (the cron that
 * writes this row), which is also why it is a closed union and not a number.
 */
const contributionDay = v.object({
  /** A label, not a timestamp. */
  date: isoDate,
  count: v.number(),
  level: v.union(
    v.literal(0),
    v.literal(1),
    v.literal(2),
    v.literal(3),
    v.literal(4),
  ),
  /**
   * The day's TOP project by commit count, or `null` on an inactive or
   * unattributed day — a summary of `byProject`, not a fact of its own. The
   * rule is `project ∈ { byProject[0].name, null }`: the leader's name, or
   * nothing, never a name absent from the breakdown.
   *
   * Kept alongside `byProject` because it predates it and is read by consumers
   * that will never grow a popup (the archived variants under
   * `apps/web/src/app/v/*`). ADR 008: only named, attributed projects ever
   * appear here — this string is rendered in a public tooltip.
   */
  project: v.union(v.string(), v.null()),
  /**
   * Per-project commit counts for that day — what the heatmap's day popup
   * lists. `[]` on an inactive day, and legitimately `[]` on an active one
   * whose commits could not be attributed.
   *
   * Sorted by `commits` descending (ties by `name` ascending), names unique,
   * every count ≥ 1, and `sum(commits) ≤ count` — the gap is real (GitHub's
   * `count` includes PRs, reviews and issues, which are not commits) and is
   * left unexplained rather than padded. `ContributionDaySchema` in
   * `@home/types` carries the full statement of these invariants.
   *
   * Required since the first post-attribution rebuild rewrote the whole row
   * (the calendar is derived, not authored, so there was never a backfill to
   * write — one cron pass was the migration). `mapGitStats` in
   * `apps/web/src/lib/data.ts` still tolerates `undefined` for the mock-era
   * fallback shape, which costs nothing and keeps zero-env rendering.
   */
  byProject: v.array(contributionProject),
});

/**
 * Where a Fun Entry happened. Mirrors `FunLocationSchema`.
 *
 * Coordinates are optional and only present for the entries the /fun and
 * /contact map treatments plot; the venue name alone is enough for a caption.
 */
const funLocation = v.object({
  /** Venue or route name, e.g. `'The Old Fitz'`, `'Bay Run'`. */
  name: v.string(),
  /** Suburb / locality, e.g. `'Pyrmont'`. */
  suburb: v.optional(v.string()),
  latitude: v.optional(v.number()),
  longitude: v.optional(v.number()),
});

/**
 * The fields of a Fun Entry, mirroring `FunEntrySchema`.
 *
 * Spread rather than nested, and shared, so `funEntries` and the
 * `snapshot.latestFunEntry` copy cannot drift: the Snapshot embeds a whole
 * entry, and there is exactly one definition of what a whole entry is.
 *
 * Convex has no discriminated-union table shape, so the walk-only metrics are
 * optional here and the `type === 'walk'` ⇒ `steps`/`km` implication is enforced
 * by the Zod discriminated union in `@home/types` and by the mutation.
 */
const funEntryFields = {
  type: funEntryType,
  title: v.string(),
  /** Required. Fun Entries are photo-first, and are why /fun has images at all. */
  photo: mediaAsset,
  /** Required for beer/coffee/pub in the Zod union; optional only on walks. */
  note: v.optional(v.string()),
  /** Out of 5. Beer and coffee only, in practice. */
  rating: v.optional(v.number()),
  location: v.optional(funLocation),
  /** Walk metrics. Present only when `type === 'walk'` — see above. */
  steps: v.optional(v.number()),
  km: v.optional(v.number()),
  /** When it happened — not when it was uploaded. */
  occurredAt: isoDateTime,
} as const;

/**
 * A single day of movement, as HealthKit reports it. `HealthDaySchema`.
 *
 * This is the *projection* embedded in `snapshot.healthStats`. The stored row is
 * the `healthDays` table further down, which adds `source` and `ingestedAt` and
 * spells the key `day` rather than `date`. The difference is intentional: on the
 * Snapshot this is one field of a dated sample, named the way every other dated
 * sample there is named (`contributionDay.date`, which apps/web reads by that
 * name); on a raw table it is the row's identity, and `day` makes "one row per
 * day", `by_day` and "upsert by day" the same word throughout. The rename
 * happens once, in the fold, which is already reshaping.
 */
const healthDay = v.object({
  date: isoDate,
  steps: v.number(),
  distanceKm: v.number(),
});

/**
 * Movement aggregates for the dashboard's life signal. `HealthStatsSchema`.
 *
 * The least-committal shape that renders: the latest day, a rolling average for
 * context, and the sync time so the UI can admit when the phone has been
 * offline instead of implying today had no steps.
 */
const healthStats = v.object({
  /** Most recent day the phone has reported. */
  latestDay: healthDay,
  /** Trailing-7-day mean step count, for the "typical day" comparison. */
  sevenDayAverageSteps: v.number(),
  /** Trailing-7-day totals, oldest first, for a sparkline. */
  recentDays: v.array(healthDay),
  /** When the phone last successfully posted. Stale ⇒ show it, don't fake it. */
  syncedAt: isoDateTime,
});

/**
 * Who the site is about. Mirrors `IdentitySchema`, which spreads `SocialsSchema`
 * flat rather than nesting it — the shape every archived variant under
 * `apps/web/src/app/v/*` already reads.
 *
 * Note the deliberate asymmetry in the socials: `github` is a bare username
 * because it is also an API key (the git cron and every repo URL are built from
 * it), while `linkedin` and `x` are full URLs because nothing programmatic
 * consumes them.
 */
export const identity = v.object({
  name: v.string(),
  /** Current title, e.g. `'Principal Engineer'`. */
  role: v.string(),
  company: v.string(),
  location: v.string(),
  /**
   * The hiring signal, e.g. `'Open to Principal Engineer roles'`. The single
   * most load-bearing string on the site, which is why it is editable from the
   * phone.
   */
  availability: v.string(),
  /** GitHub username, not a URL. e.g. `'coreybain'`. */
  github: v.string(),
  linkedin: v.string(),
  x: v.optional(v.string()),
  email: v.string(),
});

/**
 * Hand-picked slugs for the dashboard, in render order. Mirrors
 * `FeaturedSelectionsSchema`.
 *
 * Extracted from `siteSettings` in build phase 2 (backend core) so
 * `siteSettings.upsert` writes the exact stored shape rather than a re-typed
 * copy of it.
 */
export const featuredSelections = v.object({
  projectSlugs: v.array(slug),
  labSlugs: v.array(slug),
  postSlugs: v.array(slug),
});

/**
 * Which top-level routes appear in the nav. Mirrors `NavVisibilitySchema`.
 *
 * Enumerated rather than a `v.record()` so adding a route is a typecheck failure
 * everywhere it needs handling. `/` and `/admin` are absent on purpose: one is
 * always shown, the other never is. ADR 018: `blog` ships `false`.
 *
 * Extracted from `siteSettings` in build phase 2 (backend core), as above.
 */
export const navVisibility = v.object({
  work: v.boolean(),
  labs: v.boolean(),
  blog: v.boolean(),
  fun: v.boolean(),
  resume: v.boolean(),
  ask: v.boolean(),
  contact: v.boolean(),
});

/** One role as the resume renders it. Mirrors `ResumeRoleSchema`. */
const resumeRole = v.object({
  company: v.string(),
  title: v.string(),
  /** Free-form label, printed verbatim: `'2022'`, `'Mar 2018'`. */
  start: v.string(),
  /** `'Present'` for the current role. */
  end: v.string(),
  summary: v.string(),
  highlights: v.array(v.string()),
  /** Carried through from the source entry. Absent on older projections. */
  skills: v.optional(v.array(v.string())),
});

/** Mirrors `ResumeEducationSchema`. Free-form labels, rendered verbatim. */
const resumeEducation = v.object({
  institution: v.string(),
  credential: v.string(),
  start: v.string(),
  end: v.string(),
});

/* ------------------------------------------------------------------ *
 * Schema
 * ------------------------------------------------------------------ */

export default defineSchema({
  /**
   * The Snapshot (ADR 004) — one denormalised row holding every precomputed
   * dashboard statistic. Mirrors `SnapshotSchema`.
   *
   * The homepage reads exactly ONE document, so anything a Signal needs must be
   * copied in here by the hourly cron, not joined at request time.
   *
   * No index: a singleton is found by `.first()` on the newest row.
   */
  snapshot: defineTable({
    /**
     * Denormalised copy of `siteSettings.identity`, so the hero renders from the
     * same single read as the Signals. Treat `siteSettings` as the source of
     * truth and never edit this copy by hand.
     */
    identity,

    /** GitHub aggregates. Totals include private contributions (ADR 008). */
    gitStats: v.object({
      /** Public + private. The number the hero quotes. */
      totalContributionsYear: v.number(),
      /** The private/restricted slice of the above. A count, never names. */
      privateContributions: v.number(),
      publicCommits: v.number(),
      publicRepoCount: v.number(),
      currentStreakDays: v.number(),
      /**
       * 52 columns × 7 rows, oldest week first, Sunday-first within a week. Fed
       * straight into the heatmap. The seven-days-to-a-week invariant is a
       * `.length(7)` in `ContributionWeekSchema`; Convex cannot express it.
       */
      calendar: v.array(v.array(contributionDay)),
      /** Language mix as percentages of tracked code; sums to 100. */
      languages: v.array(v.object({ name: v.string(), pct: v.number() })),
    }),

    /**
     * Agent usage, pushed by the local Collector. Aggregates only — never
     * prompts. Folded by the hourly cron from `aiUsageDays`; this block is a
     * derived copy and is never written by the ingest route directly.
     *
     * `agents[]` and `topProjects[]` are `{ name, sessions }` — no `hours` —
     * because that is what apps/web/src/lib/snapshot.ts renders, and the
     * Snapshot holds what the site draws and nothing more (ADR 004: one document
     * read, so every unread byte is paid on every homepage render). Per-agent
     * hours stay in `aiUsageDays`; per-project hours reach the site by the other
     * route, `projects.aiBuildStats` (ADR 016).
     *
     * `name` is the display label (`'Claude Code'`), not the `aiAgent` id — the
     * fold maps one to the other through `AI_AGENT_LABELS` in `@home/types`.
     */
    aiUsage: v.object({
      totalSessions: v.number(),
      totalHours: v.number(),
      agents: v.array(namedSessions),
      /** Highest-usage projects, descending. Trimmed to a display-sized list. */
      topProjects: v.array(namedSessions),
    }),

    /**
     * HealthKit aggregates, pushed from the phone over the ingest endpoint and
     * folded by the hourly cron from `healthDays`.
     *
     * `null` until the iOS app has posted at least once — the health pipeline
     * depends on a phone that does not exist until phase 7. Nullable rather than
     * optional so the cron writes the key either way: the life signal strip must
     * degrade to the Fun Entry alone rather than render zeroes, and "absent"
     * would be indistinguishable from "the cron forgot".
     */
    healthStats: v.union(healthStats, v.null()),

    /**
     * The newest Fun Entry of any kind, copied in whole, for the life signal
     * strip. `null` before the first entry exists.
     *
     * No id back to `funEntries`: the tile links to `/fun`, which needs no id,
     * and a `v.id()` here could not be expressed in `@home/types` (see the file
     * header). The copy is rebuilt by the same cron that writes the row.
     */
    latestFunEntry: v.union(v.object(funEntryFields), v.null()),

    /**
     * When the cron built this row. Rendered as "as of …" next to the Signals,
     * and the instant every relative figure on the site (streaks,
     * `lastPushDaysAgo`, "2 days ago") is measured against — so a stalled cron
     * produces stale-but-consistent output rather than a page that contradicts
     * itself.
     */
    computedAt: isoDateTime,
  }),

  /**
   * Case Studies — client/employer work. Mirrors `ProjectSchema`.
   *
   * Always attributed, always sanitised, never repo-linked (ADR 008), which is
   * why `links` has no `repo` field.
   */
  projects: defineTable({
    /* ---- publishableShape -------------------------------------------- */
    /** Visible to the public site. Drafts are readable only through admin auth. */
    published: v.boolean(),
    /** Promoted onto the dashboard / the section's hero row. */
    featured: v.boolean(),
    sortOrder: v.number(),

    slug,
    title: v.string(),

    /* ---- attribution (glossary: Attribution ≠ Ownership) ------------- */
    /** The client or employer. Distinct from `attribution`, the credit line. */
    client: v.string(),
    /** Required credit line, e.g. `'Built at Corporate Interactive'`. */
    attribution: v.string(),
    role: v.string(),
    /**
     * Free-form engagement period, rendered verbatim, e.g. `'2022 — Present'`.
     * One string rather than a `{ start, end }` pair: it is not a date range,
     * and some of this work predates precise records.
     */
    period: v.optional(v.string()),

    /* ---- narrative --------------------------------------------------- */
    /** One or two sentences. The card copy and the meta description. */
    summary: v.string(),
    /**
     * `problem` / `approach` / `outcomes` are the structured trio
     * `/work/[slug]` actually renders, and the primary narrative in
     * `ProjectSchema`. All three are optional: eight archived variants under
     * `apps/web/src/app/v/*` read `projects` and know nothing about these
     * fields, so none of them may ever become required.
     */
    /** What was broken before. 2–3 sentences. */
    problem: v.optional(v.string()),
    /** How it was solved — architecture, delivery, the shape of the team. */
    approach: v.optional(v.string()),
    /** Short measurable result lines. Rendered as a list, never a paragraph. */
    outcomes: v.optional(v.array(v.string())),
    /** Markdown overflow for anything outside problem/approach/outcomes. */
    body: v.optional(v.string()),

    /* ---- presentation ------------------------------------------------ */
    stack: v.array(v.string()),
    /**
     * Sanitised screenshots (ADR 009). Every entry needs `sanitised: true`
     * before `published` flips on; the publish mutation asserts it.
     */
    media: v.array(mediaAsset),
    links: v.object({
      live: v.optional(v.string()),
      press: v.optional(v.string()),
    }),
    /**
     * Design tokens, not content, and required: variants derive gradients and
     * rules from them, and the procedural placeholder art depends on them for as
     * long as ADR 009 sign-off is outstanding.
     */
    accent: v.string(),
    /** The same accent as a bare HSL hue angle, so a full ramp can be derived. */
    accentHue: v.number(),

    /** Per-project agent usage (ADR 016). Absent for pre-agent work. */
    aiBuildStats: v.optional(aiBuildStats),
  })
    // Every `/work/[slug]` page is one lookup on this.
    .index('by_slug', ['slug'])
    // The listing: filter to published, already in display order.
    .index('by_published_sortOrder', ['published', 'sortOrder'])
    // ── Added in build phase 2 (backend core) ─────────────────────────────
    // The dashboard's hero row, mirroring the index `labs` already had. Both
    // sections feed the same grid, and it would be a trap for one of them to
    // reach it by index and the other by scan-and-filter.
    .index('by_published_featured', ['published', 'featured'])
    // The admin listing, which — unlike the public one — includes drafts, so it
    // cannot use `by_published_sortOrder`: that index's leading field pins
    // `published` to one value, and admin wants both in a single ordered read.
    .index('by_sortOrder', ['sortOrder']),

  /**
   * Labs — personal side projects. Mirrors `LabSchema`.
   *
   * Curated in by hand (ADR 014), always repo-linked, and augmented with live
   * GitHub numbers. `coverImage` is required on purpose: Labs and Fun Entries
   * are the site's main source of imagery outside the case studies.
   */
  labs: defineTable({
    /* ---- publishableShape -------------------------------------------- */
    published: v.boolean(),
    featured: v.boolean(),
    sortOrder: v.number(),

    slug,
    title: v.string(),
    summary: v.string(),
    /** `owner/name`, exactly as GitHub spells it. The cron's join key. */
    repoFullName: v.string(),
    /** GitHub's primary-language label for the repo. */
    language: v.string(),
    coverImage: mediaAsset,
    links: v.object({
      /** Required — a Lab without a repo is a Case Study. */
      repo: v.string(),
      live: v.optional(v.string()),
      docs: v.optional(v.string()),
    }),
    /**
     * The slice the hourly cron overwrites from the GitHub API. Everything else
     * on the row is hand-written and must survive the refresh.
     */
    liveStats: v.object({
      stars: v.number(),
      forks: v.number(),
      /** Commits in the trailing 12 months. */
      commitsYear: v.number(),
      /**
       * Days since the last push, relative to `snapshot.computedAt`. A
       * precomputed display value that silently rots if the cron stalls, which
       * is why the durable fact is stored beside it.
       */
      lastPushDaysAgo: v.number(),
      /** Absolute timestamp of that push. The durable form of the above. */
      lastPushedAt: v.optional(isoDateTime),
      /** When the cron last refreshed this block. */
      syncedAt: v.optional(isoDateTime),
    }),
  })
    .index('by_slug', ['slug'])
    // The cron resolves rows to refresh by repo, not by slug.
    .index('by_repoFullName', ['repoFullName'])
    // The /labs listing, already in display order.
    .index('by_published_sortOrder', ['published', 'sortOrder'])
    // The dashboard's hero row.
    .index('by_published_featured', ['published', 'featured'])
    // ── Added in build phase 2 (backend core) ─────────────────────────────
    // The admin listing, drafts included — see the same addition on `projects`.
    .index('by_sortOrder', ['sortOrder']),

  /**
   * Blog posts. Mirrors `PostSchema`. May launch empty (ADR 018).
   *
   * No `publishableShape`: the blog is strictly reverse-chronological, so
   * `featured` and `sortOrder` would be dead fields. Ordering is `publishedAt`.
   */
  posts: defineTable({
    slug,
    title: v.string(),
    /** One or two sentences for the index and the meta description. */
    excerpt: v.string(),
    /** Markdown. The whole post. */
    body: v.string(),
    coverImage: mediaAsset,
    tags: v.array(v.string()),
    /**
     * `null` until first published, and the sort key thereafter. Nullable rather
     * than optional so the index below sees the field on every row.
     */
    publishedAt: v.union(isoDateTime, v.null()),
    published: v.boolean(),
  })
    .index('by_slug', ['slug'])
    .index('by_published_publishedAt', ['published', 'publishedAt']),

  /**
   * Fun Entries — dated life items, photo-first, usually captured on the phone.
   * Mirrors `FunEntrySchema` via `funEntryFields`.
   */
  funEntries: defineTable(funEntryFields)
    // The `/fun` feed and the Snapshot's `latestFunEntry` both read
    // newest-first. `occurredAt` is an ISO instant, which sorts
    // lexicographically in chronological order — see the file header.
    .index('by_occurredAt', ['occurredAt'])
    // Per-kind filtering on the `/fun` page.
    .index('by_type_occurredAt', ['type', 'occurredAt']),

  /**
   * The Resume Document (ADR 012) — the single record both the web resume and
   * the PDF render from. Mirrors `ResumeDocumentSchema`. Singleton, so no index.
   *
   * `experience` is the render-ready *projection* of `experienceEntries`, not a
   * list of references: free-form period labels, newest role first, exactly the
   * text both renderers print. It is rebuilt whenever an entry changes, so the
   * page, the PDF and /about can never disagree. Do not edit it directly, and do
   * not turn it back into ids — `@home/types` cannot express a Convex id without
   * leaking it into the Swift contract.
   */
  resumeDocument: defineTable({
    /** The opening paragraph. Written once, rendered by page and PDF alike. */
    summary: v.string(),
    experience: v.array(resumeRole),
    capabilities: v.array(v.string()),
    education: v.array(resumeEducation),
    /**
     * When true, both renderers splice the live `gitStats` / `aiUsage` readouts
     * in instead of quoting stale numbers in prose. This is the ADR 012
     * differentiator; it is a flag only because a print-safe fallback has to
     * stay possible.
     */
    embedGitStats: v.boolean(),
  }),

  /**
   * One role — the normalised, admin-editable source the projection above is
   * built from. Mirrors `ExperienceEntrySchema`.
   *
   * Dates here are machine-comparable `YYYY-MM-DD`, not the resume's free-form
   * labels: sorting and duration maths both run on them.
   */
  experienceEntries: defineTable({
    company: v.string(),
    title: v.string(),
    startDate: isoDate,
    /** `null` for the current role — the projection renders that as "Present". */
    endDate: v.union(isoDate, v.null()),
    summary: v.string(),
    /** Achievement lines. Rendered as a list in both the page and the PDF. */
    highlights: v.array(v.string()),
    /** Skills exercised in this role. Feeds the resume's capability clustering. */
    skills: v.array(v.string()),
    sortOrder: v.number(),
    /**
     * Case studies covering this role's work, by slug, so the resume can point
     * at `/work/[slug]` instead of restating it.
     */
    projectSlugs: v.optional(v.array(slug)),
  })
    // Admin list order, independent of the resume's own selection.
    .index('by_sortOrder', ['sortOrder']),

  /**
   * Scoped bearer tokens for machine Ingest (ADR 006a). Mirrors
   * `IngestTokenSchema`.
   *
   * Never a user session: the HealthKit push, the AI-usage Collector and the git
   * job all authenticate with one of these, and each is independently revocable.
   * Only the hash is stored — the plaintext is shown once, at issue.
   *
   * There is no `createdAt`: a token row is inserted once and never rewritten,
   * so Convex's own `_creationTime` *is* the issue time, and a duplicate field
   * would just be a second thing to keep true.
   */
  ingestTokens: defineTable({
    /** Human label shown in admin, e.g. `'MacBook collector'`, `'iPhone 16 Pro'`. */
    name: v.string(),
    /** Lowercase hex SHA-256 of the plaintext token. Never the token itself. */
    hashedToken: v.string(),
    /**
     * One scope per pipeline, so revoking the phone does not stop the collector.
     * The `:write` suffix is not decoration — these tokens only ever push, and a
     * future read scope has to be a different string rather than a widening of
     * an existing one.
     */
    scopes: v.array(ingestScope),
    /** Last successful authenticated request. `null` if never used. */
    lastUsedAt: v.union(isoDateTime, v.null()),
    /**
     * Set to revoke, never cleared — a revoked token stays auditable. A non-null
     * value must reject every subsequent request.
     */
    revokedAt: v.union(isoDateTime, v.null()),
  })
    // Hit on every single ingest request. The one index that must exist.
    .index('by_hashedToken', ['hashedToken']),

  /* ================================================================== *
   * Raw ingest landing zones (build phase 4 — Pipelines)
   *
   * Two tables with rules the rest of the schema does not have:
   *
   *   • Written ONLY by an HTTP ingest route, authenticated with a scoped
   *     bearer token (ADR 006a). No admin mutation, no user session.
   *   • Read ONLY by the hourly cron that folds them onto the Snapshot. No
   *     page query, no iOS query, no public function returns a row from here.
   *   • Keyed by the day they describe — plus, for AI usage, by *who is
   *     claiming it* — and UPSERTED. Never appended to.
   *
   * The last one is the whole design. A push is a claim about a day, and days
   * get revised: HealthKit restates a step count once the watch syncs, the
   * Collector re-reads a session directory that has since grown, a laptop shut
   * for a week posts seven days at once. An endpoint that added to a running
   * total would double-count all three and could never correct a single day.
   * Replacing the day makes a re-send idempotent by construction, so the fold
   * always sees exactly one truth per claim and "run it again" is always safe.
   *
   * "Per claim" rather than "per day" because the two tables differ on who may
   * claim a day, and the difference is deliberate. A day has exactly one step
   * count, so `healthDays` is keyed on `day` alone and a `manual` correction is
   * *meant* to overwrite the watch. A day's agent usage, by contrast, is the sum
   * of what several computers did, and each of them may only speak for itself —
   * hence `(day, agent, machine)`. Keyed on `(day, agent)`, the second machine
   * to post silently erased the first.
   *
   * Both mirror schemas in `@home/types`/ingest.ts, which carries the longer
   * version of this reasoning.
   * ================================================================== */

  /**
   * AI usage, one row per (day, agent, machine). Mirrors `AiUsageDaySchema`.
   *
   * ── Written by ──  Pipeline 2, `POST /ingest/ai-usage`, scope
   *                   `ai-usage:write`. Producer is `tooling/collector`: a Bun
   *                   script under launchd, daily, that enumerates
   *                   `~/.claude/projects/*` and streams `~/.codex/sessions`.
   * ── Folded by ──   The hourly snapshot cron, into BOTH
   *                   `snapshot.aiUsage` (sum the table; group by `agent` for
   *                   `agents[]`; group by `projects[].projectSlug` for
   *                   `topProjects[]`, resolving each slug to its title) and
   *                   `projects.aiBuildStats` (ADR 016 — sum each project's
   *                   slices across every row).
   *
   * PRIVACY. Only counts, durations and project slugs are ever stored. There is
   * no field for a prompt, a diff, a file, a hostname or a path, and the payload
   * validator is a Zod `strictObject`, so an accidental one is a rejected
   * request rather than a silently-stripped key. Read the header of
   * `@home/types`/ingest.ts before adding anything to this table.
   *
   * `sessions`/`hours` are the agent's totals for the day and are deliberately
   * NOT constrained to equal the sum over `projects`: a session in a directory
   * with no project mapping is real activity with nowhere to land in the
   * breakdown. Totals ≥ breakdown sum, always. The fold must take the Signal
   * from the totals and the case-study numbers from the breakdown, never derive
   * one from the other.
   *
   * Size, because it decides the query strategy: two agents × 365 days × a
   * couple of computers is ~1,500 rows a year. Every fold below is a full-table
   * read summed in memory, which at that scale is correct and cheap. That is
   * also why there is no separate per-project table — it would trade a trivial
   * in-memory group-by for a second table to keep consistent.
   *
   * ── The key is a TRIPLE, and the fold must sum ─────────────────────────────
   *
   * The collector runs on more than one computer. Keyed `(day, agent)`, the
   * second machine to post a day *erased* the first — not double-counted,
   * erased, with the endpoint reporting `daysUpdated: 1` as though that were
   * correct. `machine` is the third of the key, so a push replaces only its own
   * previous claim: N machines are additive, and any machine may re-send any day
   * as often as it likes without disturbing the others.
   *
   * The consequence for every reader: a single day now has up to
   * `machines × agents` rows and they must be SUMMED. A fold that still assumes
   * one row per (day, agent) under-reports by whatever the other computers did,
   * which is the same bug the key change fixes, wearing a different hat.
   */
  aiUsageDays: defineTable({
    /** The calendar day reported, UTC. A label, not a timestamp. */
    day: isoDate,
    /** `'claude'` | `'codex'`. The agent id — see `aiAgent`. */
    agent: aiAgent,
    /**
     * Which computer reported it — the third of the upsert key. Copied from the
     * push envelope onto every row of that push.
     *
     * An operator-chosen opaque label (`'laptop'`, `'work-desktop'`), never a
     * hostname: the collector's standing promise is that it says nothing about
     * the machine it runs on, and `MachineLabelSchema` in `@home/types` is
     * narrow enough that an accidental `os.hostname()` is rejected at the HTTP
     * boundary. Nothing public reads it — the site cannot tell you how many
     * computers there are.
     *
     * ⚠️ TRANSITIONALLY OPTIONAL — promote to `machineLabel`. Required in
     * `AiUsageDaySchema`, which is the contract; optional here only because
     * Convex validates existing documents at push time and this deployment
     * holds rows written before the field existed. The sequence is the standard
     * Convex three-step and the middle step is already built:
     *
     *   1. push it optional (this commit),
     *   2. run `migrations:stampLegacyMachineLabels`, which stamps every
     *      machine-less row with `'pre-multi-machine'`,
     *   3. drop the `v.optional()` and push again.
     *
     * Step 3 landed: `stampLegacyMachineLabels` reported `remaining: 0` and
     * every writer sends the field, so the validator now enforces what the
     * ingest route already required — a writer that forgets `machine` fails
     * the compiler, not just the 400.
     */
    machine: machineLabel,
    /** Agent sessions started that day. */
    sessions: v.number(),
    /** Wall-clock hours across those sessions. Fractional. */
    hours: v.number(),
    /** Per-project breakdown. May be empty — see the totals note above. */
    projects: v.array(aiUsageProject),
    /**
     * The `postedAt` of the push that last wrote this row. Moves on a revision;
     * `_creationTime` keeps the first sighting, so "this day changed after the
     * fact" stays answerable without a second timestamp.
     */
    ingestedAt: isoDateTime,
  })
    // THE upsert key. The ingest mutation looks up (day, agent, machine) here
    // and patches, so re-posting a day replaces that machine's row instead of
    // duplicating it — or, as it used to, instead of overwriting another
    // computer's.
    //
    // A Convex index is usable from any prefix of its fields, so this one also
    // serves every read `by_day_agent` served: the fold's range read
    // `q.gte('day', windowStart)` off the `day` prefix (which is why there is no
    // separate `by_day`), and a (day, agent) lookup off the two-field prefix.
    // ⚠️ That two-field lookup now returns a *collection* — one row per machine
    // — and is no longer `.unique()`. A caller that still assumes one row will
    // throw the moment a second computer posts.
    .index('by_day_agent_machine', ['day', 'agent', 'machine'])
    // (The old two-field `by_day_agent` index is gone: it was a strict prefix
    // of the triple above, nothing names it any more, and keeping a second
    // plausible answer to "what is the upsert key?" is how the clobbering bug
    // happened in the first place.)
    //
    // The other access path: one agent's rows in day order. The Collector asks
    // "what is the newest day you already have for codex?" to decide how far
    // back to re-scan, and admin renders a per-agent time series. Neither can
    // use the index above — its leading field is `day`, so filtering by agent
    // alone would be a scan.
    //
    // Deliberately still (agent, day) and not (agent, machine, day). The
    // per-agent time series wants every machine's rows interleaved in date
    // order, which (agent, machine, day) would return grouped by machine
    // instead. A collector cursor that genuinely needs "newest day for THIS
    // machine" can read this index's `agent` prefix and filter — at ~750 rows
    // per agent that is not worth a third index.
    .index('by_agent_day', ['agent', 'day']),

  /**
   * Daily movement summaries, one row per day. Mirrors `HealthDaySummarySchema`.
   *
   * ── Written by ──  Pipeline 3, `POST /ingest/health`, scope `health:write`.
   *                   Producer is the iOS app: `HKObserverQuery` with background
   *                   delivery on step count and walking/running distance, plus
   *                   a foreground sync on app open as the fallback.
   * ── Folded by ──   The hourly snapshot cron, into `snapshot.healthStats`:
   *                   newest row → `latestDay`, trailing seven → `recentDays`,
   *                   their mean → `sevenDayAverageSteps`, newest `ingestedAt`
   *                   → `syncedAt`.
   *
   * The table lands in phase 4 with the ingest route; the phone that fills it is
   * phase 7. It will sit empty in between, which is fine and is exercised on
   * purpose — `snapshot.healthStats` is nullable precisely so the life signal
   * strip degrades to the Fun Entry alone rather than rendering zeroes.
   *
   * Steps and distance only. The iOS app requests HealthKit read scopes for
   * nothing else, and a table that cannot express heart rate is a stronger
   * guarantee than a policy promising not to ask for it.
   */
  healthDays: defineTable({
    /** The calendar day reported, UTC. The upsert key. */
    day: isoDate,
    steps: v.number(),
    /** Walking + running distance, kilometres. Fractional. */
    distanceKm: v.number(),
    /**
     * Who measured it. A `manual` backfill must stay distinguishable from a day
     * the watch actually recorded, or the numbers stop being evidence.
     */
    source: healthSource,
    /**
     * The `postedAt` of the push that last wrote this row. The newest value in
     * the table becomes `healthStats.syncedAt` — the last time the phone
     * *spoke*, which is what lets the UI say "nothing since Tuesday" instead of
     * implying Tuesday had no steps.
     */
    ingestedAt: isoDateTime,
  })
    // The upsert key, the trailing-seven range read and the newest-first
    // `latestDay` read, all from one index.
    //
    // Keyed on `day` alone, not (day, source): a day has one step count, and a
    // `manual` correction is meant to overwrite the HealthKit figure rather than
    // sit beside it and make every reader decide which one wins. There is no
    // `by_source` index for the same reason — nothing queries by source, it is
    // provenance stamped on the row.
    .index('by_day', ['day']),

  /* ================================================================== *
   * Private attribution mapping
   * ================================================================== */

  /**
   * Repository → public display name. Mirrors `GitRepoMapEntrySchema`.
   *
   * ┌───────────────────────────────────────────────────────────────────────┐
   * │ ⛔ NO PUBLIC QUERY MAY EVER EXIST FOR THIS TABLE.                     │
   * │                                                                       │
   * │ Not a filtered one. Not a redacted one. Not "just the displayNames".  │
   * │ Not one behind admin auth. Not a count. No `query()` in this package  │
   * │ may read `gitRepoMap` — only `internalQuery`/`internalMutation` and   │
   * │ the git cron's own `ctx.db` reads, whose *output* is display names.   │
   * │ It is listed in `privateTables` in `@home/types` so this is testable  │
   * │ rather than remembered.                                               │
   * └───────────────────────────────────────────────────────────────────────┘
   *
   * ── Why it exists ─────────────────────────────────────────────────────────
   *
   * The heatmap's day popup answers "which projects, and how many commits
   * each". Most of Corey's commits are in private repositories, and ADR 008 is
   * absolute that a private repo *name* never reaches a stored public field —
   * yet the named case studies (QuoteCloud, TravelDocs, ZeroRisk, SoldOnline)
   * are published, attributed work whose titles are already on the site. The
   * gap between those two facts is exactly this table: an operator states, by
   * hand, that `<some private repo>` is the thing the site already calls
   * `'QuoteCloud'`. The cron reads the mapping, emits the title, and the
   * repository identifier stops there.
   *
   * ── Why it holds the only private names in the model ──────────────────────
   *
   * Because nothing else can. Every other route was tried and rejected:
   * inferring the title from the repo name is a heuristic that leaks the tenth
   * time it guesses; storing the mapping in `projects` puts a private repo name
   * on a row with a public query; keeping it in the cron's source puts it in
   * git. A table with no query and a gitignored seed file is the one shape where
   * the name exists on the server and nowhere else.
   *
   * ── How rows get here ─────────────────────────────────────────────────────
   *
   * Seeded from a machine-local, **gitignored** JSON file — the same pattern
   * `tooling/collector` uses for its config, with a committed `.example` that
   * carries no real names. Never seeded from a committed fixture, never typed
   * into a public admin form, never logged. `tooling/privacy-check` sweeps the
   * git tree for exactly this mistake.
   *
   * ── Unmapped is not an error ──────────────────────────────────────────────
   *
   * A repository with no row here is not named: its commits fold into the
   * neutral bucket `'Other work'` (`OTHER_WORK_LABEL`). `kind: 'ignore'` is the
   * *explicit* form of the same outcome — "I have triaged this repo and it stays
   * unsurfaced" (ADR 014's junk repos) as opposed to "nobody has looked at it
   * yet". Identical behaviour, different meaning, and the difference is the
   * whole value of writing the row.
   */
  gitRepoMap: defineTable({
    /**
     * `owner/name` as GitHub spells it, **lowercased**. GitHub is
     * case-insensitive and a hand-written seed file will say `CoreyBain/Boca`
     * as often as `coreybain/boca`; the cron's existing Lab allowlist already
     * keys on the lowercase form, so this matches it.
     */
    repoFullName: v.string(),
    /**
     * The public label — a case-study or Lab title, never the repo name or a
     * derivative of it. This is the string that reaches the tooltip.
     *
     * Ignored when `kind` is `'ignore'`; keep it human anyway ("old scratch
     * repo") so the seed file explains itself to the person maintaining it.
     */
    displayName: v.string(),
    /**
     * `'project'` — a sanctioned case study; `displayName` should equal the
     * `projects` row's `title` or the site says two names for one thing.
     * `'lab'` — a curated Lab (ADR 014); mostly for the private repo a Lab is
     * built from, since a public Lab is already attributable via its own public
     * `repoFullName`. `'ignore'` — fold into `'Other work'`, silently.
     */
    kind: v.union(v.literal('project'), v.literal('lab'), v.literal('ignore')),
  })
    // The cron's only access path: it holds a repository from GitHub's response
    // and asks what, if anything, this site is allowed to call it. Seeding
    // upserts on the same key so re-running the seed is idempotent.
    .index('by_repoFullName', ['repoFullName']),

  /**
   * Knowledge base for "Ask Corey" (ADR 015) — one chunk of retrievable text per
   * row, with its embedding. Mirrors `KnowledgeDocSchema`.
   *
   * Derived, never authored: publishing a project, lab or post re-indexes its
   * rows, so a stale or orphaned row is always safe to delete and rebuild.
   */
  knowledgeDocs: defineTable({
    sourceType: v.union(
      v.literal('project'),
      v.literal('lab'),
      v.literal('post'),
      v.literal('resume'),
    ),
    /**
     * Slug of the source row; `null` for singletons (`resume`), which have no
     * slug. With `sourceType` this is the upsert key for a re-index.
     */
    sourceSlug: v.union(slug, v.null()),
    /** Display title for the citation. */
    title: v.string(),
    /**
     * Canonical on-site path to cite, e.g. `/work/quotecloud`. A path rather
     * than an absolute URL so it survives the domain cutover (ADR 017) without a
     * re-index.
     */
    url: v.string(),
    /** Chunk text, stripped of markup. What gets embedded and quoted. */
    plainText: v.string(),
    embedding: v.array(v.float64()),
    /**
     * Provider model id, e.g. `'text-embedding-3-small'`. A row whose model does
     * not match the currently configured one must be re-indexed before its
     * vector can be compared against a fresh query vector.
     */
    embeddingModel: v.string(),
    indexedAt: isoDateTime,
    /**
     * Mirrors the source row's published state. Retrieval filters on it as a
     * second line of defence: an unpublished row that reached the index must
     * still be unreachable from an answer.
     */
    published: v.boolean(),
  })
    // Reindexing is an upsert keyed on the source document.
    .index('by_source', ['sourceType', 'sourceSlug'])
    // Retrieval. 1536 dimensions = OpenAI text-embedding-3-small; changing the
    // model means changing this number AND re-embedding every row, which is what
    // `embeddingModel` above exists to make detectable.
    .vectorIndex('by_embedding', {
      vectorField: 'embedding',
      dimensions: 1536,
      filterFields: ['published', 'sourceType'],
    })
    // Keyword half of hybrid retrieval — embeddings alone miss exact terms like
    // a library name or a client name.
    .searchIndex('by_plainText', {
      searchField: 'plainText',
      filterFields: ['published', 'sourceType'],
    }),

  /**
   * Contact form submissions. Mirrors `ContactMessageSchema`. Triage state lives
   * here; the email notification is a side effect.
   */
  contactMessages: defineTable({
    name: v.string(),
    email: v.string(),
    /** A hiring manager writing from a personal address still counts. */
    company: v.optional(v.string()),
    message: v.string(),
    /**
     * `archived` is the "dealt with, keep it" state and is distinct from `spam`:
     * the admin inbox needs somewhere to put a finished conversation that is not
     * an accusation.
     */
    status: contactStatus,
    createdAt: isoDateTime,
  })
    // The admin inbox, filtered to one triage state and newest-first within it.
    .index('by_status_createdAt', ['status', 'createdAt'])
    // ── Added in build phase 2 (backend core) ─────────────────────────────
    // The index above cannot serve the inbox's default view. A Convex index is
    // usable only from its leading field, so `by_status_createdAt` orders by
    // `createdAt` *within a single status*; "everything, newest first" — which is
    // what `contactMessages.list` returns when no status filter is passed —
    // would otherwise be a full table scan sorted by `_creationTime`. That would
    // happen to look right (rows are inserted in `createdAt` order) and would
    // silently stop being right the first time a message is backfilled or
    // imported with a `createdAt` the insert order does not match.
    .index('by_createdAt', ['createdAt']),

  /**
   * Site settings — singleton. Mirrors `SiteSettingsSchema`. The editable chrome
   * around the content: what the homepage says about availability, which entries
   * are surfaced, and which nav items exist at all.
   *
   * The `identity` block here is the source of truth; `snapshot.identity` is the
   * copy the cron denormalises so the homepage still costs one document read.
   */
  siteSettings: defineTable({
    /**
     * The hero statement. Short — the dashboard exists because 548 words of
     * prose failed the five-second test.
     */
    headline: v.string(),
    /**
     * Mirrors `identity.availability`. Duplicated rather than removed because
     * the implemented shape reads it from `identity` while the plan lists it at
     * the top level of `siteSettings`; the mutation writes both, so neither
     * reader breaks. Collapse to one when apps/web stops reading
     * `snapshot.identity`.
     */
    availability: v.string(),
    /** Carries the plan's `socials`, spread flat — see `identity` above. */
    identity,
    /**
     * Hand-picked slugs for the dashboard, in render order. Duplicates the
     * per-row `featured` boolean on purpose: the boolean says "eligible", this
     * says "in this order, in this many slots". The grid has fixed dimensions to
     * hold the CLS budget, so the count matters as much as the membership.
     */
    featured: featuredSelections,
    /**
     * Which top-level routes appear in the nav. Enumerated rather than a
     * `Record<string, boolean>` so adding a route is a typecheck failure
     * everywhere it needs handling. `/` and `/admin` are absent on purpose: one
     * is always shown, the other never is.
     *
     * ADR 018: `blog` ships `false` — the blog may launch empty, and a nav link
     * to an empty list is worse than no link. The key is `blog`, matching the
     * route, rather than the section's display name.
     */
    nav: navVisibility,
    /**
     * Last edit, shown in admin. `_creationTime` cannot answer this: the
     * singleton is patched in place rather than re-inserted.
     */
    updatedAt: isoDateTime,
  }),
});
