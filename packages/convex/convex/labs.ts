/**
 * labs.ts — the Labs table: read, write, order, publish.
 *
 * A **Lab** (glossary) is a repo built for its own sake — no client, no invoice.
 * The inverse of a Case Study in every way that matters here: it is always
 * repo-linked (`links.repo` is required — a Lab without a repo is a Case Study),
 * it is curated in by hand rather than synced from GitHub (ADR 014), and its
 * imagery needs no sanitisation because there is no client data in it.
 *
 * ── No ADR 009 gate here, and that is not an omission ─────────────────────
 *
 * `publish` below has no media assertion. ADR 009's sanitisation rule is about
 * screenshots of *client* software, and `MediaAssetSchema.sanitised` documents
 * itself as "absent where the concept does not apply, i.e. Labs covers and Fun
 * photos". `projects.publish` is the file that gates on it. Adding the same check
 * here would block publishing a Lab whose cover is a photo of a terminal, for no
 * benefit — so if a future reader is comparing the two files: the difference is
 * intentional and is the reason `sanitised` is optional in the schema.
 *
 * ── `liveStats` is the cron's field, not the form's ───────────────────────
 *
 * ⚠️ `liveStats` (stars, forks, commits, last push) is overwritten wholesale by
 * the hourly git cron in build phase 4 — see schema.ts, which calls it "the slice
 * the hourly cron overwrites from the GitHub API. Everything else on the row is
 * hand-written and must survive the refresh."
 *
 * The cron does not exist yet, so both write paths below accept the block:
 * `create` takes an optional initial value (a Lab curated in today should be able
 * to show real numbers before the next tick) and `update` can patch it (a wrong
 * star count should be fixable by hand). Once phase 4 lands, **the cron is the
 * owner**: an admin edit to `liveStats` survives only until the next hour, and
 * the admin UI should present these fields as read-only-ish rather than as
 * content. The cron's own writer belongs in this file as an `internalMutation`
 * (`refreshLiveStats`, keyed on `repoFullName` via `by_repoFullName`) so that the
 * GitHub-shaped write and the hand-shaped write share one validator.
 *
 * `repoFullName` uniqueness is enforced here for the cron's benefit: two rows
 * naming one repo would both be refreshed from it, and the second would look like
 * a bug in the pipeline rather than a duplicate in the data.
 */

