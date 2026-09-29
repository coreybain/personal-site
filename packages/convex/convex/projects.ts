/**
 * projects.ts — the Case Study table: read, write, order, publish.
 *
 * A **Case Study** (glossary) is client/employer work: always attributed, always
 * sanitised, never repo-linked (ADR 008 — which is why `links` below has no
 * `repo` key and never will). These are the rows `/work`, `/work/[slug]` and the
 * dashboard's featured tiles render, and they are the most persuasive thing on
 * the site, so the write path here is deliberately stricter than the schema.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  ADR 009 PUBLISH GATE — `publish` REFUSES A ROW WITH UNSANITISED MEDIA.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Case-study imagery is real screenshots of client software. Sanitisation —
 * scrubbing customer data and identifiers — is manual per-image work (ADR 009,
 * build phase 8), and `mediaAsset.sanitised` is the flag that records it having
 * been done. That flag exists *for this gate*: without an assertion somewhere,
 * it is a boolean nobody reads, and the failure mode it guards against is
 * publishing a client's customer records to a public URL.
 *
 * So the gate is enforced in exactly two places, and both are in this file:
 *
 *   1. `publish` — asserts every entry in `media` has `sanitised === true`
 *      before `published` flips on, and the error names the offending assets so
 *      the admin UI can point at the right thumbnail.
 *   2. `update` — asserts the same thing when `media` is replaced on a row that
 *      is *already* published. Gating only `publish` would leave the obvious
 *      bypass wide open: publish a clean row, then edit unsanitised screenshots
 *      into it.
 *
 * `published` is therefore NOT a writable field on `create` or `update`. There
 * is one way for it to become `true` — the `publish` mutation — and that is what
 * makes the gate a gate rather than a convention.
 *
 * ── Knowledge indexing (ADR 015, pipeline 4) ──────────────────────────────
 *
 * `update`, `publish`, `unpublish` and `remove` each schedule a knowledge.ts
 * function so `knowledgeDocs` tracks this table. The calls are `runAfter(0, …)`
 * rather than inline because embedding needs `fetch` and a mutation cannot — see
 * knowledge.ts's header for the whole contract. `knowledgeDocs` rows are derived
 * and always safe to rebuild: `bunx convex run knowledge:backfill` repairs any
 * drift, including for rows published before that file existed.
 *
 * ── What is NOT here ──────────────────────────────────────────────────────
 *
 *   • Uploadfile deletion. `remove` drops the row and orphans the CDN copies
 *     its `media[].storageKey`s point at (ADR 020). A mutation cannot `fetch`,
 *     so reaching Uploadfile has to be a scheduled action; until it exists,
 *     orphaned files cost storage and leak nothing.
 */

import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import { requireAdmin } from './lib/auth';
import { assertExpectedRevision, currentRevision, nextRevision } from './lib/revision';
import { invalid } from './lib/validate';
import { createProject, updateProject, publishProject, unpublishProject, removeProject, projectCreateFields, projectPatchFields } from './lib/projectOperations';

/* ------------------------------------------------------------------ *
 * Read
 * ------------------------------------------------------------------ */

/**
 * Case studies in display order.
 *
 * Public by default: published rows only, ascending `sortOrder`, straight off
 * `by_published_sortOrder`. Pass `includeDrafts: true` for the admin listing,
 * which reads `by_sortOrder` instead — that index exists precisely because a
 * Convex index is only usable from its leading field, so
 * `by_published_sortOrder` cannot serve "both states, in one ordered read".
 *
 * `includeDrafts` is an explicit argument rather than an implicit
 * `isAdmin(ctx)` check, and the difference matters: with the implicit form,
 * `/work` would silently gain draft rows for the one signed-in visitor, so the
 * only person who could not see the site as the public sees it would be its
 * author. It also keeps this query's result a pure function of its arguments,
 * which is what makes it cacheable at the page level.
 *
 * @param limit - a ceiling, not pagination. The default is far above the
 *   plausible number of case studies; if this table ever needs paging, that is a
 *   `paginate()` and a different signature, not a bigger number.
 * @returns `Array<Doc<'projects'>>` — whole documents, unshaped, per the package
 *   convention (see snapshot.ts).
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
      return await ctx.db.query('projects').withIndex('by_sortOrder').take(limit);
    }

    return await ctx.db
      .query('projects')
      .withIndex('by_published_sortOrder', (q) => q.eq('published', true))
      .take(limit);
  },
});

/** Every case study in display order for native administrative CRUD. */
export const listAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.db.query('projects').withIndex('by_sortOrder').collect();
  },
});

/**
 * Published + featured case studies, in display order. Public.
 *
 * The dashboard's hero row (ADR 003) and the section's featured strip. Served by
 * `by_published_featured`, which is why that index exists — the alternative is
 * scanning every row to test a boolean, and `labs` reaches its equivalent the
 * same way, deliberately.
 *
 * The index orders by `featured`, not by `sortOrder`, so the handful of matching
 * rows are sorted in memory afterwards. That is a real trade and it is the right
 * one at this size: an index on `['published', 'featured', 'sortOrder']` would
 * be a fourth index on the table to save a sort of six items.
 *
 * Note this returns *eligible* rows. `siteSettings.featured.projectSlugs` is the
 * curated order and slot count for the dashboard grid (see that field's note in
 * schema.ts); a caller rendering the fixed-dimension grid should intersect the
 * two rather than trust either alone.
 */
