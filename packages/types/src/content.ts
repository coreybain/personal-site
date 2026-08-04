/**
 * content.ts — the four admin-managed content tables: `projects`, `labs`,
 * `posts`, `funEntries`.
 *
 * These are the tables the iOS app and the browser admin both write, which is
 * why the contract lives here rather than in the Convex package: a Turbo task
 * generates Swift `Codable` structs from these schemas so the two clients cannot
 * drift apart.
 *
 * Two vocabulary rules from the glossary are enforced by shape, not convention:
 *   - A **Case Study** (`projects`) is always attributed, always sanitised, and
 *     never repo-linked (ADR 008/009). `ProjectLinksSchema` therefore has no
 *     `repo` field at all.
 *   - A **Lab** (`labs`) is curated in by hand (ADR 014) and always repo-linked.
 *     `repo` is required there.
 */

import * as z from 'zod';
import {
  CountSchema,
  HueSchema,
  IsoDateTimeSchema,
  MediaAssetSchema,
  NonEmptyStringSchema,
  NonNegativeNumberSchema,
  SlugSchema,
  UrlSchema,
  publishableShape,
} from './primitives';
import { AiBuildStatsSchema } from './stats';

/* ------------------------------------------------------------------ *
 * projects — case studies
 * ------------------------------------------------------------------ */

/**
 * Outbound links on a case study.
 *
 * Deliberately has no `repo` key: the flagship work is client-owned and private
 * (ADR 008), so there is nothing to link and no field to be tempted by. Labs
 * are where repo links live.
 */
export const ProjectLinksSchema = z.object({
  /** Public product URL, where one exists and the client is happy to be named. */
  live: UrlSchema.optional(),
  /** Press, case-study writeup, or award page hosted elsewhere. */
  press: UrlSchema.optional(),
});
export type ProjectLinks = z.infer<typeof ProjectLinksSchema>;

/**
 * A portfolio entry for client/employer work.
 *
 * DIVERGENCES from the two sources this reconciles:
 *
 *  - The plan lists a single free-form `body`. The implemented shape in
 *    apps/web/src/lib/snapshot.ts instead uses a structured trio —
 *    `problem` / `approach` / `outcomes[]` — which is what /work/[slug] renders.
 *    Both are modelled: the trio is the primary narrative, `body` is optional
 *    overflow for anything that does not fit those three headings.
 *  - `accent` / `accentHue` exist only in the implemented shape. They are design
 *    tokens, not content: public case-study art derives its gradients and rules
 *    from them. Kept required.
 *  - Everything in the case-study trio is optional because persisted records
 *    may predate any one of those fields and the renderer handles them
 *    independently.
 */
export const ProjectSchema = z.object({
  /** Optimistic-concurrency token on persisted admin documents. */
  revision: CountSchema.optional(),
  ...publishableShape,

  slug: SlugSchema,
  title: NonEmptyStringSchema,

  /* ---- attribution (glossary: Attribution ≠ Ownership) ---------------- */

  /** The client or employer. Required on every case study. */
  client: NonEmptyStringSchema,
  /**
   * The attribution line rendered on the card, e.g.
   * `'Built at Corporate Interactive — client-owned'`. Stored rather than
   * derived so wording can be agreed per client without a deploy.
   */
  attribution: NonEmptyStringSchema,
  /** Corey's role on the work, e.g. `'Principal Engineer'`. */
  role: NonEmptyStringSchema,
  /**
   * Free-form engagement period, rendered verbatim, e.g. `'2022 — Present'`.
   * Not a date range: some of this work predates precise records.
   */
  period: NonEmptyStringSchema.optional(),

  /* ---- narrative ------------------------------------------------------ */

  /** One or two sentences. The card copy and the meta description. */
  summary: NonEmptyStringSchema,
  /** What was broken before. 2–3 sentences. */
  problem: NonEmptyStringSchema.optional(),
  /** How it was solved — architecture, delivery, the shape of the team. */
  approach: NonEmptyStringSchema.optional(),
  /** Short, measurable result lines. Rendered as a list, never a paragraph. */
  outcomes: z.array(NonEmptyStringSchema).optional(),
  /** Long-form Markdown for anything outside problem/approach/outcomes. */
  body: z.string().optional(),

  /* ---- presentation --------------------------------------------------- */

  stack: z.array(NonEmptyStringSchema),
  /**
   * Sanitised screenshots (ADR 009). Every entry must have `sanitised: true`
   * before `published` flips on — the publish path asserts it, and a test
   * asserts no private repo name appears in any rendered output.
   */
  media: z.array(MediaAssetSchema),
  links: ProjectLinksSchema,
  /** A CSS colour for the project, e.g. `'hsl(212 88% 58%)'`. */
  accent: NonEmptyStringSchema,
  /** The same accent as a bare HSL hue angle, so a full ramp can be derived. */
  accentHue: HueSchema,

  /** Per-project agent effort (ADR 016). Absent where it was not measured. */
  aiBuildStats: AiBuildStatsSchema.optional(),
});
export type Project = z.infer<typeof ProjectSchema>;

