/** Shared post operations. Entry points authorize before calling these functions. */
import type { WithoutSystemFields } from 'convex/server';
import { type Infer, v } from 'convex/values';
import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { assertExpectedRevision, currentRevision, nextRevision } from './revision';
import { assertRange, assertSlugUnique, assertText, assertUrl, invalid, nowIso } from './validate';
import { mediaAsset } from '../schema';

export const postCreateFields = {
  slug: v.string(), title: v.string(), excerpt: v.string(), body: v.string(),
  coverImage: mediaAsset, tags: v.array(v.string()),
};
export const postPatchFields = {
  slug: v.optional(v.string()), title: v.optional(v.string()),
  excerpt: v.optional(v.string()), body: v.optional(v.string()),
  coverImage: v.optional(mediaAsset), tags: v.optional(v.array(v.string())),
};
const postContent = v.object(postCreateFields);
const postPatch = v.object(postPatchFields);
export type PostContent = Infer<typeof postContent>;
export type PostPatch = Infer<typeof postPatch>;
type ExistingPostArgs = { postId: Id<'posts'>; expectedRevision?: number };

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

/** Validate and normalize the same patch for browser saves and staged agent edits. */
export async function preparePostPatch(
  ctx: MutationCtx,
  row: PostContent & { _id: Id<'posts'> },
  args: PostPatch,
): Promise<PostPatch> {
  const patch: PostPatch = {};

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

  return patch;
}

export async function createPost(ctx: MutationCtx, args: PostContent) {
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
    revision: 1,
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
  return {
    postId,
    slug: row.slug,
    revision: 1 as const,
    created: true,
  };
}

