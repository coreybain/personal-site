/**
 * settings.ts — `siteSettings` (singleton) and the identity block it owns.
 *
 * Everything here is copy and configuration that changes without a deploy: the
 * hero headline, the availability line, which projects sit on the dashboard, and
 * which nav entries exist at all.
 *
 * DIVERGENCE — apps/web/src/lib/snapshot.ts puts `identity` on the snapshot
 * itself. That stays true in the Convex model, but as a *copy*: `siteSettings`
 * is the editable record, and the hourly cron denormalises the identity block
 * onto the snapshot row so the homepage still costs exactly one document read.
 * Write to `siteSettings`; read from either.
 */

import * as z from 'zod';
import {
  CountSchema,
  EmailSchema,
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  SlugSchema,
  UrlSchema,
} from './primitives';

/* ------------------------------------------------------------------ *
 * Socials
 * ------------------------------------------------------------------ */

/**
 * The four public handles.
 *
 * Note the deliberate asymmetry, inherited from the implemented shape: `github`
 * is a bare username (`'coreybain'`) because it is also an API key — the git
 * cron and every repo URL are built from it — while `linkedin` and `x` are full
 * URLs because nothing programmatic ever consumes them.
 */
export const SocialsSchema = z.object({
  /** GitHub username, not a URL. e.g. `'coreybain'`. */
  github: NonEmptyStringSchema,
  linkedin: UrlSchema,
  x: UrlSchema.optional(),
  email: EmailSchema,
});
export type Socials = z.infer<typeof SocialsSchema>;

/* ------------------------------------------------------------------ *
 * Identity
 * ------------------------------------------------------------------ */

/**
 * Who the site is about. Flat rather than nested, matching the public snapshot
 * and native contract.
 */
export const IdentitySchema = z.object({
  name: NonEmptyStringSchema,
  /** Current title, e.g. `'Principal Engineer'`. */
  role: NonEmptyStringSchema,
  company: NonEmptyStringSchema,
  location: NonEmptyStringSchema,
  /**
   * The hiring signal, e.g. `'Open to Principal Engineer roles'`. The single
   * most load-bearing string on the site (see Context: the goal is landing a
   * Principal Engineer role), which is why it is editable from the phone.
   */
  availability: NonEmptyStringSchema,
  ...SocialsSchema.shape,
});
export type Identity = z.infer<typeof IdentitySchema>;

/* ------------------------------------------------------------------ *
 * Nav visibility
 * ------------------------------------------------------------------ */

/**
 * Which top-level routes appear in the nav.
 *
 * Enumerated rather than a `Record<string, boolean>` so adding a route is a
 * typecheck failure everywhere it needs handling, not a silent no-op. `/` and
 * `/admin` are absent on purpose: one is always shown, the other never is.
 *
 * ADR 018: `blog` ships `false` — the blog may launch empty and a nav link to an
 * empty list is worse than no link.
 */
export const NavVisibilitySchema = z.object({
  work: z.boolean(),
  labs: z.boolean(),
  blog: z.boolean(),
  fun: z.boolean(),
  resume: z.boolean(),
  ask: z.boolean(),
  contact: z.boolean(),
});
export type NavVisibility = z.infer<typeof NavVisibilitySchema>;

/* ------------------------------------------------------------------ *
 * Featured selections
 * ------------------------------------------------------------------ */

/**
 * Hand-picked slugs for the dashboard, in render order.
 *
 * Duplicates the per-row `featured` boolean on `projects` / `labs` on purpose:
 * the boolean says "eligible", this says "in this order, in this many slots".
 * The dashboard grid has fixed dimensions to hold the CLS budget, so the count
 * matters as much as the membership.
 */
export const FeaturedSelectionsSchema = z.object({
  projectSlugs: z.array(SlugSchema),
  labSlugs: z.array(SlugSchema),
  postSlugs: z.array(SlugSchema),
});
export type FeaturedSelections = z.infer<typeof FeaturedSelectionsSchema>;

/* ------------------------------------------------------------------ *
 * siteSettings — the singleton
 * ------------------------------------------------------------------ */

export const SiteSettingsSchema = z.object({
  /** Optimistic-concurrency token on the persisted singleton. */
  revision: CountSchema.optional(),
  /**
   * The hero statement. Short — the dashboard exists because 548 words of prose
   * failed the five-second test.
   */
  headline: NonEmptyStringSchema,
  /**
   * Mirrors `identity.availability`. Duplicated rather than removed because the
   * implemented shape reads it from `identity` while the plan lists it at the
   * top level of `siteSettings`; the mutation writes both so neither reader
   * breaks. Collapse to one when apps/web stops reading `snapshot.identity`.
   */
  availability: NonEmptyStringSchema,
  /** Whether the hiring signal is rendered on public site surfaces. */
  availabilityVisible: z.boolean().default(true),
  /**
   * Carries the plan's `socials` — `IdentitySchema` spreads `SocialsSchema` flat
   * rather than nesting it, matching the public snapshot contract.
   */
  identity: IdentitySchema,
  featured: FeaturedSelectionsSchema,
  nav: NavVisibilitySchema,
  /**
   * When the settings were last edited.
   *
   * Convex's `_creationTime` cannot stand in for this: the singleton is patched
   * in place rather than re-inserted, so its creation time is the day the site
   * was set up and never moves. Admin shows this next to the availability line —
   * the one string on the site that goes stale in a way that costs something.
   */
  updatedAt: IsoDateTimeSchema,
});
export type SiteSettings = z.infer<typeof SiteSettingsSchema>;
