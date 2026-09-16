import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { convexTest } from 'convex-test';
import { api, internal } from '../convex/_generated/api';
import { executeManagementPostWrite, parseManagementPostRequest, type ManagementPostRequest } from '../convex/managementPosts';
import { managementSha256 } from '../convex/lib/managementAuth';
import schema from '../convex/schema';

// Explicit loaders work with Bun without Vitest's import.meta.glob transform.
const modules = {
  '../convex/_generated/api.js': () => import('../convex/_generated/api.js'),
  '../convex/posts.ts': () => import('../convex/posts'),
  '../convex/managementPosts.ts': () => import('../convex/managementPosts'),
  '../convex/knowledge.ts': () => import('../convex/knowledge'),
};
const token = `mgmt_${'a'.repeat(64)}`;
const owner = 'management-post-test-owner';
const credentials = { token, environment: 'development' as const };
const fields = {
  slug: 'agent-workflow', title: 'Original title', excerpt: 'A short excerpt.',
  body: 'Original public content.', tags: ['TypeScript'],
  coverImage: { kind: 'image' as const, url: 'https://example.com/cover.png', alt: 'A descriptive cover' },
};
let previous: Record<string, string | undefined>;
beforeEach(() => {
  previous = Object.fromEntries(['ADMIN_CLERK_USER_ID', 'MANAGEMENT_ENVIRONMENT', 'OPENAI_API_KEY'].map((key) => [key, process.env[key]]));
  process.env.ADMIN_CLERK_USER_ID = owner;
  process.env.MANAGEMENT_ENVIRONMENT = 'development';
  delete process.env.OPENAI_API_KEY;
});
afterEach(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
async function setup(scopes: ('content:read' | 'content:write' | 'content:publish')[] = ['content:read', 'content:write', 'content:publish']) {
  const t = convexTest(schema, modules);
  const hashedToken = await managementSha256(token);
  const tokenId = await t.run((ctx) => ctx.db.insert('managementTokens', {
    name: 'Test credential', hashedToken, ownerSubject: owner, environment: 'development', scopes,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(), lastUsedAt: null, revokedAt: null,
  }));
  const write = (args: ManagementPostRequest) =>
    t.mutation(internal.managementPosts.execute, { ...credentials, request: args });
  const create = (idempotencyKey = 'create-test-post') => write({ operation: 'create_post_draft', input: { ...fields, idempotencyKey } });
  const drain = async () => {
    // Let real runAfter(0) timers start before waiting for their actions. This
    // keeps the actual knowledge indexing path under test without fake timers.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  };
  return { t, tokenId, write, create, drain };
}

describe('management post transactions', () => {
  it('creates an invisible draft, retries once, and rejects a reused key with another payload', async () => {
    const { t, create, write } = await setup();
    const first = await create();
    assert.equal(first.status, 'draft');
    assert.equal(first.revision, 1);
    assert.deepEqual(await create(), first);
    assert.deepEqual(await t.query(api.posts.list, {}), []);
    assert.equal(await t.query(api.posts.getBySlug, { slug: fields.slug }), null);
    assert.equal((await t.run((ctx) => ctx.db.query('posts').collect())).length, 1);
    assert.equal((await t.run((ctx) => ctx.db.query('managementReceipts').collect())).length, 1);
    assert.equal((await t.run((ctx) => ctx.db.query('managementAudit').collect())).length, 1);
    await assert.rejects(write({ operation: 'create_post_draft', input: { ...fields, title: 'Different', idempotencyKey: 'create-test-post' } }), /different request/);
  });

  it('stages published edits without leaking to public reads or the knowledge index, then publishes exactly that draft', async () => {
    const { t, create, write, drain } = await setup();
    const first = await create();
    const live = await write({ operation: 'publish_post', input: { postId: first.postId, expectedRevision: 1, expectedDraftRevision: 0, idempotencyKey: 'first-publish' } });
    await drain();
    const knowledgeBefore = await t.run((ctx) => ctx.db.query('knowledgeDocs').collect());
    assert.ok(knowledgeBefore.length > 0);
    const edited = await write({ operation: 'update_post_draft', input: {
      postId: first.postId, expectedRevision: live.revision, expectedDraftRevision: 0,
      patch: { body: 'Private replacement content.', title: 'Private heading' }, idempotencyKey: 'stage-private-edit',
    } });
    assert.equal(edited.revision, live.revision);
    assert.equal(edited.draftRevision, 1);
    assert.equal(edited.status, 'published_with_draft');
    assert.equal((await t.query(api.posts.getBySlug, { slug: fields.slug }))?.body, fields.body);
    await drain();
    assert.deepEqual(await t.run((ctx) => ctx.db.query('knowledgeDocs').collect()), knowledgeBefore);
    const published = await write({ operation: 'publish_post', input: { postId: first.postId, expectedRevision: live.revision, expectedDraftRevision: 1, idempotencyKey: 'publish-private-edit' } });
    assert.equal(published.draftRevision, 0);
    assert.equal(published.status, 'published');
    assert.equal((await t.query(api.posts.getBySlug, { slug: fields.slug }))?.body, 'Private replacement content.');
    assert.equal((await t.run((ctx) => ctx.db.query('managementPostDrafts').collect())).length, 0);
    await drain();
    assert.notDeepEqual(await t.run((ctx) => ctx.db.query('knowledgeDocs').collect()), knowledgeBefore);
  });

  it('rejects stale public or draft revisions without consuming a receipt', async () => {
    const { t, create, write } = await setup();
    const first = await create();
    const update = { postId: first.postId, expectedRevision: 1, expectedDraftRevision: 0, patch: { title: 'Staged title' }, idempotencyKey: 'staged-first' };
    const staged = await write({ operation: 'update_post_draft', input: update });
    assert.deepEqual(await write({ operation: 'update_post_draft', input: update }), staged);
    await assert.rejects(write({ operation: 'update_post_draft', input: { ...update, idempotencyKey: 'staged-second' } }), /staged draft changed/);
    await assert.rejects(write({ operation: 'publish_post', input: { postId: first.postId, expectedRevision: 0, expectedDraftRevision: 1, idempotencyKey: 'stale-publish' } }), /record changed/);
    assert.equal((await t.run((ctx) => ctx.db.query('managementReceipts').collect())).length, 2);
  });

  it('preserves a stale staged edit after a human save and allows explicit revision-checked discard', async () => {
    const { t, create, write } = await setup();
    const first = await create();
    await write({ operation: 'update_post_draft', input: { postId: first.postId, expectedRevision: 1, expectedDraftRevision: 0, patch: { title: 'Agent title' }, idempotencyKey: 'agent-stage' } });
    const human = await t.withIdentity({ subject: owner }).mutation(api.posts.update, { postId: first.postId, expectedRevision: 1, title: 'Human title' });
    await assert.rejects(write({ operation: 'publish_post', input: { postId: first.postId, expectedRevision: human.revision, expectedDraftRevision: 1, idempotencyKey: 'stale-base-publish' } }), /post changed after this draft/);
    assert.equal((await t.run((ctx) => ctx.db.get(first.postId)))?.title, 'Human title');
    assert.equal((await t.run((ctx) => ctx.db.query('managementPostDrafts').unique()))?.title, 'Agent title');
    await assert.rejects(write({ operation: 'discard_post_draft', input: { postId: first.postId, expectedRevision: human.revision, expectedDraftRevision: 0, idempotencyKey: 'stale-discard' } }), /staged draft changed/);
    const discarded = await write({ operation: 'discard_post_draft', input: { postId: first.postId, expectedRevision: human.revision, expectedDraftRevision: 1, idempotencyKey: 'discard-reviewed-draft' } });
    assert.equal(discarded.draftRevision, 0);
    assert.equal(discarded.revision, human.revision + 1);
  });

  it('unpublishes immediately and preserves the publication date and a current staged edit for republishing', async () => {
    const { t, create, write, drain } = await setup();
    const first = await create();
    const live = await write({ operation: 'publish_post', input: { postId: first.postId, expectedRevision: 1, expectedDraftRevision: 0, idempotencyKey: 'publish-first' } });
    const publishedAt = (await t.run((ctx) => ctx.db.get(first.postId)))?.publishedAt;
    await drain();
    await write({ operation: 'update_post_draft', input: { postId: first.postId, expectedRevision: live.revision, expectedDraftRevision: 0, patch: { body: 'Revised text.' }, idempotencyKey: 'stage-revised-text' } });
    const hidden = await write({ operation: 'unpublish_post', input: { postId: first.postId, expectedRevision: live.revision, idempotencyKey: 'unpublish-first' } });
    assert.equal(hidden.status, 'draft');
    assert.equal(hidden.draftRevision, 1);
    assert.equal(await t.query(api.posts.getBySlug, { slug: fields.slug }), null);
    await drain();
    assert.ok((await t.run((ctx) => ctx.db.query('knowledgeDocs').collect())).every((doc) => !doc.published));
    const published = await write({ operation: 'publish_post', input: { postId: first.postId, expectedRevision: hidden.revision, expectedDraftRevision: 1, idempotencyKey: 'republish-revision' } });
    assert.equal(published.status, 'published');
    const row = await t.query(api.posts.getBySlug, { slug: fields.slug });
    assert.equal(row?.publishedAt, publishedAt);
    assert.equal(row?.body, 'Revised text.');
    await drain();
  });

  it('uses the existing content validation and refuses publication without a publish scope', async () => {
    const { t, create, write } = await setup(['content:write']);
    await assert.rejects(write({ operation: 'create_post_draft', input: { ...fields, coverImage: { ...fields.coverImage, url: 'javascript:alert(1)' }, idempotencyKey: 'invalid-cover-image' } }), /http\(s\)/);
    const first = await create();
    await assert.rejects(write({ operation: 'update_post_draft', input: { postId: first.postId, expectedRevision: 1, expectedDraftRevision: 0, patch: { title: '   ' }, idempotencyKey: 'invalid-blank-title' } }), /cannot be empty/);
    await assert.rejects(write({ operation: 'publish_post', input: { postId: first.postId, expectedRevision: 1, expectedDraftRevision: 0, idempotencyKey: 'forbidden-publish' } }), /does not allow/);
    assert.equal((await t.run((ctx) => ctx.db.query('managementReceipts').collect())).length, 1);
    assert.equal((await t.run((ctx) => ctx.db.query('managementPostDrafts').collect())).length, 0);
  });

  it('returns a structured error for malformed and wrong-table post IDs', async () => {
    const { write, tokenId } = await setup();
    for (const postId of ['malformed-post-id', tokenId]) {
      await assert.rejects(write({ operation: 'unpublish_post', input: { postId, expectedRevision: 1, idempotencyKey: 'invalid-post-id' } }), /valid post ID/);
    }
  });

  it('checks revocation on an otherwise valid idempotent retry', async () => {
    const { t, tokenId, create } = await setup();
    await create();
    await t.run((ctx) => ctx.db.patch(tokenId, { revokedAt: new Date().toISOString() }));
    await assert.rejects(create(), /valid management credential/);
    assert.equal((await t.run((ctx) => ctx.db.query('posts').collect())).length, 1);
  });

  it('does not let an old discarded draft revision overwrite a newly started draft', async () => {
    const { create, write } = await setup();
    const first = await create();
    await write({ operation: 'update_post_draft', input: { postId: first.postId, expectedRevision: 1, expectedDraftRevision: 0, patch: { title: 'Discard this' }, idempotencyKey: 'first-edit' } });
    const discarded = await write({ operation: 'discard_post_draft', input: { postId: first.postId, expectedRevision: 1, expectedDraftRevision: 1, idempotencyKey: 'discard-first-edit' } });
    assert.equal(discarded.revision, 2);
    const restarted = await write({ operation: 'update_post_draft', input: { postId: first.postId, expectedRevision: 2, expectedDraftRevision: 0, patch: { title: 'Keep this' }, idempotencyKey: 'second-edit' } });
    assert.equal(restarted.draftRevision, 1);
    await assert.rejects(write({ operation: 'update_post_draft', input: { postId: first.postId, expectedRevision: 1, expectedDraftRevision: 1, patch: { title: 'Stale overwrite' }, idempotencyKey: 'stale-old-edit' } }), /record changed/);
  });

  it('revalidates a staged slug at publish and preserves the draft when another post claimed it', async () => {
    const { t, create, write } = await setup();
    const first = await create();
    await write({ operation: 'update_post_draft', input: { postId: first.postId, expectedRevision: 1, expectedDraftRevision: 0, patch: { slug: 'claimed-later' }, idempotencyKey: 'stage-new-slug' } });
    await t.withIdentity({ subject: owner }).mutation(api.posts.create, { ...fields, slug: 'claimed-later' });
    await assert.rejects(write({ operation: 'publish_post', input: { postId: first.postId, expectedRevision: 1, expectedDraftRevision: 1, idempotencyKey: 'publish-claimed-slug' } }), /already uses the slug/);
    assert.equal((await t.run((ctx) => ctx.db.get(first.postId)))?.published, false);
    assert.equal((await t.run((ctx) => ctx.db.query('managementPostDrafts').unique()))?.revision, 1);
    assert.equal((await t.run((ctx) => ctx.db.query('managementReceipts').collect())).length, 2);
  });

  it('keeps no-op saves and repeat publication at the same revisions without rescheduling indexing', async () => {
    const { t, create, write, drain } = await setup();
    const first = await create();
    const empty = await write({ operation: 'update_post_draft', input: { postId: first.postId, expectedRevision: 1, expectedDraftRevision: 0, patch: {}, idempotencyKey: 'empty-update' } });
    assert.equal(empty.changed, false);
    assert.equal(empty.draftRevision, 0);
    assert.equal(empty.revision, 1);
    const live = await write({ operation: 'publish_post', input: { postId: first.postId, expectedRevision: 1, expectedDraftRevision: 0, idempotencyKey: 'publish-for-noop' } });
    await drain();
    const jobs = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect());
    const noop = await write({ operation: 'publish_post', input: { postId: first.postId, expectedRevision: live.revision, expectedDraftRevision: 0, idempotencyKey: 'repeat-noop-publish' } });
    assert.equal(noop.changed, false);
    assert.equal(noop.revision, live.revision);
    assert.deepEqual(await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect()), jobs);
  });

  it('rolls content, receipts, audits and token usage back together when the transaction fails', async () => {
    const { t, tokenId } = await setup();
    await assert.rejects(t.mutation(async (ctx) => {
      await executeManagementPostWrite(ctx, { ...credentials, operation: 'create_post_draft', input: { ...fields, idempotencyKey: 'rolled-back-create' } });
      throw new Error('Simulated transaction failure');
    }), /Simulated transaction failure/);
    assert.deepEqual(await t.run((ctx) => ctx.db.query('posts').collect()), []);
    assert.deepEqual(await t.run((ctx) => ctx.db.query('managementReceipts').collect()), []);
    assert.deepEqual(await t.run((ctx) => ctx.db.query('managementAudit').collect()), []);
    assert.equal((await t.run((ctx) => ctx.db.get(tokenId)))?.lastUsedAt, null);
  });
});