export async function updatePost(ctx: MutationCtx, args: ExistingPostArgs & PostPatch) {
  const row = await ctx.db.get(args.postId);
  if (row === null) {
    invalid({
      code: 'not-found',
      field: 'postId',
      message: 'That post no longer exists.',
    });
  }

  assertExpectedRevision(row.revision, args.expectedRevision);

  const patch: Partial<WithoutSystemFields<Doc<'posts'>>> = await preparePostPatch(ctx, row, args);

  const changed = Object.keys(patch).length > 0;
  if (changed) {
    patch.revision = nextRevision(row.revision);
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

  // A live post's public page changed, so its cached copies must go now —
  // cover images included, which the indexer ignores.
  if (row.published && changed) {
    await ctx.scheduler.runAfter(0, internal.siteCache.revalidatePosts, {});
  }

  if (row.published && INDEXED_FIELDS.some((field) => field in patch)) {
    await ctx.scheduler.runAfter(0, internal.knowledge.indexSource, {
      sourceType: 'post',
      sourceSlug: patch.slug ?? row.slug,
    });
  }

  return {
    postId: row._id,
    slug: patch.slug ?? row.slug,
    changed,
    revision: changed ? nextRevision(row.revision) : currentRevision(row.revision),
  };
}

export async function publishPost(
  ctx: MutationCtx,
  args: ExistingPostArgs,
  options: {
    /**
     * The date to stamp on a *first* publish. A scheduled publish passes its
     * scheduled instant, so the post's public date is the time it was meant to
     * go live rather than the minute the cron happened to run. Ignored when the
     * post already has a date — dates never move.
     */
    publishedAt?: string;
  } = {},
) {
  const row = await ctx.db.get(args.postId);
  if (row === null) {
    invalid({
      code: 'not-found',
      field: 'postId',
      message: 'That post no longer exists.',
    });
  }

  assertExpectedRevision(row.revision, args.expectedRevision);

  /* ---- the row must be renderable before it is reachable ----------- */

  assertText(row.title, 'title', MAX_TITLE);
  assertText(row.excerpt, 'excerpt', MAX_EXCERPT);
  assertText(row.body, 'body', MAX_BODY);
  assertMedia(row.coverImage, 'coverImage');

  /* ---- flip, and stamp the date only the first time ---------------- */

  const firstPublish = row.publishedAt === null;
  const publishedAt = row.publishedAt ?? options.publishedAt ?? nowIso();

  const changed = !row.published || firstPublish;
  const revision = changed ? nextRevision(row.revision) : currentRevision(row.revision);
  if (changed) {
    await ctx.db.patch(row._id, { published: true, publishedAt, revision });

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
    await ctx.scheduler.runAfter(0, internal.siteCache.revalidatePosts, {});
  }

  // Going live settles the post's editorial state, whichever path published
  // it (MCP, the preview area or the scheduler): any schedule is spent, and the
  // review feedback is archived — kept on record, hidden from the preview.
  await clearSchedule(ctx, row);
  await archiveFeedback(ctx, row._id);

  return {
    postId: row._id,
    slug: row.slug,
    published: true as const,
    publishedAt,
    firstPublish,
    changed,
    revision,
  };
}

export async function unpublishPost(ctx: MutationCtx, args: ExistingPostArgs) {
  const row = await ctx.db.get(args.postId);
  if (row === null) {
    invalid({
      code: 'not-found',
      field: 'postId',
      message: 'That post no longer exists.',
    });
  }

  assertExpectedRevision(row.revision, args.expectedRevision);
  const changed = row.published;
  const revision = changed ? nextRevision(row.revision) : currentRevision(row.revision);
  if (changed) {
    await ctx.db.patch(row._id, { published: false, revision });

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
    await ctx.scheduler.runAfter(0, internal.siteCache.revalidatePosts, {});
  }

  // "Move back to draft" also cancels a pending schedule: a post taken down on
  // purpose must not reappear by itself at some later minute.
  await clearSchedule(ctx, row);

  return {
    postId: row._id,
    slug: row.slug,
    published: false as const,
    publishedAt: row.publishedAt,
    changed,
    revision,
  };
}

export async function removePost(ctx: MutationCtx, args: ExistingPostArgs) {
  const row = await ctx.db.get(args.postId);
  if (row === null) {
    return { postId: args.postId, deleted: false, revision: null };
  }

  assertExpectedRevision(row.revision, args.expectedRevision);
  const revision = currentRevision(row.revision);
  const staged = await ctx.db.query('managementPostDrafts')
    .withIndex('by_postId', (q) => q.eq('postId', row._id)).unique();
  if (staged) await ctx.db.delete(staged._id);
  // Review feedback belongs to the post; with no post it can never be shown.
  for (const item of await ctx.db.query('postFeedback').withIndex('by_postId', (q) => q.eq('postId', row._id)).collect()) {
    await ctx.db.delete(item._id);
  }
  await ctx.db.delete(row._id);
  if (row.published) await ctx.scheduler.runAfter(0, internal.siteCache.revalidatePosts, {});

  // PHASE 4 — knowledge indexing (ADR 015). A deleted post leaves orphaned
  // `knowledgeDocs` rows behind, which are the one kind of stale index entry
  // that cannot be repaired by re-indexing the source (there is no source
  // left). They are deleted outright, via the `by_source` index.
  await ctx.scheduler.runAfter(0, internal.knowledge.removeSource, {
    sourceType: 'post',
    sourceSlug: row.slug,
  });

  // The Uploadfile copy of `coverImage` is a separate concern (ADR 020): the
  // CDN object outlives the row, and reaping it needs `storageKey` and an
  // action that can call Uploadfile's delete API. Phase 2's Uploadfile work
  // owns that decision; nothing here should assume the file is gone.

  return { postId: args.postId, deleted: true, revision };
}

/* ------------------------------------------------------------------ *
 * Scheduling and feedback side effects of going live
 * ------------------------------------------------------------------ */

/** Spend any schedule on the row. Scheduling fields are metadata: no revision bump. */
async function clearSchedule(ctx: MutationCtx, row: Doc<'posts'>): Promise<void> {
  if (
    (row.scheduledFor ?? null) === null &&
    (row.scheduleFailure ?? null) === null &&
    (row.scheduleAttempts ?? 0) === 0
  ) {
    return;
  }
  await ctx.db.patch(row._id, { scheduledFor: null, scheduleFailure: null, scheduleAttempts: 0 });
}

/** Archive every open or resolved feedback item on a post that has just gone live. */
async function archiveFeedback(ctx: MutationCtx, postId: Id<'posts'>): Promise<void> {
  const items = await ctx.db.query('postFeedback').withIndex('by_postId', (q) => q.eq('postId', postId)).collect();
  const now = nowIso();
  for (const item of items) {
    if (item.status !== 'archived') await ctx.db.patch(item._id, { status: 'archived', updatedAt: now });
  }
}
