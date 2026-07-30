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

import type { WithoutSystemFields } from 'convex/server';
import { type Infer, v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import { isAdmin, requireAdmin } from './lib/auth';
import {
  assertRange,
  assertSlugUnique,
  assertText,
  assertUrl,
  invalid,
  nowIso,
} from './lib/validate';
import { mediaAsset } from './schema';

/* ------------------------------------------------------------------ *
 * Bounds
 *
 * `PostSchema` bounds `title`, `excerpt` and `body` as non-empty and
 * nothing more, so — unlike the contact form, where every max mirrors a
 * `.max()` in `@home/types` — the numbers below are storage sanity
 * bounds rather than contract bounds. They are set far above anything
 * this blog will plausibly hold; their job is to keep a stuck paste or a
 * runaway import from writing a document that approaches Convex's 1 MB
 * per-document limit, where the failure would be an opaque write error
 * instead of a field-level message.
 *
 * The lower bound is the one that mirrors the contract: `assertText`
 * rejects a whitespace-only value, which `v.string()` accepts and which
 * would render as a blank heading on the public site.
 * ------------------------------------------------------------------ */

const MAX_TITLE = 200;
const MAX_EXCERPT = 400;
/** Markdown body. ~120 KB is a very long essay and a fifth of the document limit. */
const MAX_BODY = 120_000;
const MAX_TAG = 40;
/** More than a dozen tags on one post is a taxonomy problem, not a long post. */
const MAX_TAGS = 12;
/** Alt text. Long enough for a genuine description, short enough to be one. */
const MAX_ALT = 400;
const MAX_CAPTION = 500;
/** Pixel dimensions. Above this is a paste of the wrong number, not an image. */
const MAX_PIXELS = 20_000;

/** Default page size for `list`. The blog is small; this is not a paginated feed. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/* ------------------------------------------------------------------ *
 * Local validation
 * ------------------------------------------------------------------ */

/**
 * The stored media shape, derived from schema.ts's exported validator rather
 * than re-declared — so this file cannot describe a `MediaAsset` the table
 * would reject.
 */
type MediaAsset = Infer<typeof mediaAsset>;

/**
 * Assert an uploaded asset is renderable. Mirrors `MediaAssetSchema`.
 *
 * ⚠️ This is duplicated in funEntries.ts (and belongs in lib/validate.ts). It
 * lives here for now because the phase-2 backend files were written in parallel
 * and lib/ was owned by another change; promoting it is a mechanical follow-up.
 *
 * The `url` check is the load-bearing one: `assertUrl` allows only `http(s)`,
 * which is what stops a `javascript:` payload reaching the `src` of an image the
 * public site renders. `alt` is required because there is no decorative media in
 * this model (schema.ts says so at the field).
 *
 * `sanitised` is deliberately NOT checked here. The ADR 009 publish gate applies
 * to `projects.media` — real client screenshots pending sign-off — and a blog
 * cover image is not client work, which is why the field is optional on the
 * shared validator in the first place.
 */
function assertMedia(asset: MediaAsset, field: string): void {
  assertUrl(asset.url, `${field}.url`);
  assertText(asset.alt, `${field}.alt`, MAX_ALT);

  // A caption may legitimately be empty (`z.string()`, not non-empty), so only
  // the upper bound applies.
  if (asset.caption !== undefined && asset.caption.length > MAX_CAPTION) {
    invalid({
      code: 'out-of-range',
      field: `${field}.caption`,
      message: `${field}.caption must be ${MAX_CAPTION} characters or fewer.`,
    });
  }

  // Optional in the contract, but the dashboard and the blog index render at
  // fixed dimensions to hold the CLS budget, so a present-but-nonsense value is
  // worse than an absent one.
  for (const [name, value] of [
    ['width', asset.width],
    ['height', asset.height],
  ] as const) {
    if (value === undefined) continue;
    assertRange(value, `${field}.${name}`, 1, MAX_PIXELS);
    if (!Number.isInteger(value)) {
      invalid({
        code: 'invalid-format',
        field: `${field}.${name}`,
        message: `${field}.${name} must be a whole number of pixels.`,
      });
    }
  }
}

/**
 * Trim, drop blanks, and de-duplicate case-insensitively, preserving order.
 *
 * A blank tag is dropped rather than rejected: the admin form submits a
 * comma-separated string, and a trailing comma is a typing artefact rather than
 * something worth failing a save over. A duplicate is dropped for the same
 * reason. An over-long tag IS rejected, because that is someone putting a
 * sentence in a tag field and silently truncating it would be worse.
 */
function normaliseTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of tags) {
    const tag = raw.trim();
    if (tag.length === 0) continue;
    if (tag.length > MAX_TAG) {
      invalid({
        code: 'out-of-range',
        field: 'tags',
        message: `Each tag must be ${MAX_TAG} characters or fewer (got ${JSON.stringify(raw)}).`,
      });
    }
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }

  if (out.length > MAX_TAGS) {
    invalid({
      code: 'out-of-range',
      field: 'tags',
      message: `A post may carry at most ${MAX_TAGS} tags (got ${out.length}).`,
    });
  }

  return out;
}

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
      .take(limit);

    drafts.sort((a, b) => b._creationTime - a._creationTime);

    const remaining = limit - drafts.length;
    if (remaining <= 0) return drafts;

    return [...drafts, ...(await readPublished(remaining))];
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
 * @returns `{ postId, slug }` — the slug as stored, which is what the admin
 *   router needs to redirect to the editor.
 */