import type { GenericDatabaseReader } from 'convex/server';
import { v } from 'convex/values';
import type { DataModel, Doc, Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import { requireAdmin } from './lib/auth';
import {
  assertRange,
  assertSlugUnique,
  assertText,
  assertUrl,
  invalid,
} from './lib/validate';
import { mediaAsset } from './schema';

/* ------------------------------------------------------------------ *
 * Validators the schema does not export
 *
 * `labs.links` and `labs.liveStats` are declared inline in schema.ts
 * and have no exported names, and this file may not edit schema.ts.
 * They are mirrored here field for field — a field added there and not
 * here is a field no client can write.
 * ------------------------------------------------------------------ */

/** Mirrors `labs.links` / `LabLinksSchema`. `repo` is required — see the header. */
const labLinks = v.object({
  repo: v.string(),
  live: v.optional(v.string()),
  docs: v.optional(v.string()),
});

/** Mirrors `labs.liveStats` / `LabLiveStatsSchema`. The cron's slice. */
const labLiveStats = v.object({
  stars: v.number(),
  forks: v.number(),
  commitsYear: v.number(),
  lastPushDaysAgo: v.number(),
  lastPushedAt: v.optional(v.string()),
  syncedAt: v.optional(v.string()),
});

/* ------------------------------------------------------------------ *
 * Bounds and formats — hand-mirrored from `LabSchema` in @home/types
 * ------------------------------------------------------------------ */

const MAX_TITLE = 160;
/** Card copy and the meta description. */
const MAX_SUMMARY = 400;
/** `owner/name`. GitHub's own limits are 39 + 100 characters. */
const MAX_REPO_FULL_NAME = 140;
const MAX_LANGUAGE = 60;
const MAX_ALT = 300;
const MAX_CAPTION = 300;
const MAX_STORAGE_KEY = 256;
/** Intrinsic pixel dimension ceiling — a sanity bound, not a format rule. */
const MAX_PIXELS = 20_000;

/**
 * `LabSchema.repoFullName`: `owner/name`, exactly as GitHub spells it.
 *
 * Mirrored from the Zod `.regex()` rather than loosened: this string is the
 * cron's lookup key and is interpolated straight into a GitHub API path, so a
 * value with a space, a second slash or a leading `https://` produces a 404 an
 * hour later rather than an error now.
 */
const REPO_FULL_NAME_PATTERN = /^[\w.-]+\/[\w.-]+$/;

/**
 * `IsoDateTimeSchema`, near enough to catch a wrong format.
 *
 * The two optional timestamps in `liveStats` are the only instants a client may
 * write in this file, and they must be RFC 3339 with a `Z` — every timestamp in
 * the model is (see schema.ts's header), and the fixed-width property is what
 * makes ISO strings sort chronologically in an index. Anything else stored here
 * would render as "Invalid Date" on the site rather than fail on the way in.
 */
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

/* ------------------------------------------------------------------ *
 * Field types
 * ------------------------------------------------------------------ */

/**
 * The document body — derived from the generated data model rather than
 * re-typed, so a schema change this file has not caught up with is a typecheck
 * failure here.
 */
type LabFields = Omit<Doc<'labs'>, '_id' | '_creationTime'>;

/** One media asset as stored. Same shape as `mediaAsset` in schema.ts. */
type LabMedia = LabFields['coverImage'];

/**
 * A patch: every writable field, all optional, minus `published`.
 *
 * `published` is excluded at the type level for the same reason as in
 * projects.ts — `publish` and `unpublish` are its only writers, so that the
 * publish path stays a single, auditable place even though this table has no
 * gate to enforce there today.
 */
type LabPatch = Partial<Omit<LabFields, 'published'>>;

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

/**
 * Assert a whole, non-negative quantity. Mirrors `CountSchema` (`z.int()`).
 *
 * Every number in `liveStats` is a count of something real (stars, forks,
 * commits, days), so a fraction or a negative is a bug in whatever produced it —
 * which, from phase 4 onwards, is a GitHub API response being reshaped.
 */
function assertCount(value: number, field: string, max: number): void {
  assertRange(value, field, 0, max);
  if (!Number.isInteger(value)) {
    invalid({
      code: 'invalid-format',
      field,
      message: `${field} must be a whole number (got ${value}).`,
    });
  }
}

/** Assert an RFC 3339 UTC instant, per `ISO_INSTANT_PATTERN`. */
function assertIsoInstant(value: string, field: string): void {
  if (!ISO_INSTANT_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    invalid({
      code: 'invalid-format',
      field,
      message: `${field} must be an RFC 3339 UTC instant like '2026-07-30T06:00:00Z' (got ${JSON.stringify(value)}).`,
    });
  }
}

/**
 * Assert one media asset is well-formed.
 *
 * Duplicated from projects.ts rather than shared, because that file and this one
 * are the only two that need it today and neither may edit `lib/`. When a third
 * table's mutations want it (posts' and funEntries' imagery), this is the
 * function to lift into `lib/media.ts` — with the note that `sanitised` is
 * asserted only by `projects.publish`, and only there.
 */
function assertMediaAsset(asset: LabMedia, field: string): void {
  assertUrl(asset.url, `${field}.url`);
  assertText(asset.alt, `${field}.alt`, MAX_ALT);

  if (asset.caption !== undefined && asset.caption.length > MAX_CAPTION) {
    invalid({
      code: 'out-of-range',
      field: `${field}.caption`,
      message: `caption must be ${MAX_CAPTION} characters or fewer.`,
    });
  }
  if (asset.width !== undefined) {
    assertRange(asset.width, `${field}.width`, 1, MAX_PIXELS);
  }
  if (asset.height !== undefined) {
    assertRange(asset.height, `${field}.height`, 1, MAX_PIXELS);
  }
  if (asset.storageKey !== undefined) {
    assertText(asset.storageKey, `${field}.storageKey`, MAX_STORAGE_KEY);
  }
}

/**
 * Assert every field present in `fields` satisfies `LabSchema`'s formats.
 *
 * A partial, so `create` (whole document) and `update` (the keys it was given)
 * share one set of rules. `slug` is validated by `assertSlugUnique`, and the
 * `repoFullName` ↔ `links.repo` agreement check needs both fields' *effective*
 * values, so it lives in the mutations instead.
 */
function assertLabFields(fields: Partial<LabFields>): void {
  if (fields.title !== undefined) assertText(fields.title, 'title', MAX_TITLE);
  if (fields.summary !== undefined) {
    assertText(fields.summary, 'summary', MAX_SUMMARY);
  }

  if (fields.repoFullName !== undefined) {
    assertText(fields.repoFullName, 'repoFullName', MAX_REPO_FULL_NAME);
    if (!REPO_FULL_NAME_PATTERN.test(fields.repoFullName)) {
      invalid({
        code: 'invalid-format',
        field: 'repoFullName',
        message: `repoFullName must be GitHub 'owner/name' (got ${JSON.stringify(fields.repoFullName)}).`,
      });
    }
  }

  // GitHub's primary-language label, e.g. `'TypeScript'`. Rendered as a badge on
  // the card, so it is content rather than a lookup key.
  if (fields.language !== undefined) {
    assertText(fields.language, 'language', MAX_LANGUAGE);
  }

  if (fields.coverImage !== undefined) {
    // Required by `LabSchema`, and the DIVERGENCE note there explains why: Labs
    // and Fun Entries are the site's main image source outside the case studies,
    // which is the complaint the whole rebuild exists to fix.
    assertMediaAsset(fields.coverImage, 'coverImage');
  }

  if (fields.links !== undefined) {
    assertUrl(fields.links.repo, 'links.repo');
    if (fields.links.live !== undefined) assertUrl(fields.links.live, 'links.live');
    if (fields.links.docs !== undefined) assertUrl(fields.links.docs, 'links.docs');
  }

  if (fields.liveStats !== undefined) {
    const stats = fields.liveStats;
    // Personal-repo scale: a side project has three stars, not three hundred.
    // The ceilings are sanity bounds that catch a field-mapping mistake.
    assertCount(stats.stars, 'liveStats.stars', 1_000_000);
    assertCount(stats.forks, 'liveStats.forks', 1_000_000);
    assertCount(stats.commitsYear, 'liveStats.commitsYear', 1_000_000);
    // Days, not milliseconds. The ceiling is generous (a century) because a
    // dormant repo from 2013 is a legitimate Lab, and it still catches the
    // mistake it exists for: an epoch-millisecond value lands near 1.7e12.
    assertCount(stats.lastPushDaysAgo, 'liveStats.lastPushDaysAgo', 36_500);
    if (stats.lastPushedAt !== undefined) {
      assertIsoInstant(stats.lastPushedAt, 'liveStats.lastPushedAt');
    }
    if (stats.syncedAt !== undefined) {
      assertIsoInstant(stats.syncedAt, 'liveStats.syncedAt');
    }
  }

  if (fields.sortOrder !== undefined && !Number.isInteger(fields.sortOrder)) {
    invalid({
      code: 'invalid-format',
      field: 'sortOrder',
      message: `sortOrder must be a whole number (got ${fields.sortOrder}).`,
    });
  }
}

/**
 * Assert `links.repo`, when it points at GitHub, names the same repo as
 * `repoFullName`.
 *
 * Not pedantry: `repoFullName` is what the phase 4 cron fetches stars and
 * commits for, while `links.repo` is what a visitor clicks. If they disagree, the
 * card shows one repo's numbers under another repo's link and nothing anywhere
 * reports an error — the numbers are simply, quietly, about something else.
 *
 * Only enforced for `github.com` hosts, since a Lab hosted elsewhere (a GitLab
 * mirror, a self-hosted Forgejo) legitimately has a link that does not match a
 * GitHub `owner/name`. `.git` suffixes and trailing slashes are tolerated,
 * because that is what the clone-URL copy button produces.
 */
function assertRepoLinkAgrees(repoFullName: string, repoUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(repoUrl);
  } catch {
    // `assertLabFields` already rejected a non-URL; nothing to compare against.
    return;
  }

  const host = parsed.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') return;

  const path = parsed.pathname
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '');

  if (path.toLowerCase() !== repoFullName.toLowerCase()) {
    invalid({
      code: 'invalid-format',
      field: 'links.repo',
      message:
        `links.repo points at "${path}" but repoFullName is "${repoFullName}". ` +
        'The cron refreshes stars and commits from repoFullName, so the card would ' +
        "show one repo's numbers under another repo's link.",
    });
  }
}

