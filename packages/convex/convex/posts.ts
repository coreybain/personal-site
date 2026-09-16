/**
 * posts.ts — the blog: reads for `/blog` and `/blog/[slug]`, writes for `/admin`.
 *
 * `posts` is the one publishable collection with no `featured` / `sortOrder`
 * pair, because the blog is strictly reverse-chronological (see the table's note
 * in schema.ts). That single fact shapes this whole file: `publishedAt` is both
 * the display date and the sort key, so it is the one field a caller may never
 * set directly. It is written by `publish` and by nothing else.
 *
 * ADR 018 is worth remembering while reading: the blog may launch with nothing
 * in it, and `siteSettings.nav.blog` ships `false`. So every read below has to
 * behave well when the table is empty — none of them throw on "no rows", and
 * `getBySlug` returns `null` rather than erroring on an unknown slug.
 *
 * ── Draft visibility ───────────────────────────────────────────────────────
 *
 * `list` and `getBySlug` are **public functions whose row set depends on the
 * caller**: anonymous callers see published posts only, an authenticated caller
 * (i.e. the admin — ADR 006, any Clerk identity is the admin) also sees drafts.
 * That is `isAdmin`'s documented purpose in lib/auth.ts: same shape, different
 * filter, one function instead of a public/admin pair that can drift.
 *
 * The reason this is safe rather than a leak waiting to happen is that a Convex
 * query cannot be authenticated by accident — it needs a client carrying a Clerk
 * token, and `ConvexClientProvider` is mounted only under `/admin` (read its
 * docblock in apps/web). Public routes render from an anonymous client, so
 * "published only" is not a filter the public site opts into, it is the only
 * result it can get. If a future page ever does mount an authenticated client on
 * a public route, that page — not this file — is the bug.
 *
 * ── Writes ────────────────────────────────────────────────────────────────
 *
 * `create` always inserts a draft, and publishing is its own mutation. There is
 * no `published` argument anywhere in this file's `create`/`update` surface, so
 * "flip the flag" and "stamp the date" cannot come apart: a row can never be
 * `published: true` with a `publishedAt` of `null`, which is the state that would
 * put a post in the `by_published_publishedAt` index ahead of everything else and
 * render a blog entry with no date on it.
 */

import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import { isAdmin, requireAdmin } from './lib/auth';
import { createPost, updatePost, publishPost, unpublishPost, removePost, postCreateFields, postPatchFields } from './lib/postOperations';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/* ------------------------------------------------------------------ *
 * Read
 * ------------------------------------------------------------------ */

/**
 * Posts, newest first. Drafts included for an authenticated caller.
 *
 * The published half is read through `by_published_publishedAt` in descending
 * order, which — because `publishedAt` is a fixed-width UTC ISO string (see
 * schema.ts's header) — is genuine reverse-chronological order from the index,
 * with no sort in this function and no rows read that are not returned.
 *
 * For the admin the drafts come first as a block and are then ordered by
 * `_creationTime` in memory. Two reasons for the split: every draft has
 * `publishedAt: null`, so the index cannot order them against each other at all,
 * and the admin listing wants unfinished work at the top rather than interleaved
 * by a date it does not have yet. The in-memory sort is bounded by `limit`.
 *
 * @param limit - page size, clamped to 1–200, default 50. The blog is not
 *   expected to need pagination; if it ever does, this becomes `paginate()`.
 * @returns `Array<Doc<'posts'>>` — whole documents, unshaped, per the package
 *   convention (see snapshot.ts).
 */
export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

    const readPublished = async (take: number): Promise<Doc<'posts'>[]> =>
      await ctx.db
        .query('posts')
        .withIndex('by_published_publishedAt', (q) => q.eq('published', true))
        .order('desc')
        .take(take);

    if (!(await isAdmin(ctx))) {
      return await readPublished(limit);
    }

    const drafts = await ctx.db
      .query('posts')
      .withIndex('by_published_publishedAt', (q) => q.eq('published', false))
      .order('desc')
      .take(limit);

    drafts.sort((a, b) => b._creationTime - a._creationTime);

    const remaining = limit - drafts.length;
    if (remaining <= 0) return drafts;

    return [...drafts, ...(await readPublished(remaining))];
  },
});

/** Every post for native administrative CRUD: drafts first, then newest live. */
export const listAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const [drafts, published] = await Promise.all([
      ctx.db
        .query('posts')
        .withIndex('by_published_publishedAt', (q) => q.eq('published', false))
        .collect(),
      ctx.db
        .query('posts')
        .withIndex('by_published_publishedAt', (q) => q.eq('published', true))
        .order('desc')
        .collect(),
    ]);

    drafts.sort((a, b) => b._creationTime - a._creationTime);
    return [...drafts, ...published];
  },
});