/* ------------------------------------------------------------------ *
 * labs — personal side projects
 * ------------------------------------------------------------------ */

export const LabLinksSchema = z.object({
  /** `https://github.com/owner/name`. Required — a Lab without a repo is a Case Study. */
  repo: UrlSchema,
  live: UrlSchema.optional(),
  docs: UrlSchema.optional(),
});
export type LabLinks = z.infer<typeof LabLinksSchema>;

/**
 * The slice of a Lab the hourly git cron overwrites from the GitHub API.
 * Everything else on the row is hand-written and must survive the refresh.
 *
 * Numbers are personal-repo scale on purpose: a side project has three stars,
 * not three hundred.
 *
 * DIVERGENCE — apps/web/src/lib/snapshot.ts stores `lastPushDaysAgo`, which is
 * only meaningful relative to `snapshot.computedAt` and silently rots if the
 * cron stalls. Both are modelled: `lastPushedAt` is the fact, `lastPushDaysAgo`
 * is the precomputed display value the existing renderers already read.
 */
export const LabLiveStatsSchema = z.object({
  stars: CountSchema,
  forks: CountSchema,
  /** Commits in the trailing 12 months. */
  commitsYear: CountSchema,
  /** Days since the last push, relative to `snapshot.computedAt`. */
  lastPushDaysAgo: CountSchema,
  /** Absolute timestamp of that push. The durable form of the above. */
  lastPushedAt: IsoDateTimeSchema.optional(),
  /** When the cron last refreshed this block. */
  syncedAt: IsoDateTimeSchema.optional(),
});
export type LabLiveStats = z.infer<typeof LabLiveStatsSchema>;

/**
 * A repo built for its own sake — no client, no invoice.
 *
 * DIVERGENCE — `coverImage` is required here. The plan's `labs` field list omits
 * imagery, but the note beneath the data model is explicit that `labs` and
 * `funEntries` "deliberately carry photo/imagery as required fields", because
 * they are the site's main image source outside the case studies and that is the
 * complaint the whole rebuild exists to fix. apps/web/src/lib/snapshot.ts has no
 * lab imagery yet, so the mock needs a cover asset per lab before it can satisfy
 * this schema.
 */
export const LabSchema = z.object({
  /** Optimistic-concurrency token on persisted admin documents. */
  revision: CountSchema.optional(),
  ...publishableShape,

  slug: SlugSchema,
  title: NonEmptyStringSchema,
  summary: NonEmptyStringSchema,
  /** `owner/name`, exactly as GitHub spells it. The cron's lookup key. */
  repoFullName: NonEmptyStringSchema.regex(
    /^[\w.-]+\/[\w.-]+$/,
    'Expected GitHub `owner/name`',
  ),
  /** GitHub's primary-language label for the repo, e.g. `'TypeScript'`. */
  language: NonEmptyStringSchema,
  links: LabLinksSchema,
  liveStats: LabLiveStatsSchema,
  coverImage: MediaAssetSchema,
});
export type Lab = z.infer<typeof LabSchema>;

/* ------------------------------------------------------------------ *
 * posts — writing
 * ------------------------------------------------------------------ */

/**
 * A blog post. May launch with none published (ADR 018); the nav entry stays
 * hidden until there is at least one — see `SiteSettingsSchema.nav`.
 *
 * Unlike `projects` and `labs` this does not take `publishableShape`: the blog
 * is strictly reverse-chronological, so `featured` and `sortOrder` would be dead
 * fields. Ordering comes from `publishedAt`.
 */