/**
 * Assert no other Lab already claims this `repoFullName`.
 *
 * The Lab-shaped equivalent of `assertSlugUnique` (which only knows about
 * `slug`). Uses `by_repoFullName` — the index the cron resolves rows with — so
 * this is an indexed probe, and the index earns its write cost twice.
 *
 * @param ignoreId - the row being edited, so re-saving a Lab does not report a
 *   conflict with itself.
 */
async function assertRepoUnique(
  // `GenericDatabaseReader`, matching `assertSlugUnique` in lib/validate.ts: a
  // reader is all this needs, and a mutation's writer satisfies it.
  db: GenericDatabaseReader<DataModel>,
  repoFullName: string,
  ignoreId?: Id<'labs'>,
): Promise<void> {
  const existing = await db
    .query('labs')
    .withIndex('by_repoFullName', (q) => q.eq('repoFullName', repoFullName))
    .first();

  if (existing !== null && existing._id !== ignoreId) {
    invalid({
      code: 'precondition-failed',
      field: 'repoFullName',
      message: `The Lab "${existing.slug}" already tracks ${repoFullName}.`,
    });
  }
}

/* ------------------------------------------------------------------ *
 * Read
 * ------------------------------------------------------------------ */

/**
 * Labs in display order.
 *
 * Public by default: published rows only, ascending `sortOrder`, off
 * `by_published_sortOrder`. `includeDrafts: true` is the admin listing and reads
 * `by_sortOrder`, which exists because a Convex index is only usable from its
 * leading field — see the identical note on `projects.list`, including why this
 * is an explicit argument rather than an implicit `isAdmin(ctx)` check.
 *
 * @param limit - a ceiling, not pagination.
 * @returns `Array<Doc<'labs'>>` — whole documents, unshaped.
 */