describe('post management HTTP input parsing', () => {
  it('accepts shared create/media fields and staged partial edits', () => {
    const create = { operation: 'create_post_draft', input: { ...fields, idempotencyKey: 'parser-create' } };
    assert.deepEqual(parseManagementPostRequest(create), create);
    const update = { operation: 'update_post_draft', input: { postId: 'validated-in-transaction', expectedRevision: 1, expectedDraftRevision: 0, patch: { tags: [] }, idempotencyKey: 'parser-update' } };
    assert.deepEqual(parseManagementPostRequest(update), update);
  });

  it('rejects missing fields, wrong types, unknown nested fields and publication bypasses', () => {
    const input = { ...fields, idempotencyKey: 'parser-create' };
    for (const value of [
      null, [], { operation: 'unknown', input },
      { operation: 'create_post_draft', input: {} },
      { operation: 'create_post_draft', input: { ...input, body: 42 } },
      { operation: 'create_post_draft', input: { ...input, published: true } },
      { operation: 'create_post_draft', input: { ...input, tags: [42] } },
      { operation: 'create_post_draft', input: { ...input, coverImage: { ...fields.coverImage, kind: 'script' } } },
      { operation: 'create_post_draft', input: { ...input, coverImage: { ...fields.coverImage, injected: true } } },
      { operation: 'publish_post', input: { postId: 'some-post', expectedRevision: 1, expectedDraftRevision: 0, idempotencyKey: 'parser-publish', patch: {} } },
    ]) {
      assert.throws(() => parseManagementPostRequest(value), /invalid-input/);
    }
  });
});