export const PostSchema = z.object({
  /** Optimistic-concurrency token on persisted admin documents. */
  revision: CountSchema.optional(),
  slug: SlugSchema,
  title: NonEmptyStringSchema,
  /** One or two sentences for the index and the meta description. */
  excerpt: NonEmptyStringSchema,
  /** Markdown. The whole post. */
  body: NonEmptyStringSchema,
  coverImage: MediaAssetSchema,
  tags: z.array(NonEmptyStringSchema),
  /** `null` until first published, and the sort key thereafter. */
  publishedAt: IsoDateTimeSchema.nullable(),
  published: z.boolean(),
});
export type Post = z.infer<typeof PostSchema>;

/* ------------------------------------------------------------------ *
 * funEntries — off the clock
 * ------------------------------------------------------------------ */

/**
 * Where something happened. Coordinates are optional and only present for
 * entries the /fun and /contact map treatments plot; the venue name alone is
 * enough for a caption.
 */
export const FunLocationSchema = z.object({
  /** Venue or route name, e.g. `'The Old Fitz'`, `'Bay Run'`. */
  name: NonEmptyStringSchema,
  /** Suburb / locality, e.g. `'Pyrmont'`. */
  suburb: z.string().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});
export type FunLocation = z.infer<typeof FunLocationSchema>;

/** The four kinds of Fun Entry. */
export const FunEntryKindSchema = z.enum(['beer', 'coffee', 'walk', 'pub']);
export type FunEntryKind = z.infer<typeof FunEntryKindSchema>;

/**
 * Fields common to every kind.
 *
 * `photo` is required — Fun Entries are photo-first and captured from the phone
 * camera, and they are the reason the /fun grid has images at all.
 *
 * DIVERGENCE — apps/web/src/lib/snapshot.ts carries `daysAgo` instead of a
 * timestamp, and no photo. `occurredAt` is the stored fact; `daysAgo` is a
 * presentation value derived at render time against `snapshot.computedAt` and is
 * deliberately absent from this contract, so a stale snapshot cannot make an
 * entry claim to be from today.
 */
const funEntryBaseShape = {
  /** Optimistic-concurrency token on persisted admin documents. */
  revision: CountSchema.optional(),
  title: NonEmptyStringSchema,
  photo: MediaAssetSchema,
  note: NonEmptyStringSchema,
  /** Personal score out of five. Absent where it was not worth scoring. */
  rating: z.int().min(1).max(5).optional(),
  location: FunLocationSchema.optional(),
  occurredAt: IsoDateTimeSchema,
} as const;

export const BeerEntrySchema = z.object({
  ...funEntryBaseShape,
  type: z.literal('beer'),
});

export const CoffeeEntrySchema = z.object({
  ...funEntryBaseShape,
  type: z.literal('coffee'),
});

export const PubEntrySchema = z.object({
  ...funEntryBaseShape,
  type: z.literal('pub'),
});

/**
 * A walk. The only kind with metrics, because the only kind HealthKit measures —
 * these numbers arrive with the entry from the phone rather than being typed in.
 *
 * `note` is optional here (overriding the base): the distance is the point, and
 * the implemented shape in apps/web/src/lib/snapshot.ts has no note on walks.
 */
export const WalkEntrySchema = z.object({
  ...funEntryBaseShape,
  type: z.literal('walk'),
  note: NonEmptyStringSchema.optional(),
  steps: CountSchema,
  km: NonNegativeNumberSchema,
});

/**
 * One dated life item. Discriminated on `type` so a `switch` over the four kinds
 * is exhaustive at the type level.
 *
 * DIVERGENCE — apps/web/src/lib/snapshot.ts splits this in two: the homepage's
 * compact `FunEntry` signal (beer | coffee | walk) and a separate `PubEntry` for
 * the complete `/fun` log. Convex stores one table with all four kinds, which is
 * what this schema describes. The web layer narrows on read.
 */
export const FunEntrySchema = z.discriminatedUnion('type', [
  BeerEntrySchema,
  CoffeeEntrySchema,
  WalkEntrySchema,
  PubEntrySchema,
]);
export type FunEntry = z.infer<typeof FunEntrySchema>;

export type BeerEntry = z.infer<typeof BeerEntrySchema>;
export type CoffeeEntry = z.infer<typeof CoffeeEntrySchema>;
export type PubEntry = z.infer<typeof PubEntrySchema>;
export type WalkEntry = z.infer<typeof WalkEntrySchema>;