export const list = query({
  args: {
    includeDrafts: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 200, 1), 500);

    if (args.includeDrafts === true) {
      await requireAdmin(ctx);
      return await ctx.db.query('labs').withIndex('by_sortOrder').take(limit);
    }

    return await ctx.db
      .query('labs')
      .withIndex('by_published_sortOrder', (q) => q.eq('published', true))
      .take(limit);
  },
});

/**
 * Published + featured Labs, in display order. Public.
 *
 * The dashboard's hero row, served by `by_published_featured` — the mirror of
 * `projects.listFeatured`, and the reason both tables carry that index (see
 * schema.ts: "it would be a trap for one of them to reach it by index and the
 * other by scan-and-filter"). Sorted in memory afterwards because the index
 * orders by `featured`, not `sortOrder`, and the matching set is a handful.
 */
export const listFeatured = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 12, 1), 50);

    const rows = await ctx.db
      .query('labs')
      .withIndex('by_published_featured', (q) =>
        q.eq('published', true).eq('featured', true),
      )
      .collect();

    return rows.sort((a, b) => a.sortOrder - b.sortOrder).slice(0, limit);
  },
});

/**
 * One Lab by slug, or `null`.
 *
 * `null` covers "no such row" and "that row is a draft and you are not signed
 * in" alike — a draft URL must 404 for the public exactly as a nonexistent one
 * does. No slug format assertion, so a mistyped URL is a 404 and not a 500. Same
 * contract as `projects.getBySlug`.
 *
 * @param includeDrafts - admin-only, checked before the read, for the admin
 *   editor and the draft preview.
 */
