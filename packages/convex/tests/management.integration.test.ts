import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { convexTest } from 'convex-test';
import schema from '../convex/schema';
import { managementSha256, type ManagementScope } from '../convex/lib/managementAuth';
import { api } from '../convex/_generated/api';

const modules = {
  '../convex/_generated/api.js': () => import('../convex/_generated/api.js'),
  '../convex/http.ts': () => import('../convex/http'),
  '../convex/managementReads.ts': () => import('../convex/managementReads'),
  '../convex/managementPosts.ts': () => import('../convex/managementPosts'),
  '../convex/managementTokens.ts': () => import('../convex/managementTokens'),
  '../convex/posts.ts': () => import('../convex/posts'),
  '../convex/knowledge.ts': () => import('../convex/knowledge'),
};
const token = `mgmt_${'b'.repeat(64)}`;
const owner = 'management-http-test-owner';
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

async function setup(scopes: ManagementScope[] = ['content:read', 'content:write', 'content:publish']) {
  const t = convexTest(schema, modules);
  const hashedToken = await managementSha256(token);
  const tokenId = await t.run((ctx) => ctx.db.insert('managementTokens', {
    name: 'HTTP integration', hashedToken, ownerSubject: owner, environment: 'development', scopes,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(), lastUsedAt: null, revokedAt: null,
  }));
  const call = (operation: string, input: unknown = {}, environment = 'development') => t.fetch('/management/v1', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ environment, operation, input }),
  });
  return { t, tokenId, call };
}

