/**
 * lib/postSchedule.ts — the rules for scheduling, publishing and discarding a
 * post's pending version, shared by the MCP tools, the preview area and the
 * every-minute publisher (`postSchedule.ts`). See docs/plans/preview-area.md.
 *
 * A post's "pending version" is its `managementPostDrafts` row when one exists
 * (a live post with unpublished changes, or a draft edited through MCP), and
 * the row itself otherwise. Scheduling publishes **the latest pending version
 * at publish time**, not a snapshot taken when it was scheduled.
 */
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { publishPost, updatePost, type PostContent } from './postOperations';
import { currentRevision, nextRevision } from './revision';
import { invalid } from './validate';

/** Earliest a schedule may be set, so it cannot race the cron that runs it. */
const MIN_LEAD_MS = 60_000;
/** Latest a schedule may be set. A year is plenty and bounds typos. */
const MAX_LEAD_MS = 366 * 24 * 60 * 60 * 1000;

export type PendingDraft = Doc<'managementPostDrafts'> | null;

export async function pendingDraft(ctx: QueryCtx, postId: Id<'posts'>): Promise<PendingDraft> {
  return await ctx.db.query('managementPostDrafts').withIndex('by_postId', (q) => q.eq('postId', postId)).unique();
}

/** The content a reader would see if the post published now. */
export function pendingContent(row: Doc<'posts'>, draft: PendingDraft): PostContent {
  const source = draft ?? row;
  return {
    slug: source.slug, title: source.title, excerpt: source.excerpt,
    body: source.body, coverImage: source.coverImage, tags: source.tags,
  };
}

/** Identifies one exact version of a post and its draft, for "edited since viewed". */
export function contentKey(row: Doc<'posts'>, draft: PendingDraft): string {
  return `${currentRevision(row.revision)}:${draft?.revision ?? 0}`;
}

export type PostStatus = 'draft' | 'scheduled' | 'failed' | 'published' | 'published_with_changes' | 'changes_scheduled' | 'changes_failed';

export function postStatus(row: Doc<'posts'>, draft: PendingDraft): PostStatus {
  const scheduled = (row.scheduledFor ?? null) !== null;
  const failed = scheduled && (row.scheduleFailure ?? null) !== null;
  if (!row.published) return failed ? 'failed' : scheduled ? 'scheduled' : 'draft';
  if (!draft) return 'published';
  return failed ? 'changes_failed' : scheduled ? 'changes_scheduled' : 'published_with_changes';
}

/** Normalise and bound a requested publish time. Accepts any ISO 8601 instant with an offset. */
export function parseScheduleTime(value: string, now = Date.now()): string {
  const instant = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(instant)) {
    invalid({ code: 'invalid-format', field: 'scheduledFor', message: 'scheduledFor must be an ISO 8601 date and time with a UTC offset, for example 2026-10-03T09:00:00+10:00.' });
  }
  if (instant < now + MIN_LEAD_MS) {
    invalid({ code: 'invalid-format', field: 'scheduledFor', message: 'Schedule at least a minute ahead. To publish now, publish instead.' });
  }
  if (instant > now + MAX_LEAD_MS) {
    invalid({ code: 'invalid-format', field: 'scheduledFor', message: 'Schedule within the next year.' });
  }
  return new Date(instant).toISOString();
}

/** Set or move the schedule. Clears any earlier failure. No revision bump: this is metadata. */
export async function schedulePost(ctx: MutationCtx, row: Doc<'posts'>, draft: PendingDraft, scheduledFor: string) {
  if (row.published && !draft) {
    invalid({ code: 'conflict', field: 'postId', message: 'This post is live and has no pending changes, so there is nothing to schedule.' });
  }
  const at = parseScheduleTime(scheduledFor);
  await ctx.db.patch(row._id, { scheduledFor: at, scheduleAttempts: 0, scheduleFailure: null });
  return { postId: row._id, slug: row.slug, scheduledFor: at };
}

export async function unschedulePost(ctx: MutationCtx, row: Doc<'posts'>) {
  const had = (row.scheduledFor ?? null) !== null;
  if (had || (row.scheduleFailure ?? null) !== null) {
    await ctx.db.patch(row._id, { scheduledFor: null, scheduleAttempts: 0, scheduleFailure: null });
  }
  return { postId: row._id, slug: row.slug, changed: had };
}

/**
 * Why the pending version cannot publish right now, or null. Checked before
 * any write so a scheduled attempt can record a precise reason instead of
 * throwing (a thrown error would roll back the failure record too).
 */
export function publishBlocker(row: Doc<'posts'>, draft: PendingDraft): string | null {
  if (draft && draft.baseRevision !== currentRevision(row.revision)) {
    return 'The post changed after its pending edits were started. Review both versions, then publish or reschedule.';
  }
  const content = pendingContent(row, draft);
  if (!content.title.trim()) return 'The title is empty.';
  if (!content.excerpt.trim()) return 'The excerpt is empty.';
  if (!content.body.trim()) return 'The body is empty.';
  if (!content.coverImage.alt.trim()) return 'The cover image has no alt text.';
  return null;
}

/**
 * Publish the pending version: apply the draft (if any) through `updatePost`,
 * then `publishPost`, then delete the draft. The shared operations keep slug
 * uniqueness, media checks, knowledge indexing, cache revalidation and the
 * schedule/feedback cleanup in one place.
 */
export async function publishPending(
  ctx: MutationCtx,
  row: Doc<'posts'>,
  draft: PendingDraft,
  options: { publishedAt?: string } = {},
) {
  const blocker = publishBlocker(row, draft);
  if (blocker) invalid({ code: 'conflict', field: 'postId', message: blocker });

  let revision = currentRevision(row.revision);
  if (draft) {
    const updated = await updatePost(ctx, { postId: row._id, expectedRevision: revision, ...pendingContent(row, draft) });
    revision = updated.revision;
  }
  const published = await publishPost(ctx, { postId: row._id, expectedRevision: revision }, options);
  if (draft) await ctx.db.delete(draft._id);
  return { ...published, appliedDraft: draft !== null };
}

/** Throw away pending edits. The version moves so a stale (base, draft) pair can never match again. */
export async function discardPending(ctx: MutationCtx, row: Doc<'posts'>, draft: PendingDraft) {
  if (!draft) return { postId: row._id, changed: false, revision: currentRevision(row.revision) };
  await ctx.db.delete(draft._id);
  const revision = nextRevision(row.revision);
  await ctx.db.patch(row._id, { revision });
  // A schedule for "publish these changes" has nothing left to publish.
  if (row.published && (row.scheduledFor ?? null) !== null) {
    await ctx.db.patch(row._id, { scheduledFor: null, scheduleAttempts: 0, scheduleFailure: null });
  }
  return { postId: row._id, changed: true, revision };
}
