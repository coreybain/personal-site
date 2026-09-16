/** Shared Lab operations; human and management entry points authorize their callers. */
import type { GenericDatabaseReader } from 'convex/server';
import { type Infer, v } from 'convex/values';
import { internal } from '../_generated/api';
import type { DataModel, Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { assertExpectedRevision, currentRevision, nextRevision } from './revision';
import { assertRange, assertSlugUnique, assertText, assertUrl, invalid } from './validate';
import { mediaAsset } from '../schema';

/* ------------------------------------------------------------------ *
 * Validators the schema does not export
 *
 * `labs.links` is declared inline in schema.ts and has no exported name.
 * It is mirrored here field for field.
 * ------------------------------------------------------------------ */

/** Mirrors `labs.links` / `LabLinksSchema`. `repo` is required — see the header. */
export const labLinks = v.object({
  repo: v.string(),
  live: v.optional(v.string()),
  docs: v.optional(v.string()),
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
export type LabPatch = Partial<Omit<LabFields, 'published' | 'liveStats' | 'revision'>>;

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
  if (fields.sortOrder !== undefined) {
    assertRange(fields.sortOrder, 'sortOrder', 0, 1_000_000_000);
    if (!Number.isSafeInteger(fields.sortOrder)) {
      invalid({
        code: 'invalid-format',
        field: 'sortOrder',
        message: 'sortOrder must be a whole number.',
      });
    }
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

/** Editorial values only: generated stats and curation never enter an agent draft. */
export const labEditorialFields = {
  slug: v.string(), title: v.string(), summary: v.string(), repoFullName: v.string(),
  language: v.string(), coverImage: mediaAsset, links: labLinks,
};
export const labEditorialPatchFields = {
  slug: v.optional(v.string()), title: v.optional(v.string()), summary: v.optional(v.string()),
  repoFullName: v.optional(v.string()), language: v.optional(v.string()),
  coverImage: v.optional(mediaAsset), links: v.optional(labLinks),
};
export const labCreateFields = {
  ...labEditorialFields, featured: v.optional(v.boolean()), sortOrder: v.optional(v.number()),
};
export const labPatchFields = {
  ...labEditorialPatchFields, featured: v.optional(v.boolean()), sortOrder: v.optional(v.number()),
};
const labContentValidator = v.object(labEditorialFields);
const labCreateValidator = v.object(labCreateFields);
export type LabContent = Infer<typeof labContentValidator>;
type LabCreateInput = Infer<typeof labCreateValidator>;
type ExistingLabArgs = { labId: Id<'labs'>; expectedRevision?: number };

/** Normalize and validate the effective editorial patch without writing live content. */
export async function prepareLabPatch(
  ctx: MutationCtx,
  row: LabContent & { _id: Id<'labs'> },
  args: LabPatch,
): Promise<LabPatch> {
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

  return patch;
}

export async function createLab(ctx: MutationCtx, args: LabCreateInput) {
  await assertSlugUnique(ctx.db, 'labs', args.slug);

  const repoFullName = args.repoFullName.trim();
  const last = await ctx.db
    .query('labs')
    .withIndex('by_sortOrder')
    .order('desc')
    .first();

  const fields: LabFields = {
    revision: 1,
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
    liveStats: {
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

  return {
    labId,
    slug: fields.slug,
    sortOrder: fields.sortOrder,
    revision: 1 as const,
    created: true,
  };
}

export async function updateLab(ctx: MutationCtx, args: ExistingLabArgs & LabPatch) {
  const row = await ctx.db.get(args.labId);
  if (row === null) {
    invalid({
      code: 'not-found',
      field: 'labId',
      message: 'That Lab no longer exists.',
    });
  }

  assertExpectedRevision(row.revision, args.expectedRevision);

  const patch: Partial<LabFields> = await prepareLabPatch(ctx, row, args);

  // A form that submits no changes should not produce a write.
  const changed = Object.keys(patch).length > 0;
  const revision = changed ? nextRevision(row.revision) : currentRevision(row.revision);
  if (changed) {
    patch.revision = revision;
    await ctx.db.patch(row._id, patch);
  }

  // PHASE 4 — knowledge indexing (ADR 015). Editing a published Lab changes
  // text `knowledgeDocs` is already holding, so the indexer hooks in here as
  // well as in `publish`. The rename half is NOT gated on `published`: the old
  // slug's document is orphaned either way (the ⚠️ above), and an orphan is
  // the one stale index entry re-indexing the source cannot repair.
  if (patch.slug !== undefined) {
    await ctx.scheduler.runAfter(0, internal.knowledge.removeSource, {
      sourceType: 'lab',
      sourceSlug: row.slug,
    });
  }

  // Only the fields `knowledge.sourceForIndex` actually reads. `coverImage`
  // and `links` are excluded there as URLs, and `liveStats` is excluded
  // because the hourly cron rewrites it — re-indexing on every tick would burn
  // an embedding call an hour to store the same string back.
  const INDEXED_FIELDS = ['slug', 'title', 'summary', 'repoFullName', 'language'] as const;

  if (row.published && INDEXED_FIELDS.some((field) => field in patch)) {
    await ctx.scheduler.runAfter(0, internal.knowledge.indexSource, {
      sourceType: 'lab',
      sourceSlug: patch.slug ?? row.slug,
    });
  }

  return {
    labId: row._id,
    slug: patch.slug ?? row.slug,
    revision,
    changed,
  };
}

export async function publishLab(ctx: MutationCtx, args: ExistingLabArgs) {
  const row = await ctx.db.get(args.labId);
  if (row === null) {
    invalid({
      code: 'not-found',
      field: 'labId',
      message: 'That Lab no longer exists.',
    });
  }

  assertExpectedRevision(row.revision, args.expectedRevision);
  if (row.published) {
    return {
      labId: row._id,
      slug: row.slug,
      published: true as const,
      alreadyPublished: true,
      changed: false,
      revision: currentRevision(row.revision),
    };
  }

  const revision = nextRevision(row.revision);
  await ctx.db.patch(row._id, { published: true, revision });

  // PHASE 4 — knowledge indexing (ADR 015). Scheduled, not inline: embedding
  // needs `fetch` and a mutation cannot, so a provider outage delays the index
  // instead of failing the publish. `runAfter(0, …)` is part of this
  // transaction, so a rolled-back publish never schedules the job.
  await ctx.scheduler.runAfter(0, internal.knowledge.indexSource, {
    sourceType: 'lab',
    sourceSlug: row.slug,
  });

  return {
    labId: row._id,
    slug: row.slug,
    published: true as const,
    alreadyPublished: false,
    changed: true,
    revision,
  };
}

export async function unpublishLab(ctx: MutationCtx, args: ExistingLabArgs) {
  const row = await ctx.db.get(args.labId);
  if (row === null) {
    invalid({
      code: 'not-found',
      field: 'labId',
      message: 'That Lab no longer exists.',
    });
  }

  assertExpectedRevision(row.revision, args.expectedRevision);
  if (!row.published) {
    return {
      labId: row._id,
      slug: row.slug,
      published: false as const,
      alreadyUnpublished: true,
      changed: false,
      revision: currentRevision(row.revision),
    };
  }

  const revision = nextRevision(row.revision);
  await ctx.db.patch(row._id, { published: false, revision });

  // PHASE 4 — knowledge indexing (ADR 015). A flag patch, not a delete: the
  // text and its vector stay put for the moment this is published again, and
  // `knowledgeDocs.published` is what makes the row unreachable meanwhile. No
  // embedding call, so this is the internal mutation rather than the action.
  await ctx.scheduler.runAfter(0, internal.knowledge.setSourcePublished, {
    sourceType: 'lab',
    sourceSlug: row.slug,
    published: false,
  });

  return {
    labId: row._id,
    slug: row.slug,
    published: false as const,
    alreadyUnpublished: false,
    changed: true,
    revision,
  };
}

export async function removeLab(ctx: MutationCtx, args: ExistingLabArgs) {
  const row = await ctx.db.get(args.labId);
  if (row === null) {
    return { labId: args.labId, deleted: false, revision: null };
  }

  assertExpectedRevision(row.revision, args.expectedRevision);
  const revision = currentRevision(row.revision);
  const draft = await ctx.db.query('managementLabDrafts')
    .withIndex('by_labId', (q) => q.eq('labId', row._id)).unique();
  if (draft) await ctx.db.delete(draft._id);
  await ctx.db.delete(row._id);

  // PHASE 4 — knowledge indexing (ADR 015). An orphaned `knowledgeDocs` row is
  // the one stale index entry re-indexing cannot repair, because there is no
  // source left to read. Deleted outright via `by_source`.
  await ctx.scheduler.runAfter(0, internal.knowledge.removeSource, {
    sourceType: 'lab',
    sourceSlug: row.slug,
  });

  return { labId: args.labId, deleted: true, revision };
}