export const create = mutation({
  args: {
    slug: v.string(),
    title: v.string(),
    excerpt: v.string(),
    body: v.string(),
    coverImage: mediaAsset,
    tags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    // Format + uniqueness in one call; `assertSlugUnique` runs `assertSlug`
    // first, so a malformed slug fails before the indexed lookup.
    await assertSlugUnique(ctx.db, 'posts', args.slug);

    assertText(args.title, 'title', MAX_TITLE);
    assertText(args.excerpt, 'excerpt', MAX_EXCERPT);
    assertText(args.body, 'body', MAX_BODY);
    assertMedia(args.coverImage, 'coverImage');

    // Annotated with the table's own document type, so a field this file writes
    // that the schema does not describe — or vice versa — is a typecheck failure
    // here rather than a rejected write at runtime.
    const row: WithoutSystemFields<Doc<'posts'>> = {
      slug: args.slug,
      title: args.title.trim(),
      excerpt: args.excerpt.trim(),
      // NOT trimmed beyond the ends: markdown's meaning depends on its internal
      // whitespace (indented code blocks, hard line breaks).
      body: args.body.trim(),
      coverImage: args.coverImage,
      tags: normaliseTags(args.tags),
      published: false,
      publishedAt: null,
    };

    const postId = await ctx.db.insert('posts', row);
    return { postId, slug: row.slug };
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
 * @returns `{ postId, slug, changed }` — `changed` is false when the call passed
 *   no fields, which is a successful no-op rather than an error.
 */
export const update = mutation({
  args: {
    postId: v.id('posts'),
    slug: v.optional(v.string()),
    title: v.optional(v.string()),
    excerpt: v.optional(v.string()),
    body: v.optional(v.string()),
    coverImage: v.optional(mediaAsset),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const row = await ctx.db.get(args.postId);
    if (row === null) {
      invalid({
        code: 'not-found',
        field: 'postId',
        message: 'That post no longer exists.',
      });
    }

    const patch: Partial<WithoutSystemFields<Doc<'posts'>>> = {};

    if (args.slug !== undefined && args.slug !== row.slug) {
      // `ignoreId` is not strictly needed here (the slug differs from this row's
      // own), but it is passed anyway so the call stays correct if the guard
      // above is ever relaxed.
      await assertSlugUnique(ctx.db, 'posts', args.slug, row._id);
      patch.slug = args.slug;
    }

    if (args.title !== undefined) {
      assertText(args.title, 'title', MAX_TITLE);
      patch.title = args.title.trim();
    }

    if (args.excerpt !== undefined) {
      assertText(args.excerpt, 'excerpt', MAX_EXCERPT);
      patch.excerpt = args.excerpt.trim();
    }

    if (args.body !== undefined) {
      assertText(args.body, 'body', MAX_BODY);
      patch.body = args.body.trim();
    }

    if (args.coverImage !== undefined) {
      assertMedia(args.coverImage, 'coverImage');
      patch.coverImage = args.coverImage;
    }

    if (args.tags !== undefined) {
      patch.tags = normaliseTags(args.tags);
    }

    const changed = Object.keys(patch).length > 0;
    if (changed) {
      await ctx.db.patch(row._id, patch);
    }

    // PHASE 4 — knowledge indexing (ADR 015). Editing a *published* post changes
    // text that is already embedded in `knowledgeDocs`, so this is the second
    // place the indexer hooks in (the first is `publish` below). Same call, and
    // it belongs here rather than in the indexer's cron because an answer citing
    // a paragraph the post no longer contains is the failure worth avoiding.
    //
    // A rename is handled first and is NOT gated on `published`: the old slug's
    // document is orphaned either way (see the ⚠️ above), and an orphan is the
    // one kind of stale index entry re-indexing the source cannot repair.
    if (patch.slug !== undefined) {
      await ctx.scheduler.runAfter(0, internal.knowledge.removeSource, {
        sourceType: 'post',
        sourceSlug: row.slug,
      });
    }

    // Every field this mutation writes except `coverImage` is indexed text, and
    // a cover image is neither embedded nor quotable — see `knowledge.
    // sourceForIndex`, which excludes it deliberately.
    const INDEXED_FIELDS = ['slug', 'title', 'excerpt', 'body', 'tags'] as const;

    if (row.published && INDEXED_FIELDS.some((field) => field in patch)) {
      await ctx.scheduler.runAfter(0, internal.knowledge.indexSource, {
        sourceType: 'post',
        sourceSlug: patch.slug ?? row.slug,
      });
    }

    return { postId: row._id, slug: patch.slug ?? row.slug, changed };
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
 * @returns `{ postId, slug, published: true, publishedAt, firstPublish }`
 */
export const publish = mutation({
  args: { postId: v.id('posts') },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const row = await ctx.db.get(args.postId);
    if (row === null) {
      invalid({
        code: 'not-found',
        field: 'postId',
        message: 'That post no longer exists.',
      });
    }

    /* ---- the row must be renderable before it is reachable ----------- */

    assertText(row.title, 'title', MAX_TITLE);
    assertText(row.excerpt, 'excerpt', MAX_EXCERPT);
    assertText(row.body, 'body', MAX_BODY);
    assertMedia(row.coverImage, 'coverImage');

    /* ---- flip, and stamp the date only the first time ---------------- */

    const firstPublish = row.publishedAt === null;
    const publishedAt = row.publishedAt ?? nowIso();

    if (!row.published || firstPublish) {
      await ctx.db.patch(row._id, { published: true, publishedAt });

      // PHASE 4 — knowledge indexing (ADR 015). This is the hook: publishing a
      // project, lab or post re-indexes it into `knowledgeDocs` with embeddings
      // for Ask Corey. It cannot be done inline — embedding needs `fetch`, and a
      // mutation cannot — so it is scheduled, which also means a provider outage
      // delays the index rather than failing the publish. `runAfter(0, …)` is
      // part of this transaction: a rolled-back publish never schedules the job.
      //
      // The action upserts on (`sourceType: 'post'`, `sourceSlug: slug`) — the
      // `by_source` index exists for that — and `knowledgeDocs.published`
      // mirrors this row's flag. Inside the `if` on purpose: re-publishing an
      // already-published post stays the documented no-op. The re-index tool is
      // `bunx convex run knowledge:backfill`.
      await ctx.scheduler.runAfter(0, internal.knowledge.indexSource, {
        sourceType: 'post',
        sourceSlug: row.slug,
      });
    }

    return {
      postId: row._id,
      slug: row.slug,
      published: true as const,
      publishedAt,
      firstPublish,
    };
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
 * @returns `{ postId, slug, published: false, publishedAt }` — the date as
 *   stored, so the admin UI can keep showing it next to the draft badge.
 */
export const unpublish = mutation({
  args: { postId: v.id('posts') },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const row = await ctx.db.get(args.postId);
    if (row === null) {
      invalid({
        code: 'not-found',
        field: 'postId',
        message: 'That post no longer exists.',
      });
    }

    if (row.published) {
      await ctx.db.patch(row._id, { published: false });

      // PHASE 4 — knowledge indexing (ADR 015). Unpublishing must reach the
      // index too, or Ask Corey will keep quoting a page that now 404s. The
      // cheap form is a patch, not a delete — `knowledgeDocs.published` exists
      // as the retrieval filter's second line of defence — so this needs no
      // embedding call and is a plain internal mutation, not the action.
      await ctx.scheduler.runAfter(0, internal.knowledge.setSourcePublished, {
        sourceType: 'post',
        sourceSlug: row.slug,
        published: false,
      });
    }

    return {
      postId: row._id,
      slug: row.slug,
      published: false as const,
      publishedAt: row.publishedAt,
    };
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
 * @returns `{ postId, deleted }`
 */
export const remove = mutation({
  args: { postId: v.id('posts') },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const row = await ctx.db.get(args.postId);
    if (row === null) {
      return { postId: args.postId, deleted: false };
    }

    await ctx.db.delete(row._id);

    // PHASE 4 — knowledge indexing (ADR 015). A deleted post leaves orphaned
    // `knowledgeDocs` rows behind, which are the one kind of stale index entry
    // that cannot be repaired by re-indexing the source (there is no source
    // left). They are deleted outright, via the `by_source` index.
    await ctx.scheduler.runAfter(0, internal.knowledge.removeSource, {
      sourceType: 'post',
      sourceSlug: row.slug,
    });

    // The UploadThing copy of `coverImage` is a separate concern (ADR 010): the
    // CDN object outlives the row, and reaping it needs `storageKey` and an
    // action that can call UploadThing's delete API. Phase 2's UploadThing work
    // owns that decision; nothing here should assume the file is gone.

    return { postId: args.postId, deleted: true };
  },
});
