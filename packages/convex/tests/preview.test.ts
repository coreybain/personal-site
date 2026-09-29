import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { convexTest } from 'convex-test';
import { api, internal } from '../convex/_generated/api';
import { executeManagementPostWrite } from '../convex/managementPosts';
import { managementSha256 } from '../convex/lib/managementAuth';
import { MAX_ATTEMPTS } from '../convex/postSchedule';
import { normaliseCode } from '../convex/previewAccess';
import schema from '../convex/schema';

const modules = {
  '../convex/_generated/api.js': () => import('../convex/_generated/api.js'),
  '../convex/posts.ts': () => import('../convex/posts'),
  '../convex/managementPosts.ts': () => import('../convex/managementPosts'),
  '../convex/knowledge.ts': () => import('../convex/knowledge'),
  '../convex/siteCache.ts': () => import('../convex/siteCache'),
  '../convex/alerts.ts': () => import('../convex/alerts'),
  '../convex/postSchedule.ts': () => import('../convex/postSchedule'),
  '../convex/previewAccess.ts': () => import('../convex/previewAccess'),
  '../convex/preview.ts': () => import('../convex/preview'),
};
const owner = 'preview-test-owner';
const token = `mgmt_${'b'.repeat(64)}`;
const credentials = { token, environment: 'development' as const };
const fields = {
  slug: 'scheduled-post', title: 'A scheduled post', excerpt: 'A short excerpt.',
  body: 'The body of the post.', tags: ['Testing'],
  coverImage: { kind: 'image' as const, url: 'https://example.com/cover.png', alt: 'A descriptive cover' },
};
const hour = 60 * 60 * 1000;
const future = (ms = hour) => new Date(Date.now() + ms).toISOString();

let previous: Record<string, string | undefined>;
beforeEach(() => {
  previous = Object.fromEntries(['ADMIN_CLERK_USER_ID', 'MANAGEMENT_ENVIRONMENT', 'OPENAI_API_KEY', 'SITE_ORIGIN', 'SITE_REVALIDATE_SECRET', 'RESEND_API_KEY']
    .map((key) => [key, process.env[key]]));
  process.env.ADMIN_CLERK_USER_ID = owner;
  process.env.MANAGEMENT_ENVIRONMENT = 'development';
  for (const key of ['OPENAI_API_KEY', 'SITE_ORIGIN', 'SITE_REVALIDATE_SECRET', 'RESEND_API_KEY']) delete process.env[key];
});
afterEach(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert('managementTokens', {
      name: 'Test', hashedToken: await managementSha256(token), ownerSubject: owner, environment: 'development',
      scopes: ['content:read', 'content:write', 'content:publish'], expiresAt: future(24 * hour), lastUsedAt: null, revokedAt: null,
    });
  });
  const manage = (operation: 'create_preview_code' | 'revoke_preview_sessions') =>
    t.mutation(internal.previewAccess.manage, { ...credentials, operation });
  const signIn = async () => {
    const issued = await manage('create_preview_code') as { code: string };
    const redeemed = await t.mutation(api.previewAccess.redeem, { code: issued.code });
    assert.equal(redeemed.ok, true);
    return (redeemed as { session: string }).session;
  };
  const createDraft = () => t.run(async (ctx) => ctx.db.insert('posts', {
    ...fields, revision: 1, published: false, publishedAt: null,
  }));
  return { t, manage, signIn, createDraft };
}

