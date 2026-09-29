/**
 * preview.ts — the data and actions behind /preview (docs/plans/preview-area.md).
 *
 * Every function takes the browser's preview session secret and rejects
 * without a valid one (`requirePreviewSession`). They are public Convex
 * functions because the website's server calls them anonymously; the session
 * is the credential.
 *
 * Actions that change what is public also take `expectedKey` — the
 * `${revision}:${draftRevision}` of the version on screen — so a button can
 * never publish or discard a version the reviewer has not seen. Every action
 * is written to `managementAudit`, attributed to the session.
 */
import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { unpublishPost } from './lib/postOperations';
import {
  contentKey, discardPending, pendingContent, pendingDraft, postStatus, publishPending,
  schedulePost, unschedulePost, type PendingDraft,
} from './lib/postSchedule';
import { currentRevision } from './lib/revision';
import { nowIso } from './lib/validate';
import { auditPreviewAction, requirePreviewSession } from './previewAccess';

const MAX_NOTE = 2000;
const MAX_QUOTE = 600;
const MAX_CONTEXT = 64;

function fail(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

async function loadPost(ctx: QueryCtx, postId: Id<'posts'>): Promise<{ row: Doc<'posts'>; draft: PendingDraft }> {
  const row = await ctx.db.get(postId);
  if (!row) fail('not-found', 'That post no longer exists.');
  return { row, draft: await pendingDraft(ctx, row._id) };
}

function assertKey(row: Doc<'posts'>, draft: PendingDraft, expectedKey: string): void {
  if (contentKey(row, draft) !== expectedKey) {
    fail('conflict', 'This post changed since you opened it. Reload to see the latest version first.');
  }
}

function summary(row: Doc<'posts'>, draft: PendingDraft, openFeedback: number) {
  const content = pendingContent(row, draft);
  const key = contentKey(row, draft);
  const scheduled = (row.scheduledFor ?? null) !== null;
  return {
    postId: row._id,
    slug: content.slug,
    publicSlug: row.slug,
    title: content.title,
    excerpt: content.excerpt,
    status: postStatus(row, draft),
    published: row.published,
    publishedAt: row.publishedAt,
    scheduledFor: row.scheduledFor ?? null,
    scheduleFailure: row.scheduleFailure ?? null,
    updatedAt: draft?.updatedAt ?? new Date(row._creationTime).toISOString(),
    key,
    editedSinceViewed: scheduled && (row.previewSeenKey ?? null) !== key,
    openFeedback,
  };
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

export const listPosts = query({
  args: { session: v.string() },
  handler: async (ctx, args) => {
    await requirePreviewSession(ctx, args.session);
    const rows = await ctx.db.query('posts').collect();
    const open = new Map<string, number>();
    for (const item of await ctx.db.query('postFeedback').withIndex('by_status', (q) => q.eq('status', 'open')).collect()) {
      open.set(item.postId, (open.get(item.postId) ?? 0) + 1);
    }
    const items = [];
    for (const row of rows) {
      items.push(summary(row, await pendingDraft(ctx, row._id), open.get(row._id) ?? 0));
    }
    // Scheduled first (soonest first), then drafts and pending changes, then live posts newest first.
    const rank = (s: ReturnType<typeof summary>) =>
      s.scheduledFor ? 0 : s.status === 'draft' || s.status === 'published_with_changes' ? 1 : 2;
    return items.sort((a, b) => rank(a) - rank(b)
      || (a.scheduledFor ?? '').localeCompare(b.scheduledFor ?? '')
      || (b.publishedAt ?? b.updatedAt).localeCompare(a.publishedAt ?? a.updatedAt));
  },
});

export const getPost = query({
  args: { session: v.string(), slug: v.string() },
  handler: async (ctx, args) => {
    await requirePreviewSession(ctx, args.session);
    let row = await ctx.db.query('posts').withIndex('by_slug', (q) => q.eq('slug', args.slug)).unique();
    if (!row) {
      // A pending edit may have renamed the slug.
      const renamed = (await ctx.db.query('managementPostDrafts').collect()).find((d) => d.slug === args.slug);
      row = renamed ? await ctx.db.get(renamed.postId) : null;
    }
    if (!row) return null;
    const draft = await pendingDraft(ctx, row._id);
    const feedback = (await ctx.db.query('postFeedback').withIndex('by_postId', (q) => q.eq('postId', row._id)).collect())
      .filter((item) => item.status !== 'archived')
      .map((item) => ({
        id: item._id, anchor: item.anchor, reaction: item.reaction, note: item.note,
        status: item.status, resolution: item.resolution, resolvedAt: item.resolvedAt,
        createdAt: item.createdAt, updatedAt: item.updatedAt,
      }));
    return {
      ...summary(row, draft, feedback.filter((item) => item.status === 'open').length),
      content: pendingContent(row, draft),
      hasPendingChanges: draft !== null,
      feedback,
    };
  },
});

/* ------------------------------------------------------------------ *
 * Viewing
 * ------------------------------------------------------------------ */

export const markSeen = mutation({
  args: { session: v.string(), postId: v.id('posts'), key: v.string() },
  handler: async (ctx, args) => {
    await requirePreviewSession(ctx, args.session);
    const { row, draft } = await loadPost(ctx, args.postId);
    // Only record the version actually on screen; a newer one stays "unseen".
    if (contentKey(row, draft) === args.key && row.previewSeenKey !== args.key) {
      await ctx.db.patch(row._id, { previewSeenKey: args.key });
    }
    return null;
  },
});

/* ------------------------------------------------------------------ *
 * Actions that change what is public
 * ------------------------------------------------------------------ */

const target = { session: v.string(), postId: v.id('posts'), expectedKey: v.string() };

async function begin(ctx: MutationCtx, args: { session: string; postId: Id<'posts'>; expectedKey: string }) {
  const session = await requirePreviewSession(ctx, args.session);
  const { row, draft } = await loadPost(ctx, args.postId);
  assertKey(row, draft, args.expectedKey);
  return { session, row, draft };
}

/** Publish now — a draft goes live, or a live post's pending changes are applied. */
export const publishNow = mutation({
  args: target,
  handler: async (ctx, args) => {
    const { session, row, draft } = await begin(ctx, args);
    const before = currentRevision(row.revision);
    const result = await publishPending(ctx, row, draft);
    await auditPreviewAction(ctx, session, {
      operation: draft && row.published ? 'publish_changes' : 'publish_post', entityId: row._id,
      oldRevision: before, newRevision: result.revision, changedFields: ['published'],
    });
    return { slug: result.slug, publishedAt: result.publishedAt };
  },
});

export const schedule = mutation({
  args: { ...target, scheduledFor: v.string() },
  handler: async (ctx, args) => {
    const { session, row, draft } = await begin(ctx, args);
    const result = await schedulePost(ctx, row, draft, args.scheduledFor);
    // Scheduling the version on screen counts as having seen it.
    await ctx.db.patch(row._id, { previewSeenKey: args.expectedKey });
    await auditPreviewAction(ctx, session, {
      operation: 'schedule_post', entityId: row._id,
      oldRevision: currentRevision(row.revision), newRevision: currentRevision(row.revision), changedFields: ['scheduledFor'],
    });
    return result;
  },
});

export const unschedule = mutation({
  args: { session: v.string(), postId: v.id('posts') },
  handler: async (ctx, args) => {
    const session = await requirePreviewSession(ctx, args.session);
    const { row } = await loadPost(ctx, args.postId);
    const result = await unschedulePost(ctx, row);
    if (result.changed) {
      await auditPreviewAction(ctx, session, {
        operation: 'unschedule_post', entityId: row._id,
        oldRevision: currentRevision(row.revision), newRevision: currentRevision(row.revision), changedFields: ['scheduledFor'],
      });
    }
    return result;
  },
});

/** Move back to draft: hide a live post, keeping its date and any pending edits. */
export const unpublish = mutation({
  args: target,
  handler: async (ctx, args) => {
    const { session, row, draft } = await begin(ctx, args);
    const before = currentRevision(row.revision);
    const result = await unpublishPost(ctx, { postId: row._id, expectedRevision: before });
    // Keep a current pending edit usable, as the MCP unpublish does.
    if (draft && draft.baseRevision === before && result.changed) {
      await ctx.db.patch(draft._id, { baseRevision: result.revision });
    }
    await auditPreviewAction(ctx, session, {
      operation: 'unpublish_post', entityId: row._id,
      oldRevision: before, newRevision: result.revision, changedFields: result.changed ? ['published'] : [],
    });
    return { changed: result.changed };
  },
});

/** Throw away a post's pending edits, keeping the published (or base draft) version. */
export const discardChanges = mutation({
  args: target,
  handler: async (ctx, args) => {
    const { session, row, draft } = await begin(ctx, args);
    const result = await discardPending(ctx, row, draft);
    await auditPreviewAction(ctx, session, {
      operation: 'discard_post_draft', entityId: row._id,
      oldRevision: currentRevision(row.revision), newRevision: result.revision, changedFields: result.changed ? ['draft'] : [],
    });
    return { changed: result.changed };
  },
});

/* ------------------------------------------------------------------ *
 * Feedback
 * ------------------------------------------------------------------ */

const reaction = v.union(v.literal('love'), v.literal('unclear'), v.literal('dislike'), v.null());
const anchor = v.union(
  v.object({ kind: v.literal('text'), quote: v.string(), prefix: v.string(), suffix: v.string() }),
  v.object({ kind: v.literal('image'), src: v.string(), alt: v.string() }),
);

function cleanNote(note: string | null | undefined): string | null {
  if (note === undefined || note === null) return null;
  const trimmed = note.trim();
  if (trimmed.length > MAX_NOTE) fail('invalid-input', `Notes are limited to ${MAX_NOTE} characters.`);
  return trimmed.length ? trimmed : null;
}

async function loadFeedback(ctx: QueryCtx, id: Id<'postFeedback'>) {
  const item = await ctx.db.get(id);
  if (!item || item.status === 'archived') fail('not-found', 'That feedback no longer exists.');
  return item;
}

export const addFeedback = mutation({
  args: { session: v.string(), postId: v.id('posts'), anchor, reaction, note: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    await requirePreviewSession(ctx, args.session);
    await loadPost(ctx, args.postId);
    const note = cleanNote(args.note);
    if (args.reaction === null && note === null) fail('invalid-input', 'Add a reaction or a note.');
    const clipped = args.anchor.kind === 'text'
      ? {
        kind: 'text' as const,
        quote: args.anchor.quote.trim().slice(0, MAX_QUOTE),
        prefix: args.anchor.prefix.slice(-MAX_CONTEXT),
        suffix: args.anchor.suffix.slice(0, MAX_CONTEXT),
      }
      : { kind: 'image' as const, src: args.anchor.src.slice(0, 2048), alt: args.anchor.alt.slice(0, 400) };
    if (clipped.kind === 'text' && !clipped.quote) fail('invalid-input', 'Select some text first.');
    const now = nowIso();
    const id = await ctx.db.insert('postFeedback', {
      postId: args.postId, anchor: clipped, reaction: args.reaction, note,
      status: 'open', resolution: null, resolvedAt: null, createdAt: now, updatedAt: now,
    });
    return { id };
  },
});

/** Change the reaction and/or note. Clearing both removes the item. */
export const updateFeedback = mutation({
  args: {
    session: v.string(), feedbackId: v.id('postFeedback'),
    reaction: v.optional(reaction), note: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    await requirePreviewSession(ctx, args.session);
    const item = await loadFeedback(ctx, args.feedbackId);
    const next = {
      reaction: args.reaction === undefined ? item.reaction : args.reaction,
      note: args.note === undefined ? item.note : cleanNote(args.note),
    };
    if (next.reaction === null && next.note === null) {
      await ctx.db.delete(item._id);
      return { removed: true as const };
    }
    // Editing reopens: new instructions need acting on.
    await ctx.db.patch(item._id, { ...next, status: 'open', updatedAt: nowIso() });
    return { removed: false as const };
  },
});

export const reopenFeedback = mutation({
  args: { session: v.string(), feedbackId: v.id('postFeedback') },
  handler: async (ctx, args) => {
    await requirePreviewSession(ctx, args.session);
    const item = await loadFeedback(ctx, args.feedbackId);
    await ctx.db.patch(item._id, { status: 'open', updatedAt: nowIso() });
    return null;
  },
});

export const removeFeedback = mutation({
  args: { session: v.string(), feedbackId: v.id('postFeedback') },
  handler: async (ctx, args) => {
    await requirePreviewSession(ctx, args.session);
    const item = await loadFeedback(ctx, args.feedbackId);
    await ctx.db.delete(item._id);
    return null;
  },
});