export const getBySlug = query({
  args: {
    slug: v.string(),
    includeDrafts: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    if (args.includeDrafts === true) await requireAdmin(ctx);

    const row = await ctx.db
      .query('labs')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug))
      .first();

    if (row === null) return null;
    if (!row.published && args.includeDrafts !== true) return null;

    return row;
  },
});

/* ------------------------------------------------------------------ *
 * Write
 * ------------------------------------------------------------------ */

/**
 * Create a Lab. Admin-only. **Always a draft.**
 *
 * No `published` argument, for the same reason as `projects.create`: `publish` is
 * the single path onto the public site, so it stays the single place a
 * precondition could ever be enforced.
 *
 * @param liveStats - optional initial GitHub numbers. Omitted, the block is
 *   written as zeros **with no `syncedAt`**, and that absence is the signal: a
 *   reader showing `0 stars` next to a missing `syncedAt` is reporting "the cron
 *   has not run yet", not "this repo has no stars". Phase 4's cron overwrites the
 *   whole block on its next tick and sets `syncedAt` — see the file header.
 * @param sortOrder - omitted, the Lab goes last.
 * @param featured - omitted, `false`.
 *
 * @returns `{ labId, slug, sortOrder }`
 */
export const create = mutation({
  args: {
    slug: v.string(),
    title: v.string(),
    summary: v.string(),
    repoFullName: v.string(),
    language: v.string(),
    coverImage: mediaAsset,
    links: labLinks,

    liveStats: v.optional(labLiveStats),

    featured: v.optional(v.boolean()),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    await assertSlugUnique(ctx.db, 'labs', args.slug);

    const repoFullName = args.repoFullName.trim();
    const last = await ctx.db
      .query('labs')
      .withIndex('by_sortOrder')
      .order('desc')
      .first();

    const fields: LabFields = {
      published: false,
      featured: args.featured ?? false,
      sortOrder: args.sortOrder ?? (last === null ? 0 : last.sortOrder + 1),

      slug: args.slug,
      title: args.title.trim(),
      summary: args.summary.trim(),
      repoFullName,
      language: args.language.trim(),
      coverImage: args.coverImage,
      links: args.links,

      // Zeros with no `syncedAt` — see the `liveStats` note above.
      liveStats: args.liveStats ?? {
        stars: 0,
        forks: 0,
        commitsYear: 0,
        lastPushDaysAgo: 0,
      },
    };

    assertLabFields(fields);
    assertRepoLinkAgrees(fields.repoFullName, fields.links.repo);
    await assertRepoUnique(ctx.db, fields.repoFullName);

    const labId = await ctx.db.insert('labs', fields);

    return { labId, slug: fields.slug, sortOrder: fields.sortOrder };
  },
});

/**
 * Edit a Lab. Admin-only. Patch semantics.
 *
 * Only the fields present in the arguments are written. As in `projects.update`:
 * objects are replaced whole rather than merged (passing `coverImage` or
 * `liveStats` replaces the entire block), and `published` is not an argument.
 *
 * There is nothing to clear with `null` here — every field on a Lab except the
 * two optional timestamps inside `liveStats` is required by `LabSchema`, and
 * those are cleared by passing a `liveStats` block that omits them.
 *
 * ⚠️ `liveStats` is the cron's field from phase 4 onwards. A hand-written value
 * survives until the next hourly tick and no longer — see the file header. It is
 * writable here so that a wrong number is fixable today, not so that it is
 * maintained by hand.
 *
 * ⚠️ Renaming `slug` orphans inbound links and any `knowledgeDocs.sourceSlug` /
 * `siteSettings.featured.labSlugs` entry naming it. Treat it as destructive.
 *
 * @returns `{ labId, slug }` — the slug as stored, which may be the new one.
 */