describe('preview access', () => {
  it('issues single-use codes that open a session, and refuses reuse', async () => {
    const { t, manage } = await setup();
    const { code } = await manage('create_preview_code') as { code: string };
    assert.match(code, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    const loose = code.toLowerCase().replace('-', ' ');
    const first = await t.mutation(api.previewAccess.redeem, { code: loose });
    assert.equal(first.ok, true);
    const again = await t.mutation(api.previewAccess.redeem, { code });
    assert.equal(again.ok, false);
    // The stored code is a hash, never the code itself.
    const rows = await t.run((ctx) => ctx.db.query('previewCodes').collect());
    assert.ok(rows.every((row) => !JSON.stringify(row).includes(code.replace('-', ''))));
  });

  it('maps look-alike characters when normalising', () => {
    assert.equal(normaliseCode('k7qf 2m9x'), 'K7QF-2M9X');
    assert.equal(normaliseCode('ab1o-cdef'), 'AB10-CDEF');
  });

  it('locks code entry after repeated wrong codes', async () => {
    const { t, manage } = await setup();
    for (let i = 0; i < 10; i += 1) {
      assert.equal((await t.mutation(api.previewAccess.redeem, { code: 'AAAA-AAAA' })).ok, false);
    }
    const { code } = await manage('create_preview_code') as { code: string };
    await assert.rejects(t.mutation(api.previewAccess.redeem, { code }), /Too many incorrect codes/);
  });

  it('rejects preview reads without a valid session, and after revoke-all', async () => {
    const { t, manage, signIn } = await setup();
    await assert.rejects(t.query(api.preview.listPosts, { session: `pvs_${'0'.repeat(64)}` }), /session has ended/);
    const session = await signIn();
    assert.deepEqual(await t.query(api.preview.listPosts, { session }), []);
    assert.equal((await t.mutation(api.previewAccess.touch, { session })).valid, true);
    await manage('revoke_preview_sessions');
    await assert.rejects(t.query(api.preview.listPosts, { session }), /session has ended/);
  });

  it('signs one browser out without affecting another', async () => {
    const { t, signIn } = await setup();
    const a = await signIn();
    const b = await signIn();
    await t.mutation(api.previewAccess.signOut, { session: a });
    await assert.rejects(t.query(api.preview.listPosts, { session: a }));
    assert.deepEqual(await t.query(api.preview.listPosts, { session: b }), []);
  });
});

describe('scheduling', () => {
  it('rejects times in the past or within a minute', async () => {
    const { t, signIn, createDraft } = await setup();
    const session = await signIn();
    const postId = await createDraft();
    await assert.rejects(t.mutation(api.preview.schedule, { session, postId, expectedKey: '1:0', scheduledFor: new Date(Date.now() - hour).toISOString() }), /at least a minute ahead/);
    await assert.rejects(t.mutation(api.preview.schedule, { session, postId, expectedKey: '1:0', scheduledFor: '2026-10-03T09:00:00' }), /UTC offset/);
  });

  it('refuses an action on a version the reviewer has not seen', async () => {
    const { t, signIn, createDraft } = await setup();
    const session = await signIn();
    const postId = await createDraft();
    await assert.rejects(t.mutation(api.preview.publishNow, { session, postId, expectedKey: '0:0' }), /changed since you opened it/);
  });

  it('publishes a due post at its scheduled time and archives its feedback', async () => {
    const { t, signIn, createDraft } = await setup();
    const session = await signIn();
    const postId = await createDraft();
    await t.mutation(api.preview.addFeedback, {
      session, postId, reaction: 'dislike', note: 'Too long',
      anchor: { kind: 'text', quote: 'body of the post', prefix: 'The ', suffix: '.' },
    });
    await t.mutation(api.preview.schedule, { session, postId, expectedKey: '1:0', scheduledFor: future() });
    const list = await t.query(api.preview.listPosts, { session });
    assert.equal(list[0]?.status, 'scheduled');
    assert.equal(list[0]?.editedSinceViewed, false);

    const due = new Date(Date.now() - 1000).toISOString();
    await t.run((ctx) => ctx.db.patch(postId, { scheduledFor: due }));
    const outcome = await t.mutation(internal.postSchedule.publishScheduled, { postId, scheduledFor: due });
    assert.equal(outcome.published, true);
    const row = await t.run((ctx) => ctx.db.get(postId));
    assert.equal(row?.published, true);
    assert.equal(row?.publishedAt, due);
    assert.equal(row?.scheduledFor, null);
    const feedback = await t.run((ctx) => ctx.db.query('postFeedback').collect());
    assert.deepEqual(feedback.map((item) => item.status), ['archived']);
  });

  it('records a precise failure when pending edits are stale, and stays unpublished', async () => {
    const { t, createDraft } = await setup();
    const postId = await createDraft();
    const due = new Date(Date.now() - 1000).toISOString();
    await t.run(async (ctx) => {
      await ctx.db.insert('managementPostDrafts', { postId, baseRevision: 0, revision: 1, ...fields, title: 'Edited', updatedAt: due });
      await ctx.db.patch(postId, { scheduledFor: due });
    });
    const outcome = await t.mutation(internal.postSchedule.publishScheduled, { postId, scheduledFor: due });
    assert.equal(outcome.published, false);
    const row = await t.run((ctx) => ctx.db.get(postId));
    assert.equal(row?.published, false);
    assert.match(row?.scheduleFailure?.message ?? '', /changed after its pending edits/);
  });

  it('gives up after the attempt limit', async () => {
    const { t, createDraft } = await setup();
    const postId = await createDraft();
    await t.run((ctx) => ctx.db.patch(postId, { scheduledFor: new Date(Date.now() - 1000).toISOString(), scheduleAttempts: MAX_ATTEMPTS }));
    await t.mutation(internal.postSchedule.publishDue, {});
    const row = await t.run((ctx) => ctx.db.get(postId));
    assert.match(row?.scheduleFailure?.message ?? '', /kept failing/);
    assert.equal(row?.published, false);
  });

  it('flags a scheduled post edited since it was viewed', async () => {
    const { t, signIn, createDraft } = await setup();
    const session = await signIn();
    const postId = await createDraft();
    await t.mutation(api.preview.schedule, { session, postId, expectedKey: '1:0', scheduledFor: future() });
    await t.run((ctx) => ctx.db.insert('managementPostDrafts', { postId, baseRevision: 1, revision: 1, ...fields, title: 'Edited', updatedAt: future(0) }));
    const [item] = await t.query(api.preview.listPosts, { session });
    assert.equal(item?.editedSinceViewed, true);
    assert.equal(item?.title, 'Edited');
    await t.mutation(api.preview.markSeen, { session, postId, key: item!.key });
    assert.equal((await t.query(api.preview.listPosts, { session }))[0]?.editedSinceViewed, false);
  });

  it('publishes a live post\'s pending changes and removes the draft', async () => {
    const { t, signIn } = await setup();
    const session = await signIn();
    const postId = await t.run((ctx) => ctx.db.insert('posts', { ...fields, revision: 2, published: true, publishedAt: '2026-09-01T00:00:00.000Z' }));
    await t.run((ctx) => ctx.db.insert('managementPostDrafts', { postId, baseRevision: 2, revision: 1, ...fields, title: 'Better title', updatedAt: future(0) }));
    assert.equal((await t.query(api.preview.getPost, { session, slug: fields.slug }))?.status, 'published_with_changes');
    await t.mutation(api.preview.publishNow, { session, postId, expectedKey: '2:1' });
    const row = await t.run((ctx) => ctx.db.get(postId));
    assert.equal(row?.title, 'Better title');
    assert.equal(row?.publishedAt, '2026-09-01T00:00:00.000Z');
    assert.equal((await t.run((ctx) => ctx.db.query('managementPostDrafts').collect())).length, 0);
  });

  it('moving a post back to draft cancels its schedule', async () => {
    const { t, signIn } = await setup();
    const session = await signIn();
    const postId = await t.run((ctx) => ctx.db.insert('posts', { ...fields, revision: 2, published: true, publishedAt: '2026-09-01T00:00:00.000Z' }));
    await t.run((ctx) => ctx.db.insert('managementPostDrafts', { postId, baseRevision: 2, revision: 1, ...fields, updatedAt: future(0) }));
    await t.mutation(api.preview.schedule, { session, postId, expectedKey: '2:1', scheduledFor: future() });
    await t.mutation(api.preview.unpublish, { session, postId, expectedKey: '2:1' });
    const row = await t.run((ctx) => ctx.db.get(postId));
    assert.equal(row?.published, false);
    assert.equal(row?.scheduledFor, null);
  });
});

describe('feedback', () => {
  it('adds a reaction, then a note, and removes the item when both are cleared', async () => {
    const { t, signIn, createDraft } = await setup();
    const session = await signIn();
    const postId = await createDraft();
    const { id } = await t.mutation(api.preview.addFeedback, {
      session, postId, reaction: 'unclear', anchor: { kind: 'image', src: 'https://example.com/a.png', alt: 'Diagram' },
    });
    await t.mutation(api.preview.updateFeedback, { session, feedbackId: id, note: 'Label the axes 👀' });
    const item = (await t.query(api.preview.getPost, { session, slug: fields.slug }))?.feedback[0];
    assert.equal(item?.reaction, 'unclear');
    assert.equal(item?.note, 'Label the axes 👀');
    const removed = await t.mutation(api.preview.updateFeedback, { session, feedbackId: id, reaction: null, note: null });
    assert.equal(removed.removed, true);
  });

  it('resolves through management with a short reply, but never a standing love', async () => {
    const { t, signIn, createDraft } = await setup();
    const session = await signIn();
    const postId = await createDraft();
    const anchor = { kind: 'text' as const, quote: 'body', prefix: 'The ', suffix: ' of' };
    const love = await t.mutation(api.preview.addFeedback, { session, postId, reaction: 'love', anchor });
    const dislike = await t.mutation(api.preview.addFeedback, { session, postId, reaction: 'dislike', anchor });
    const resolve = (feedbackId: string, reply: string, key: string) => t.run((ctx) => executeManagementPostWrite(ctx, {
      ...credentials, operation: 'resolve_post_feedback', input: { feedbackId, reply, idempotencyKey: key },
    }));
    await assert.rejects(resolve(love.id, 'Kept it.', 'love'), /standing/);
    await assert.rejects(resolve(dislike.id, 'One. Two. Three. Four.', 'long'), /one to three sentences/);
    await resolve(dislike.id, 'Rewrote the opening to lead with the failure. Cut the second example.', 'ok');
    const items = (await t.query(api.preview.getPost, { session, slug: fields.slug }))?.feedback ?? [];
    const resolved = items.find((item) => item.id === dislike.id);
    assert.equal(resolved?.status, 'resolved');
    assert.match(resolved?.resolution ?? '', /Rewrote the opening/);
    await t.mutation(api.preview.reopenFeedback, { session, feedbackId: dislike.id });
    assert.equal((await t.query(api.preview.getPost, { session, slug: fields.slug }))?.feedback.find((item) => item.id === dislike.id)?.status, 'open');
  });
});
