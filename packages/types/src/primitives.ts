/**
 * primitives.ts — the small shared pieces every table schema is assembled from.
 *
 * Nothing in here maps to a Convex table on its own. These are the scalars,
 * the media/link value objects, and the two field-groups (`publishableShape`,
 * `systemFieldsShape`) that repeat across the model. Keeping them in one file
 * means a decision like "slugs are lowercase kebab-case" is made once.
 *
 * Zod is the only dependency in this package, by design: `@home/types` is
 * consumed by Next.js server + client bundles, Convex functions, a Bun CLI and
 * (via generated Swift) an iOS app. Anything heavier than Zod would leak into
 * all four.
 */

import * as z from 'zod';

/* ------------------------------------------------------------------ *
 * Scalars
 * ------------------------------------------------------------------ */

/**
 * Calendar date, `YYYY-MM-DD`, always UTC.
 *
 * Used where the *day* is the fact and the time of day is noise — the
 * contribution calendar, a daily health summary. Matches
 * `ContributionDay.date` in apps/web/src/lib/snapshot.ts.
 */
export const IsoDateSchema = z.iso.date();
export type IsoDate = z.infer<typeof IsoDateSchema>;

/**
 * Instant, RFC 3339 with a `Z` suffix (e.g. `2026-07-29T06:00:00Z`).
 *
 * Every timestamp in the model is stored as one of these rather than as a
 * Convex/JS epoch number. The iOS client decodes them with a single
 * `ISO8601DateFormatter`, and a JSON payload stays readable in a log.
 */
export const IsoDateTimeSchema = z.iso.datetime();
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;

/**
 * URL-safe identifier: lowercase kebab-case, no leading/trailing/double dashes.
 *
 * Slugs are the join key across the whole system — `projects.slug` is what the
 * AI-usage collector maps a repo path onto (see `AiUsageProjectSchema`), and
 * what `knowledgeDocs.sourceSlug` points at. They are stable and never reused.
 */
export const SlugSchema = z
  .string()
  .min(1)
  .max(96)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Expected lowercase kebab-case slug');
export type Slug = z.infer<typeof SlugSchema>;

/** Human-authored copy that must actually contain something. */
export const NonEmptyStringSchema = z.string().min(1);

/** A whole, countable, never-negative quantity: commits, stars, sessions, steps. */
export const CountSchema = z.int().nonnegative();

/** Fractional hours. `1210` and `9.4` are both legitimate values in this model. */
export const NonNegativeNumberSchema = z.number().nonnegative();

/** Share of a whole, 0–100. Callers that need a set to sum to 100 must check it. */
export const PercentageSchema = z.number().min(0).max(100);

/**
 * HSL hue angle in degrees. Carried alongside a project's CSS `accent` so the
 * design system can derive a whole ramp: `hsl(${accentHue} 90% 60%)`.
 */
export const HueSchema = z.number().min(0).max(360);

/** Manual ordering weight for admin-sortable collections. Lower sorts first. */
export const SortOrderSchema = z.int();

export const UrlSchema = z.url();
export const EmailSchema = z.email();

/* ------------------------------------------------------------------ *
 * Media
 * ------------------------------------------------------------------ */

export const MediaKindSchema = z.enum(['image', 'video']);
export type MediaKind = z.infer<typeof MediaKindSchema>;

/**
 * One uploaded asset. Images arrive via UploadThing (ADR 010), so `storageKey`
 * is UploadThing's file key — kept so a delete can reach the CDN copy, not just
 * the row.
 *
 * `width`/`height` are optional in the schema but should be populated on every
 * image: the dashboard renders at fixed dimensions to hold the CLS budget
 * (< 0.05), and intrinsic size is how it does that without a skeleton.
 */
export const MediaAssetSchema = z.object({
  url: UrlSchema,
  /** Always required. An unlabelled image is an accessibility defect. */
  alt: NonEmptyStringSchema,
  kind: MediaKindSchema,
  width: CountSchema.optional(),
  height: CountSchema.optional(),
  caption: z.string().optional(),
  /** UploadThing file key, for deletion and presigned re-upload from iOS. */
  storageKey: z.string().optional(),
  /**
   * Whether this asset has been through the client-sanitisation pass (ADR 009 —
   * real screenshots, scrubbed of customer data, pending Corporate Interactive
   * sign-off). Must be `true` before any case-study media is published; absent
   * where the concept does not apply, i.e. Labs covers and Fun photos.
   */
  sanitised: z.boolean().optional(),
});
export type MediaAsset = z.infer<typeof MediaAssetSchema>;

/* ------------------------------------------------------------------ *
 * Repeated field groups
 * ------------------------------------------------------------------ */

/**
 * The three flags every admin-managed, publicly-listed collection carries.
 *
 * Spread into a table schema rather than composed with `.extend()`, so the
 * resulting object shape stays flat and readable in editor tooltips:
 *
 *   z.object({ ...publishableShape, slug: SlugSchema, … })
 */
export const publishableShape = {
  /** Visible to the public site. Drafts are readable only through admin auth. */
  published: z.boolean(),
  /** Promoted onto the dashboard / a section's hero row. */
  featured: z.boolean(),
  sortOrder: SortOrderSchema,
} as const;

/**
 * Fields Convex adds to every document. Table schemas in this package describe
 * the document *body* — what a mutation writes — so these are kept separate;
 * spread them in when you need the shape of a document as it comes back from a
 * query.
 */
export const systemFieldsShape = {
  _id: z.string(),
  /** Convex creation time: epoch milliseconds, not an ISO string. */
  _creationTime: z.number(),
} as const;

/** Shape of the system fields alone, for the rare read-only-metadata case. */
export const SystemFieldsSchema = z.object(systemFieldsShape);
export type SystemFields = z.infer<typeof SystemFieldsSchema>;
