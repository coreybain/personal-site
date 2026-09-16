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
 * The cron now exists and is the sole writer. Admin create/update arguments do
 * not expose this block: a new row starts at unsynchronised zeroes, and the next
 * successful GitHub refresh replaces them. Repair collector data at its source
 * or through an explicit internal migration, never through an editorial client.
 *
 * `repoFullName` uniqueness is enforced here for the cron's benefit: two rows
 * naming one repo would both be refreshed from it, and the second would look like
 * a bug in the pipeline rather than a duplicate in the data.
 */

import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import { requireAdmin } from './lib/auth';
import { assertExpectedRevision, currentRevision, nextRevision } from './lib/revision';
import { invalid } from './lib/validate';
import {
  createLab, labCreateFields, labPatchFields, publishLab, removeLab, unpublishLab, updateLab,
} from './lib/labOperations';

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

/** Every Lab in display order for native administrative CRUD. */
export const listAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.db.query('labs').withIndex('by_sortOrder').collect();
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
 * `liveStats` starts as zeroes **with no `syncedAt`**. That absence means the
 * collector has not run yet; it is not a claim that the repository has no stars.
 * @param sortOrder - omitted, the Lab goes last.
 * @param featured - omitted, `false`.
 *
 * @returns `{ labId, slug, sortOrder, revision, created }`
 */
export const create = mutation({
  args: labCreateFields,
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return createLab(ctx, args);
  },
});

/**
 * Edit a Lab. Admin-only. Patch semantics.
 *
 * Only the fields present in the arguments are written. As in `projects.update`:
 * objects are replaced whole rather than merged, and `published`/`liveStats`
 * are not arguments. Publication has dedicated mutations; GitHub owns stats.
 *
 * ⚠️ Renaming `slug` orphans inbound links and any `knowledgeDocs.sourceSlug` /
 * `siteSettings.featured.labSlugs` entry naming it. Treat it as destructive.
 *
 * @returns `{ labId, slug, changed, revision }` — the authoritative revision is
 *   unchanged for a no-op and advances exactly once for a write.
 */
export const update = mutation({
  args: { labId: v.id('labs'), expectedRevision: v.optional(v.number()), ...labPatchFields },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return updateLab(ctx, args);
  },
});

/**
 * Publish a Lab. Admin-only.
 *
 * **No media gate** — see the file header for why ADR 009 does not apply to Labs
 * and why `projects.publish` is the only place it is enforced.
 *
 * Idempotent, reporting `alreadyPublished`. Schedules the knowledge re-index,
 * the same hook `projects.publish` describes.
 *
 * @returns `{ labId, slug, published: true, alreadyPublished, changed, revision }`
 */
export const publish = mutation({
  args: {
    labId: v.id('labs'),
    expectedRevision: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return publishLab(ctx, args);
  },
});

/**
 * Withdraw a Lab from the public site. Admin-only.
 *
 * Keeps `featured` and `sortOrder` so re-publishing restores its position.
 * `listFeatured` filters on `published`, so it leaves the dashboard in the same
 * tick.
 *
 * @returns `{ labId, slug, published: false, alreadyUnpublished, changed, revision }`
 */
export const unpublish = mutation({
  args: {
    labId: v.id('labs'),
    expectedRevision: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return unpublishLab(ctx, args);
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
    expectedRevision: v.optional(v.number()),
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

    assertExpectedRevision(row.revision, args.expectedRevision);

    const changed = row.featured !== args.featured;
    const revision = changed ? nextRevision(row.revision) : currentRevision(row.revision);
    if (changed) {
      await ctx.db.patch(row._id, {
        featured: args.featured,
        revision,
      });
    }

    return { labId: row._id, featured: args.featured, changed, revision };
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
 * @param expectedRevisions - each id's captured revision in the same order.
 * @returns `{ count, changed, revisions }`
 */
export const setSortOrder = mutation({
  args: {
    labIds: v.array(v.id('labs')),
    expectedRevisions: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    if (args.expectedRevisions.length !== args.labIds.length) {
      invalid({
        code: 'precondition-failed',
        field: 'expectedRevisions',
        message: 'Every Lab in a reorder needs its captured revision.',
      });
    }

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
    for (const [index, labId] of args.labIds.entries()) {
      const row = byId.get(labId);
      if (row !== undefined) {
        assertExpectedRevision(row.revision, args.expectedRevisions[index]);
      }
    }
    let changed = 0;
    const revisions: Array<{ labId: Id<'labs'>; revision: number }> = [];

    for (const [index, labId] of args.labIds.entries()) {
      const row = byId.get(labId);
      // Unreachable — counts match and there are no duplicates. Guarded rather
      // than asserted, because a non-null assertion here would be the one line
      // hiding a real bug.
      if (row === undefined) continue;
      let revision = currentRevision(row.revision);
      if (row.sortOrder !== index) {
        revision = nextRevision(row.revision);
        await ctx.db.patch(row._id, { sortOrder: index, revision });
        changed += 1;
      }
      revisions.push({ labId: row._id, revision });
    }

    return { count: rows.length, changed, revisions };
  },
});

/**
 * Delete a Lab for good. Admin-only.
 *
 * Idempotent (a double-click or a stale tab both got what they wanted) and
 * irreversible, so the admin UI must confirm — `unpublish` is the reversible way
 * to take something off the site.
 *
 * Leaves the same loose end `projects.remove` documents: the UploadThing file
 * behind `coverImage.storageKey` is orphaned (a mutation cannot `fetch`; ADR 010
 * cleanup has to be a scheduled action). `siteSettings.featured.labSlugs` may
 * still name it — which readers already treat as "not featured yet". The
 * `knowledgeDocs` rows are no longer a loose end; see the hook below.
 *
 * @returns `{ labId, deleted, revision }` — `revision` is the last stored
 *   revision, or `null` when the row was already absent.
 */
export const remove = mutation({
  args: {
    labId: v.id('labs'),
    expectedRevision: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return removeLab(ctx, args);
  },
});