export const update = mutation({
  args: {
    labId: v.id('labs'),

    slug: v.optional(v.string()),
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
    repoFullName: v.optional(v.string()),
    language: v.optional(v.string()),
    coverImage: v.optional(mediaAsset),
    links: v.optional(labLinks),

    /** Phase 4's cron is the eventual owner of this block. See the file header. */
    liveStats: v.optional(labLiveStats),

    featured: v.optional(v.boolean()),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const row = await ctx.db.get(args.labId);
    if (row === null) {
      invalid({
        code: 'not-found',
        field: 'labId',
        message: 'That Lab no longer exists.',
      });
    }

    const patch: LabPatch = {};

    if (args.slug !== undefined && args.slug !== row.slug) {
      await assertSlugUnique(ctx.db, 'labs', args.slug, row._id);
      patch.slug = args.slug;
    }

    if (args.title !== undefined) patch.title = args.title.trim();
    if (args.summary !== undefined) patch.summary = args.summary.trim();
    if (args.repoFullName !== undefined) patch.repoFullName = args.repoFullName.trim();
    if (args.language !== undefined) patch.language = args.language.trim();
    if (args.coverImage !== undefined) patch.coverImage = args.coverImage;
    if (args.links !== undefined) patch.links = args.links;
    if (args.liveStats !== undefined) patch.liveStats = args.liveStats;

    if (args.featured !== undefined) patch.featured = args.featured;
    if (args.sortOrder !== undefined) patch.sortOrder = args.sortOrder;

    assertLabFields(patch);

    // Cross-field checks run against the *effective* row — the patched value
    // where one was given, the stored value otherwise. Editing only `links` must
    // still be checked against the `repoFullName` that will be there afterwards.
    const repoFullName = patch.repoFullName ?? row.repoFullName;
    assertRepoLinkAgrees(repoFullName, (patch.links ?? row.links).repo);
    if (patch.repoFullName !== undefined) {
      await assertRepoUnique(ctx.db, repoFullName, row._id);
    }

    // A form that submits no changes should not produce a write.
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(row._id, patch);
    }

    return { labId: row._id, slug: patch.slug ?? row.slug };
  },
});

/**
 * Publish a Lab. Admin-only.
 *
 * **No media gate** — see the file header for why ADR 009 does not apply to Labs
 * and why `projects.publish` is the only place it is enforced.
 *
 * Idempotent, reporting `alreadyPublished`. Phase 6 adds a knowledge re-index
 * here, the same hook `projects.publish` describes.
 *
 * @returns `{ labId, slug, published: true, alreadyPublished }`
 */
export const publish = mutation({
  args: { labId: v.id('labs') },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const row = await ctx.db.get(args.labId);
    if (row === null) {
      invalid({
        code: 'not-found',
        field: 'labId',
        message: 'That Lab no longer exists.',
      });
    }

    if (row.published) {
      return {
        labId: row._id,
        slug: row.slug,
        published: true as const,
        alreadyPublished: true,
      };
    }

    await ctx.db.patch(row._id, { published: true });

    return {
      labId: row._id,
      slug: row.slug,
      published: true as const,
      alreadyPublished: false,
    };
  },
});

/**
 * Withdraw a Lab from the public site. Admin-only.
 *
 * Keeps `featured` and `sortOrder` so re-publishing restores its position.
 * `listFeatured` filters on `published`, so it leaves the dashboard in the same
 * tick.
 *
 * @returns `{ labId, slug, published: false, alreadyUnpublished }`
 */
export const unpublish = mutation({
  args: { labId: v.id('labs') },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const row = await ctx.db.get(args.labId);
    if (row === null) {
      invalid({
        code: 'not-found',
        field: 'labId',
        message: 'That Lab no longer exists.',
      });
    }

    if (!row.published) {
      return {
        labId: row._id,
        slug: row.slug,
        published: false as const,
        alreadyUnpublished: true,
      };
    }

    await ctx.db.patch(row._id, { published: false });

    return {
      labId: row._id,
      slug: row.slug,
      published: false as const,
      alreadyUnpublished: false,
    };
  },
});