export const listFeatured = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 12, 1), 50);

    const rows = await ctx.db
      .query('projects')
      .withIndex('by_published_featured', (q) =>
        q.eq('published', true).eq('featured', true),
      )
      .collect();

    return rows.sort((a, b) => a.sortOrder - b.sortOrder).slice(0, limit);
  },
});

/**
 * One case study by slug, or `null`.
 *
 * The single read behind `/work/[slug]`. `null` covers both "no such row" and
 * "that row is a draft and you are not signed in", which is what the page wants:
 * a draft URL must 404 for the public exactly as a nonexistent one does, and
 * telling the two apart would leak the existence of unpublished work.
 *
 * Deliberately does NOT assert the slug's format. A malformed slug cannot match
 * any row, so it returns `null` and the route renders its 404 — whereas throwing
 * would turn a mistyped URL into a 500.
 *
 * @param includeDrafts - admin-only, and checked before the row is read so the
 *   failure is "sign in", not "not found". This is how the admin editor and the
 *   draft preview load a row that `/work/[slug]` cannot see.
 */
export const getBySlug = query({
  args: {
    slug: v.string(),
    includeDrafts: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    if (args.includeDrafts === true) await requireAdmin(ctx);

    const row = await ctx.db
      .query('projects')
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
 * Create a case study. Admin-only. **Always a draft.**
 *
 * There is no `published` argument: a new row is inserted with
 * `published: false` and reaches the public site only through `publish`, which
 * is where the ADR 009 gate lives. Accepting the flag here would mean two
 * publish paths and one gate.
 *
 * @param sortOrder - omitted, the row goes last (highest existing weight + 1),
 *   which is what "I just added this" means. `setSortOrder` renumbers the whole
 *   collection densely afterwards.
 * @param featured - omitted, `false`. Marking a draft featured is allowed and
 *   does nothing until it is published — `listFeatured` filters on both.
 *
 * @returns `{ projectId, slug, sortOrder, revision, created }` — enough for the admin UI to
 *   navigate straight to the row it just made.
 */
export const create = mutation({
  args: projectCreateFields,
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await createProject(ctx, args);
  },
});

/**
 * Edit a case study. Admin-only. Patch semantics.
 *
 * Only the fields present in the arguments are written; an omitted field is left
 * exactly as it was. Two consequences worth stating, because they are the usual
 * source of surprise in a patch API:
 *
 *   • **Clearing an optional field is `null`, not omission.** `period`,
 *     `problem`, `approach`, `outcomes`, `body` and `aiBuildStats` accept `null`
 *     to mean "remove this field", which the handler translates into the
 *     `undefined` that `ctx.db.patch` deletes with. Without that, "leave it
 *     alone" and "empty it" would be the same request.
 *   • **Arrays and objects are replaced whole, not merged.** Passing `media`
 *     replaces the entire array; passing `links: {}` clears both links. There is
 *     no per-item patch, because the admin form always holds the full list and a
 *     merge would make removal impossible.
 *
 * `published` is not an argument — see the file header.
 *
 * ⚠️ Renaming `slug` is allowed and is not free: it orphans every inbound link,
 * every `knowledgeDocs.sourceSlug` citing it, and any
 * `siteSettings.featured.projectSlugs` entry naming it. The admin UI should
 * treat it as a destructive action.
 *
 * @returns `{ projectId, slug, changed, revision }` — the authoritative revision
 *   is unchanged for a no-op and advances exactly once for a write.
 */
export const update = mutation({
  args: { projectId: v.id('projects'), expectedRevision: v.optional(v.number()), ...projectPatchFields },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await updateProject(ctx, args);
  },
});

/**
 * Publish a case study. **This is the ADR 009 gate.**
 *
 * Refuses unless every asset in `media` carries `sanitised: true`, and the error
 * names the ones that do not — see `assertSanitisedMedia`, including why an
 * empty `media` array is allowed through.
 *
 * Idempotent: publishing an already-published row still runs the gate (cheap,
 * and it means a stale tab cannot report success for a row that would now fail)
 * and reports `alreadyPublished`.
 *
 * Schedules the knowledge re-index — see the file header.
 *
 * @returns `{ projectId, slug, published: true, alreadyPublished, changed, revision }`
 */
export const publish = mutation({
  args: {
    projectId: v.id('projects'),
    expectedRevision: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await publishProject(ctx, args);
  },
});

/**
 * Withdraw a case study from the public site. Admin-only.
 *
 * No gate — taking something down is always allowed, immediately. The row keeps
 * its `featured` flag and `sortOrder` so re-publishing restores it to where it
 * was, and `listFeatured` already filters on `published` so an unpublished
 * featured row disappears from the dashboard in the same tick.
 *
 * @returns `{ projectId, slug, published: false, alreadyUnpublished, changed, revision }`
 */
export const unpublish = mutation({
  args: {
    projectId: v.id('projects'),
    expectedRevision: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await unpublishProject(ctx, args);
  },
});

/**
 * Toggle the `featured` flag on its own. Admin-only.
 *
 * `update` can do this too; this exists because the admin listing wants a
 * one-tap star per row and should not have to submit a form to set one boolean.
 * The mirror of `labs.setFeatured` — both sections feed the same dashboard grid,
 * and it would be a trap for one of them to have the affordance and the other
 * not.
 *
 * Featuring a draft is allowed and takes effect when it is published.
 *
 * @returns `{ projectId, featured }` — as stored, for optimistic-update
 *   reconciliation.
 */
export const setFeatured = mutation({
  args: {
    projectId: v.id('projects'),
    featured: v.boolean(),
    expectedRevision: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const row = await ctx.db.get(args.projectId);
    if (row === null) {
      invalid({
        code: 'not-found',
        field: 'projectId',
        message: 'That case study no longer exists.',
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

    return { projectId: row._id, featured: args.featured, changed, revision };
  },
});

/**
 * Renumber the whole collection from a display order. Admin-only.
 *
 * Takes **every** case study, in the order they should appear, and writes dense
 * weights `0, 1, 2, …`. That is the shape a drag-and-drop list produces, and
 * renumbering densely is what keeps the weights from drifting into fractions or
 * leaving gaps that a later insert falls into.
 *
 * Completeness is required rather than convenient: writing positional weights
 * for a subset would collide with the rows left out, so a partial list has no
 * correct interpretation. The admin listing already holds every row (`list` is
 * not paginated), so it always has the full set to send.
 *
 * Rows whose weight is already correct are skipped — reordering two items in a
 * list of thirty is two writes, not thirty.
 *
 * @param projectIds - every project `_id`, in display order.
 * @param expectedRevisions - each id's captured revision in the same order;
 *   the transaction rejects before writing if any row changed elsewhere.
 * @returns `{ count, changed, revisions }` — rows considered, rows written,
 *   and the authoritative revision for every row.
 */
export const setSortOrder = mutation({
  args: {
    projectIds: v.array(v.id('projects')),
    expectedRevisions: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    if (args.expectedRevisions.length !== args.projectIds.length) {
      invalid({
        code: 'precondition-failed',
        field: 'expectedRevisions',
        message: 'Every project in a reorder needs its captured revision.',
      });
    }

    const requested = new Set<Id<'projects'>>(args.projectIds);
    if (requested.size !== args.projectIds.length) {
      invalid({
        code: 'invalid-format',
        field: 'projectIds',
        message: 'projectIds contains the same case study more than once.',
      });
    }

    const rows = await ctx.db.query('projects').withIndex('by_sortOrder').collect();

    const missing = rows.filter((row) => !requested.has(row._id));
    if (missing.length > 0 || args.projectIds.length !== rows.length) {
      invalid({
        code: 'precondition-failed',
        field: 'projectIds',
        message:
          `setSortOrder needs every case study, in display order: got ${args.projectIds.length} of ${rows.length}` +
          (missing.length > 0
            ? `, missing ${missing.map((row) => row.slug).join(', ')}`
            : '') +
          '.',
      });
    }

    const byId = new Map(rows.map((row) => [row._id, row]));
    for (const [index, projectId] of args.projectIds.entries()) {
      const row = byId.get(projectId);
      if (row !== undefined) {
        assertExpectedRevision(row.revision, args.expectedRevisions[index]);
      }
    }
    let changed = 0;
    const revisions: Array<{ projectId: Id<'projects'>; revision: number }> = [];

    for (const [index, projectId] of args.projectIds.entries()) {
      const row = byId.get(projectId);
      // Unreachable: the counts matched and there are no duplicates, so every
      // requested id is one of `rows`. Guarded rather than asserted because a
      // non-null assertion here would be the one line hiding a real bug.
      if (row === undefined) continue;
      let revision = currentRevision(row.revision);
      if (row.sortOrder !== index) {
        revision = nextRevision(row.revision);
        await ctx.db.patch(row._id, { sortOrder: index, revision });
        changed += 1;
      }
      revisions.push({ projectId: row._id, revision });
    }

    return { count: rows.length, changed, revisions };
  },
});

/**
 * Delete a case study for good. Admin-only.
 *
 * Idempotent — a double-click or a stale tab both mean the caller got what it
 * wanted. Irreversible, so the admin UI must confirm; `unpublish` is the
 * reversible way to take something off the site.
 *
 * One loose end this deliberately leaves, noted in the file header: the
 * Uploadfile files behind `media[].storageKey` are orphaned.
 * `siteSettings.featured.projectSlugs` may also still name the deleted slug,
 * which readers already treat as "not featured yet" — see `siteSettings.upsert`.
 * The `knowledgeDocs` rows are pruned by the hook below.
 *
 * @returns `{ projectId, deleted, revision }` — `revision` is the last stored
 *   revision, or `null` when the row was already absent.
 */
export const remove = mutation({
  args: {
    projectId: v.id('projects'),
    expectedRevision: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await removeProject(ctx, args);
  },
});
