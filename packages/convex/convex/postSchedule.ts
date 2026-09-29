/**
 * postSchedule.ts — publishes scheduled posts. Run every minute by `crons.ts`.
 *
 * `publishDue` finds schedules whose time has come, counts an attempt on each,
 * and hands each post to its own `publishScheduled` mutation, so one post
 * failing cannot roll back another. A deterministic problem (stale pending
 * edits, an empty field) is recorded as a failure straight away with its
 * reason. An unexpected error rolls its mutation back and the post is simply
 * picked up again next minute; after `MAX_ATTEMPTS` the schedule is marked
 * failed. Either way the post stays unpublished, the preview list and MCP show
 * "Scheduled — failed", and an email goes out (`alerts.ts`).
 *
 * On success the post's date is its scheduled time (first publish only), the
 * pending edits are applied, the site cache is revalidated and a "went live"
 * email is sent. See docs/plans/preview-area.md.
 */
import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalMutation } from './_generated/server';
import { pendingContent, pendingDraft, publishBlocker, publishPending } from './lib/postSchedule';
import { nowIso } from './lib/validate';

/** Fifteen one-minute attempts before giving up on a schedule. */
export const MAX_ATTEMPTS = 15;

export const publishDue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = new Date().toISOString();
    // Strings sort after null/undefined in Convex, so this range is exactly
    // "scheduled, and due".
    const due = await ctx.db.query('posts')
      .withIndex('by_scheduledFor', (q) => q.gt('scheduledFor', '').lte('scheduledFor', now))
      .take(25);

    let dispatched = 0;
    for (const row of due) {
      if ((row.scheduleFailure ?? null) !== null) continue;
      const attempts = (row.scheduleAttempts ?? 0) + 1;
      if (attempts > MAX_ATTEMPTS) {
        const reason = `Publishing kept failing after ${MAX_ATTEMPTS} attempts, one a minute. Check the Convex logs for the error.`;
        await ctx.db.patch(row._id, {
          scheduleFailure: { message: reason, failedAt: nowIso(), attempts: MAX_ATTEMPTS },
        });
        await ctx.scheduler.runAfter(0, internal.alerts.scheduledPostAlert, {
          kind: 'failed', title: row.title, slug: row.slug, reason,
        });
        continue;
      }
      await ctx.db.patch(row._id, { scheduleAttempts: attempts });
      await ctx.scheduler.runAfter(0, internal.postSchedule.publishScheduled, {
        postId: row._id, scheduledFor: row.scheduledFor!,
      });
      dispatched += 1;
    }
    return { due: due.length, dispatched };
  },
});

export const publishScheduled = internalMutation({
  args: { postId: v.id('posts'), scheduledFor: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.postId);
    // Cancelled, rescheduled or deleted since dispatch: nothing to do.
    if (!row || row.scheduledFor !== args.scheduledFor || (row.scheduleFailure ?? null) !== null) {
      return { published: false as const, reason: 'no-longer-scheduled' };
    }

    const draft = await pendingDraft(ctx, row._id);
    const title = pendingContent(row, draft).title;
    const blocker = publishBlocker(row, draft);
    if (blocker) {
      await ctx.db.patch(row._id, {
        scheduleFailure: { message: blocker, failedAt: nowIso(), attempts: row.scheduleAttempts ?? 1 },
      });
      await ctx.scheduler.runAfter(0, internal.alerts.scheduledPostAlert, {
        kind: 'failed', title, slug: row.slug, reason: blocker,
      });
      return { published: false as const, reason: blocker };
    }

    const result = await publishPending(ctx, row, draft, { publishedAt: args.scheduledFor });
    await ctx.scheduler.runAfter(0, internal.alerts.scheduledPostAlert, {
      kind: 'published', title, slug: result.slug,
    });
    return { published: true as const, slug: result.slug, publishedAt: result.publishedAt };
  },
});