/**
 * Toggle the `featured` flag on its own. Admin-only.
 *
 * The one-tap affordance the admin listing wants: `update` can set this field
 * too, but promoting a Lab onto the dashboard should not require submitting a
 * form that also holds its cover image. Mirrored by `projects.setFeatured`.
 *
 * Featuring a draft is allowed and takes effect when it is published —
 * `listFeatured` requires both flags.
 *
 * Note this sets *eligibility*. `siteSettings.featured.labSlugs` holds the
 * curated order and the slot count for the dashboard grid, which has fixed
 * dimensions to hold the CLS budget; a Lab can be featured here and still not
 * appear there.
 *
 * @returns `{ labId, featured }` — as stored, for optimistic-update
 *   reconciliation.
 */
export const setFeatured = mutation({
  args: {
    labId: v.id('labs'),
    featured: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const row = await ctx.db.get(args.labId);
    if (row === null) {
      invalid({
        code: 'not-found',
        field: 'labId',
        message: 'That Lab no longer exists.',
      });
    }

    if (row.featured !== args.featured) {
      await ctx.db.patch(row._id, { featured: args.featured });
    }

    return { labId: row._id, featured: args.featured };
  },
});

/**
 * Renumber the whole collection from a display order. Admin-only.
 *
 * The mirror of `projects.setSortOrder`, and the same contract: pass **every**
 * Lab, in the order it should appear, and dense weights `0, 1, 2, …` are written.
 * Completeness is required because positional weights written for a subset would
 * collide with the rows left out; rows already holding the right weight are
 * skipped, so reordering two items is two writes.
 *
 * @param labIds - every Lab `_id`, in display order.
 * @returns `{ count, changed }`
 */
export const setSortOrder = mutation({
  args: { labIds: v.array(v.id('labs')) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const requested = new Set<Id<'labs'>>(args.labIds);
    if (requested.size !== args.labIds.length) {
      invalid({
        code: 'invalid-format',
        field: 'labIds',
        message: 'labIds contains the same Lab more than once.',
      });
    }

    const rows = await ctx.db.query('labs').withIndex('by_sortOrder').collect();

    const missing = rows.filter((row) => !requested.has(row._id));
    if (missing.length > 0 || args.labIds.length !== rows.length) {
      invalid({
        code: 'precondition-failed',
        field: 'labIds',
        message:
          `setSortOrder needs every Lab, in display order: got ${args.labIds.length} of ${rows.length}` +
          (missing.length > 0
            ? `, missing ${missing.map((row) => row.slug).join(', ')}`
            : '') +
          '.',
      });
    }

    const byId = new Map(rows.map((row) => [row._id, row]));
    let changed = 0;

    for (const [index, labId] of args.labIds.entries()) {
      const row = byId.get(labId);
      // Unreachable — counts match and there are no duplicates. Guarded rather
      // than asserted, because a non-null assertion here would be the one line
      // hiding a real bug.
      if (row === undefined) continue;
      if (row.sortOrder === index) continue;

      await ctx.db.patch(row._id, { sortOrder: index });
      changed += 1;
    }

    return { count: rows.length, changed };
  },
});

/**
 * Delete a Lab for good. Admin-only.
 *
 * Idempotent (a double-click or a stale tab both got what they wanted) and
 * irreversible, so the admin UI must confirm — `unpublish` is the reversible way
 * to take something off the site.
 *
 * Leaves the same loose ends `projects.remove` documents: the UploadThing file
 * behind `coverImage.storageKey` is orphaned (a mutation cannot `fetch`; ADR 010
 * cleanup has to be a scheduled action), any `knowledgeDocs` rows citing the slug
 * survive until phase 6's re-index prunes them, and
 * `siteSettings.featured.labSlugs` may still name it — which readers already
 * treat as "not featured yet".
 *
 * @returns `{ labId, deleted }`
 */
export const remove = mutation({
  args: { labId: v.id('labs') },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const row = await ctx.db.get(args.labId);
    if (row === null) {
      return { labId: args.labId, deleted: false };
    }

    await ctx.db.delete(row._id);
    return { labId: args.labId, deleted: true };
  },
});