/**
 * One post by slug, or `null`.
 *
 * `null` covers three cases on purpose, because `/blog/[slug]` renders the same
 * 404 for all of them: no such row, a draft read anonymously, and a slug that was
 * renamed. Note that a *malformed* slug is not validated here either — an
 * unknown URL should be a 404, not a 500, and `assertSlug` would make it the
 * latter. The write path is where slug format is enforced.
 *
 * Drafts resolve for an authenticated caller so the admin editor and its preview
 * can read a post through the same function the public page uses. See the file
 * header for why that cannot leak onto a public route.
 *
 * @returns `Doc<'posts'> | null`
 */
export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('posts')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug))
      .first();

    if (row === null) return null;
    if (!row.published && !(await isAdmin(ctx))) return null;

    return row;
  },
});

/* ------------------------------------------------------------------ *
 * Write
 * ------------------------------------------------------------------ */

/**
 * Create a post. Admin-only. **Always a draft.**
 *
 * There is no `published` argument, and Convex rejects arguments a validator
 * does not name, so a client cannot create an already-published post even by
 * trying. Publishing is `publish` below, which is the only writer of
 * `publishedAt` — see the file header for what that invariant buys.
 *
 * @returns `{ postId, slug, revision, created }` — the slug as stored, which is what the admin
 *   router needs to redirect to the editor.
 */
export const create = mutation({
  args: postCreateFields,
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await createPost(ctx, args);
  },
});

/**
 * Patch a post. Admin-only. Absent argument ⇒ field unchanged.
 *
 * Every field is optional and only what is passed is written, so the admin
 * editor can save one field without round-tripping the body. Nothing here is
 * clearable-to-absent because `posts` has no optional stored fields: `tags: []`
 * is how you empty the tag list.
 *
 * `published` and `publishedAt` are absent from the argument list on purpose —
 * see the file header. Use `publish` / `unpublish`.
 *
 * ⚠️ Renaming a slug is a URL change, and the row is the only thing this
 * mutation fixes. Inbound links, any `siteSettings.featured.postSlugs` entry and
 * every `knowledgeDocs` row citing the old path all keep pointing at the old
 * value; the knowledge rows are rebuilt by the phase-4 indexer, the other two are
 * the admin's problem. Slugs are not meant to be reused (lib/validate.ts says so
 * at `assertSlug`), and the admin UI should say as much before allowing an edit.
 *
 * @returns `{ postId, slug, changed, revision }` — a successful no-op returns
 *   the current revision rather than pretending a write occurred.
 */
export const update = mutation({
  args: {
    postId: v.id('posts'),
    expectedRevision: v.optional(v.number()),
    ...postPatchFields,
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await updatePost(ctx, args);
  },
});

/**
 * Publish a post. Admin-only.
 *
 * `publishedAt` is stamped from the server clock on the **first** publish and
 * preserved on every later one, so pulling a post to fix a typo and re-publishing
 * it does not re-date the post or move it to the top of the blog. That is the
 * whole reason this is a separate mutation from `update`.
 *
 * The re-validation before the write is not belt-and-braces: a row can predate a
 * bound, or arrive from an import or the iOS client, and publish is the last
 * moment the site can refuse to render something blank. It re-checks the stored
 * row rather than an argument, which is exactly what `update` cannot do.
 *
 * Publishing an already-published post is a no-op that succeeds and returns the
 * original date.
 *
 * @returns `{ postId, slug, published: true, publishedAt, firstPublish, changed, revision }`
 */
export const publish = mutation({
  args: {
    postId: v.id('posts'),
    expectedRevision: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await publishPost(ctx, args);
  },
});

/**
 * Hide a post from the public site. Admin-only.
 *
 * **`publishedAt` is deliberately left alone.** It is the post's date, not a
 * record of the flag's current state: clearing it would lose the original
 * publication date and make a re-publish look like new writing. The field is
 * therefore null-safe in both directions — it stays `null` on a post that was
 * never published (this call is then a flag-only no-op) and keeps its instant on
 * one that was. `published: false` is what hides the row; `list` and `getBySlug`
 * filter on the flag, never on the date.
 *
 * @returns `{ postId, slug, published: false, publishedAt, changed, revision }` — the date as
 *   stored, so the admin UI can keep showing it next to the draft badge.
 */
export const unpublish = mutation({
  args: {
    postId: v.id('posts'),
    expectedRevision: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await unpublishPost(ctx, args);
  },
});

/**
 * Delete a post for good. Admin-only.
 *
 * Idempotent: deleting a row that is already gone reports `deleted: false` and
 * succeeds, because the likely cause is a double-click or a stale tab and both
 * mean the caller got what it wanted. Same contract as `contactMessages.remove`.
 *
 * Prefer `unpublish` for anything that was ever public — a deleted post's URL
 * breaks every inbound link to it, and there is no undo.
 *
 * @returns `{ postId, deleted, revision }` — `revision` is the last stored
 *   revision, or `null` when the row was already absent.
 */
export const remove = mutation({
  args: {
    postId: v.id('posts'),
    expectedRevision: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await removePost(ctx, args);
  },
});