describe('management HTTP with actual Convex dispatch', () => {
  it('blocks strangers, guessed credentials and read-only tokens without changing content', async () => {
    const { t, tokenId, call } = await setup(['content:read']);
    const input = {
      slug: 'unauthorized-post', title: 'Unauthorized', excerpt: 'Must not save', body: 'Must not save',
      coverImage: { kind: 'image' as const, url: 'https://example.com/image.png', alt: 'Image' }, tags: [],
      idempotencyKey: 'unauthorized-create',
    };
    for (const authorization of ['', `Bearer mgmt_${'c'.repeat(64)}`, 'Bearer user_attacker']) {
      const response = await t.fetch('/management/v1', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: authorization },
        body: JSON.stringify({ environment: 'development', operation: 'create_post_draft', input }),
      });
      assert.equal(response.status, 401);
    }
    assert.equal((await call('create_post_draft', input)).status, 403);
    await t.run((ctx) => ctx.db.patch(tokenId, { scopes: ['content:write'], expiresAt: '2000-01-01T00:00:00.000Z' }));
    assert.equal((await call('create_post_draft', input)).status, 401);
    const { idempotencyKey: _key, ...post } = input;
    for (const client of [t, t.withIdentity({ subject: 'user_attacker' })]) {
      await assert.rejects(client.mutation(api.posts.create, post), /Admin sign-in required|not authorized/);
      await assert.rejects(client.mutation(api.managementTokens.issue, {
        name: 'Attacker', scopes: ['content:publish'], environment: 'development',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }), /Admin sign-in required|not authorized/);
      await assert.rejects(client.query(api.managementTokens.list, {}), /Admin sign-in required|not authorized/);
    }
    for (const table of ['posts', 'managementReceipts', 'managementAudit'] as const) {
      assert.deepEqual(await t.run((ctx) => ctx.db.query(table).collect()), []);
    }
    assert.equal((await t.run((ctx) => ctx.db.get(tokenId)))?.lastUsedAt, null);
  });

  it('creates, reads and publishes through the HTTP router while drafts remain private', async () => {
    const { t, call } = await setup();
    const fields = {
      slug: 'http-draft', title: 'HTTP draft', excerpt: 'Short summary', body: 'Private draft body',
      coverImage: { kind: 'image', url: 'https://example.com/cover.png', alt: 'Cover' }, tags: [],
      idempotencyKey: 'http-create-draft',
    };
    const created = await call('create_post_draft', fields);
    assert.equal(created.status, 200);
    const first = (await created.json()).result;
    assert.equal(await t.query(api.posts.getBySlug, { slug: fields.slug }), null);
    assert.deepEqual((await (await call('create_post_draft', fields)).json()).result, first);
    const detail = await (await call('get_post', { postId: first.postId })).json();
    assert.equal(detail.result.post.body, fields.body);
    assert.equal(detail.result.draft, null);
    const published = await call('publish_post', {
      postId: first.postId, expectedRevision: first.revision, expectedDraftRevision: 0, idempotencyKey: 'http-publish-draft',
    });
    assert.equal(published.status, 200);
    assert.equal((await t.query(api.posts.getBySlug, { slug: fields.slug }))?.body, fields.body);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await t.finishInProgressScheduledFunctions();
  });

  it('enforces inbox scope and exposes readable attachments without upload credentials', async () => {
    const { t, tokenId, call } = await setup();
    const messageId = await t.run((ctx) => ctx.db.insert('contactMessages', {
      name: 'Recruiter', email: 'recruiter@example.com', message: 'A private message', status: 'new',
      createdAt: new Date().toISOString(), attachmentSecret: 'private-upload-capability',
      attachments: [{ name: 'brief.pdf', url: 'https://example.com/brief.pdf', storageKey: 'storage-private-key', size: 128, contentType: 'application/pdf' }],
    }));
    assert.equal((await call('list_inbox')).status, 403);
    assert.equal((await call('get_inbox_message', { messageId })).status, 403);
    await t.run((ctx) => ctx.db.patch(tokenId, { scopes: ['inbox:read'] }));
    const response = await call('get_inbox_message', { messageId });
    assert.equal(response.status, 200);
    const result = (await response.json()).result;
    assert.equal(result.message, 'A private message');
    assert.equal(result.attachments[0].url, 'https://example.com/brief.pdf');
    assert.equal('attachmentSecret' in result, false);
    assert.equal('storageKey' in result.attachments[0], false);
    const list = await (await call('list_inbox')).text();
    assert.ok(!list.includes('private-upload-capability'));
    assert.ok(!list.includes('A private message'));
    assert.equal((await call('list_posts')).status, 403);
  });

  it('returns complete experience details and paginates without leaking omitted bodies', async () => {
    const { t, call } = await setup(['profile:read']);
    const entryId = await t.run((ctx) => ctx.db.insert('experienceEntries', {
      company: 'Example', title: 'Engineer', startDate: '2023-07-01', endDate: null,
      summary: 'Role description', highlights: ['Delivered a product'], skills: ['TypeScript'], projectSlugs: ['example'], sortOrder: 0,
    }));
    await t.run((ctx) => ctx.db.insert('experienceEntries', {
      company: 'Previous', title: 'Engineer', startDate: '2020-01-01', endDate: '2023-06-30',
      summary: 'Earlier role', highlights: [], skills: [], sortOrder: 1,
    }));
    const first = (await (await call('list_experience', { limit: 1 })).json()).result;
    assert.equal(first.items.length, 1);
    assert.equal(first.isDone, false);
    const next = (await (await call('list_experience', { limit: 1, cursor: first.continueCursor })).json()).result;
    assert.equal(next.items.length, 1);
    assert.notEqual(next.items[0]._id, first.items[0]._id);
    const detail = (await (await call('get_experience', { entryId })).json()).result;
    assert.equal(detail.summary, 'Role description');
    assert.deepEqual(detail.highlights, ['Delivered a product']);
    assert.deepEqual(detail.projectSlugs, ['example']);
  });

  it('rejects wrong environments and revoked credentials at the backend boundary', async () => {
    const { t, tokenId, call } = await setup();
    assert.equal((await call('get_management_status', {}, 'production')).status, 403);
    await t.run((ctx) => ctx.db.patch(tokenId, { revokedAt: new Date().toISOString() }));
    const rejected = await call('get_management_status');
    assert.equal(rejected.status, 401);
    assert.ok(!(await rejected.text()).includes(token));
  });

  it('returns safe validation errors for malformed supported writes', async () => {
    const { call } = await setup();
    for (const input of [{ postId: 'sample' }, { postId: 'sample', expectedRevision: 0, expectedDraftRevision: 0, idempotencyKey: 'bad-id' }]) {
      const response = await call('publish_post', input);
      assert.equal(response.status, 400);
      assert.equal((await response.json()).ok, false);
    }
  });
});
