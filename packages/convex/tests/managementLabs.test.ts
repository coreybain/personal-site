import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { convexTest } from 'convex-test';
import { api, internal } from '../convex/_generated/api';
import {
  executeManagementLabWrite, parseManagementLabRequest, type ManagementLabRequest,
} from '../convex/managementLabs';
import { managementSha256 } from '../convex/lib/managementAuth';
import { ManagementLabDraftSchema } from '../../types/src/managementLab';
import schema from '../convex/schema';

const modules = {
  '../convex/_generated/api.js': () => import('../convex/_generated/api.js'),
  '../convex/labs.ts': () => import('../convex/labs'),
  '../convex/managementLabs.ts': () => import('../convex/managementLabs'),
  '../convex/knowledge.ts': () => import('../convex/knowledge'),
};
const token = `mgmt_${'b'.repeat(64)}`;
const owner = 'management-labs-test-owner';
const credentials = { token, environment: 'development' as const };
const fields = {
  slug: 'agent-workspace', title: 'Agent workspace', summary: 'An open-source workspace.',
  repoFullName: 'example/workspace', language: 'TypeScript',
  links: { repo: 'https://github.com/example/workspace', live: 'https://example.com' },
  coverImage: { kind: 'image' as const, url: 'https://example.com/cover.png', alt: 'Workspace screenshot' },
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
  const tokenId = await t.run(async (ctx) => ctx.db.insert('managementTokens', {
    name: 'Labs editor', hashedToken: await managementSha256(token), ownerSubject: owner,
    environment: 'development', scopes,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(), lastUsedAt: null, revokedAt: null,
  }));
  const write = (request: ManagementLabRequest) => t.mutation(internal.managementLabs.execute, { ...credentials, request });
  const create = (idempotencyKey = 'create-lab') => write({ operation: 'create_lab_draft', input: { ...fields, idempotencyKey } });
  const drain = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  };
  return { t, tokenId, write, create, drain };
}

describe('management Lab transactions', () => {
  it('creates unpublished content with untouched generated defaults and retries without duplicate writes', async () => {
    const { t, create, write } = await setup();
    const created = await create();
    assert.equal(created.revision, 1);
    assert.equal(created.draftRevision, 0);
    assert.equal(created.status, 'draft');
    assert.deepEqual(await create(), created);
    const row = await t.run((ctx) => ctx.db.get(created.labId));
    assert.equal(row?.featured, false);
    assert.equal(row?.sortOrder, 0);
    assert.deepEqual(row?.liveStats, { stars: 0, forks: 0, commitsYear: 0, lastPushDaysAgo: 0 });
    assert.deepEqual(await t.query(api.labs.list, {}), []);
    assert.equal(await t.query(api.labs.getBySlug, { slug: fields.slug }), null);
    for (const table of ['labs', 'managementReceipts', 'managementAudit'] as const) {
      assert.equal((await t.run((ctx) => ctx.db.query(table).collect())).length, 1);
    }
    await assert.rejects(write({ operation: 'create_lab_draft', input: { ...fields, title: 'Other', idempotencyKey: 'create-lab' } }), /different request/);
  });

  it('keeps staged content out of public queries and search until explicit publication', async () => {
    const { t, create, write, drain } = await setup();
    const created = await create();
    const live = await write({ operation: 'publish_lab', input: { labId: created.labId, expectedRevision: 1, expectedDraftRevision: 0, idempotencyKey: 'publish-first' } });
    await drain();
    const knowledge = await t.run((ctx) => ctx.db.query('knowledgeDocs').collect());
    assert.ok(knowledge.length > 0);
    const staged = await write({ operation: 'update_lab_draft', input: { labId: created.labId, expectedRevision: live.revision, expectedDraftRevision: 0, patch: { title: 'Private title', summary: 'Private new summary.' }, idempotencyKey: 'stage-private' } });
    assert.equal(staged.revision, live.revision);
    assert.equal(staged.draftRevision, 1);
    assert.equal(staged.status, 'published_with_draft');
    assert.equal((await t.query(api.labs.getBySlug, { slug: fields.slug }))?.summary, fields.summary);
    await drain();
    assert.deepEqual(await t.run((ctx) => ctx.db.query('knowledgeDocs').collect()), knowledge);
    const draft = (await t.run((ctx) => ctx.db.query('managementLabDrafts').unique()))!;
    const { _id, _creationTime, ...body } = draft;
    assert.equal(ManagementLabDraftSchema.safeParse(body).success, true);
    assert.equal('liveStats' in body, false);
    assert.equal('featured' in body, false);
    assert.equal('sortOrder' in body, false);
    const published = await write({ operation: 'publish_lab', input: { labId: created.labId, expectedRevision: live.revision, expectedDraftRevision: 1, idempotencyKey: 'publish-private' } });
    assert.equal(published.status, 'published');
    assert.equal(published.draftRevision, 0);
    assert.equal((await t.query(api.labs.getBySlug, { slug: fields.slug }))?.summary, 'Private new summary.');
    await drain();
    assert.notDeepEqual(await t.run((ctx) => ctx.db.query('knowledgeDocs').collect()), knowledge);
  });

  it('preserves the newest cron statistics and existing curation while publishing a draft', async () => {
    const { t, create, write, drain } = await setup();
    const created = await create();
    const human = await t.withIdentity({ subject: owner }).mutation(api.labs.update, {
      labId: created.labId, expectedRevision: 1, featured: true, sortOrder: 7,
    });
    await write({ operation: 'update_lab_draft', input: { labId: created.labId, expectedRevision: human.revision, expectedDraftRevision: 0, patch: { title: 'Revised title' }, idempotencyKey: 'stage-title' } });
    const stats = { stars: 90, forks: 12, commitsYear: 1_003, lastPushDaysAgo: 0, syncedAt: new Date().toISOString(), lastPushedAt: new Date().toISOString() };
    // The real collector changes only this generated block, without an editorial revision bump.
    await t.run((ctx) => ctx.db.patch(created.labId, { liveStats: stats }));
    await write({ operation: 'publish_lab', input: { labId: created.labId, expectedRevision: human.revision, expectedDraftRevision: 1, idempotencyKey: 'publish-after-cron' } });
    const row = await t.run((ctx) => ctx.db.get(created.labId));
    assert.deepEqual(row?.liveStats, stats);
    assert.equal(row?.featured, true);
    assert.equal(row?.sortOrder, 7);
    assert.equal(row?.title, 'Revised title');
    await drain();
  });

  it('rejects stale base and draft revisions and preserves human edits until reviewed discard', async () => {
    const { t, create, write } = await setup();
    const created = await create();
    const edit = { labId: created.labId, expectedRevision: 1, expectedDraftRevision: 0, patch: { title: 'Agent title' }, idempotencyKey: 'stage-agent' };
    const staged = await write({ operation: 'update_lab_draft', input: edit });
    assert.deepEqual(await write({ operation: 'update_lab_draft', input: edit }), staged);
    await assert.rejects(write({ operation: 'update_lab_draft', input: { ...edit, idempotencyKey: 'stale-draft' } }), /staged draft changed/);
    const human = await t.withIdentity({ subject: owner }).mutation(api.labs.update, { labId: created.labId, expectedRevision: 1, title: 'Human title' });
    await assert.rejects(write({ operation: 'publish_lab', input: { labId: created.labId, expectedRevision: 1, expectedDraftRevision: 1, idempotencyKey: 'stale-public' } }), /record changed/);
    await assert.rejects(write({ operation: 'publish_lab', input: { labId: created.labId, expectedRevision: human.revision, expectedDraftRevision: 1, idempotencyKey: 'stale-base' } }), /lab changed after this draft/);
    assert.equal((await t.run((ctx) => ctx.db.get(created.labId)))?.title, 'Human title');
    const discarded = await write({ operation: 'discard_lab_draft', input: { labId: created.labId, expectedRevision: human.revision, expectedDraftRevision: 1, idempotencyKey: 'discard-reviewed' } });
    assert.equal(discarded.revision, human.revision + 1);
    assert.equal(discarded.draftRevision, 0);
    const newDraft = await write({ operation: 'update_lab_draft', input: { labId: created.labId, expectedRevision: discarded.revision, expectedDraftRevision: 0, patch: { title: 'New draft' }, idempotencyKey: 'new-draft' } });
    assert.equal(newDraft.draftRevision, 1);
    await assert.rejects(write({ operation: 'discard_lab_draft', input: { labId: created.labId, expectedRevision: human.revision, expectedDraftRevision: 1, idempotencyKey: 'old-discard' } }), /record changed/);
  });

  it('checks repository URL agreement and unique slugs/repositories at both save and publish', async () => {
    const { t, create, write } = await setup();
    await assert.rejects(write({ operation: 'create_lab_draft', input: { ...fields, links: { repo: 'https://github.com/wrong/repo' }, idempotencyKey: 'wrong-repo-link' } }), /links.repo points/);
    const created = await create();
    await assert.rejects(write({ operation: 'create_lab_draft', input: { ...fields, slug: 'duplicate-repo', idempotencyKey: 'duplicate-repo' } }), /already tracks/);
    await assert.rejects(write({ operation: 'update_lab_draft', input: { labId: created.labId, expectedRevision: 1, expectedDraftRevision: 0, patch: { repoFullName: 'example/other' }, idempotencyKey: 'partial-repo-mismatch' } }), /links.repo points/);
    await write({ operation: 'update_lab_draft', input: { labId: created.labId, expectedRevision: 1, expectedDraftRevision: 0, patch: { repoFullName: 'example/other', links: { repo: 'https://github.com/example/other.git/' }, slug: 'other-lab' }, idempotencyKey: 'new-repo-and-slug' } });
    const other = await t.withIdentity({ subject: owner }).mutation(api.labs.create, {
      ...fields, slug: 'other-lab', repoFullName: 'example/other', links: { repo: 'https://github.com/example/other' },
    });
    await assert.rejects(write({ operation: 'publish_lab', input: { labId: created.labId, expectedRevision: 1, expectedDraftRevision: 1, idempotencyKey: 'claimed-slug' } }), /already uses the slug/);
    await t.withIdentity({ subject: owner }).mutation(api.labs.update, { labId: other.labId, expectedRevision: 1, slug: 'different-slug' });
    await assert.rejects(write({ operation: 'publish_lab', input: { labId: created.labId, expectedRevision: 1, expectedDraftRevision: 1, idempotencyKey: 'claimed-repo' } }), /already tracks/);
    assert.equal((await t.run((ctx) => ctx.db.get(created.labId)))?.repoFullName, fields.repoFullName);
    assert.equal((await t.run((ctx) => ctx.db.query('managementLabDrafts').unique()))?.revision, 1);
  });

  it('unpublishes immediately, hides search, and keeps current staged changes usable', async () => {
    const { t, create, write, drain } = await setup();
    const created = await create();
    const live = await write({ operation: 'publish_lab', input: { labId: created.labId, expectedRevision: 1, expectedDraftRevision: 0, idempotencyKey: 'publish-first' } });
    await drain();
    await write({ operation: 'update_lab_draft', input: { labId: created.labId, expectedRevision: live.revision, expectedDraftRevision: 0, patch: { title: 'Republished title' }, idempotencyKey: 'stage-before-hide' } });
    const hidden = await write({ operation: 'unpublish_lab', input: { labId: created.labId, expectedRevision: live.revision, idempotencyKey: 'hide-lab' } });
    assert.equal(hidden.draftRevision, 1);
    assert.equal(hidden.status, 'draft');
    assert.equal(await t.query(api.labs.getBySlug, { slug: fields.slug }), null);
    assert.deepEqual(await t.query(api.labs.listFeatured, {}), []);
    await drain();
    assert.ok((await t.run((ctx) => ctx.db.query('knowledgeDocs').collect())).every((row) => !row.published));
    await write({ operation: 'publish_lab', input: { labId: created.labId, expectedRevision: hidden.revision, expectedDraftRevision: 1, idempotencyKey: 'republish-lab' } });
    assert.equal((await t.query(api.labs.getBySlug, { slug: fields.slug }))?.title, 'Republished title');
    await drain();
  });

  it('enforces bounds, scope, valid IDs and revoked credentials before writing', async () => {
    const { t, tokenId, create, write } = await setup(['content:write']);
    await assert.rejects(write({ operation: 'create_lab_draft', input: { ...fields, title: 'x'.repeat(161), idempotencyKey: 'long-title' } }), /160 characters/);
    const created = await create();
    await assert.rejects(write({ operation: 'publish_lab', input: { labId: created.labId, expectedRevision: 1, expectedDraftRevision: 0, idempotencyKey: 'missing-scope' } }), /does not allow/);
    for (const labId of ['bad-id', tokenId]) {
      await assert.rejects(write({ operation: 'discard_lab_draft', input: { labId, expectedRevision: 1, expectedDraftRevision: 0, idempotencyKey: 'wrong-id' } }), /valid lab ID/);
    }
    await t.run((ctx) => ctx.db.patch(tokenId, { revokedAt: new Date().toISOString() }));
    await assert.rejects(create(), /valid management credential/);
    assert.equal((await t.run((ctx) => ctx.db.query('managementReceipts').collect())).length, 1);
  });

  it('does not increment revisions or schedule indexing for unchanged drafts and repeated publication', async () => {
    const { t, create, write, drain } = await setup();
    const created = await create();
    const noop = await write({ operation: 'update_lab_draft', input: { labId: created.labId, expectedRevision: 1, expectedDraftRevision: 0, patch: { title: fields.title }, idempotencyKey: 'same-title' } });
    assert.equal(noop.changed, false);
    assert.equal(noop.draftRevision, 0);
    const published = await write({ operation: 'publish_lab', input: { labId: created.labId, expectedRevision: 1, expectedDraftRevision: 0, idempotencyKey: 'publish-noop' } });
    await drain();
    const jobs = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect());
    const again = await write({ operation: 'publish_lab', input: { labId: created.labId, expectedRevision: published.revision, expectedDraftRevision: 0, idempotencyKey: 'publish-again' } });
    assert.equal(again.changed, false);
    assert.equal(again.revision, published.revision);
    assert.deepEqual(await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect()), jobs);
  });

  it('removes a staged draft with its human-owned base record', async () => {
    const { t, create, write, drain } = await setup();
    const created = await create();
    await write({ operation: 'update_lab_draft', input: { labId: created.labId, expectedRevision: 1, expectedDraftRevision: 0, patch: { title: 'Staged' }, idempotencyKey: 'stage-before-delete' } });
    await t.withIdentity({ subject: owner }).mutation(api.labs.remove, { labId: created.labId, expectedRevision: 1 });
    assert.deepEqual(await t.run((ctx) => ctx.db.query('managementLabDrafts').collect()), []);
    await drain();
  });

  it('rolls back all content, token use, audit and receipt changes together', async () => {
    const { t, tokenId } = await setup();
    await assert.rejects(t.mutation(async (ctx) => {
      await executeManagementLabWrite(ctx, { ...credentials, operation: 'create_lab_draft', input: { ...fields, idempotencyKey: 'rollback' } });
      throw new Error('Rollback transaction');
    }), /Rollback transaction/);
    for (const table of ['labs', 'managementLabDrafts', 'managementReceipts', 'managementAudit'] as const) {
      assert.deepEqual(await t.run((ctx) => ctx.db.query(table).collect()), []);
    }
    assert.equal((await t.run((ctx) => ctx.db.get(tokenId)))?.lastUsedAt, null);
  });
});

describe('Lab management input parsing', () => {
  it('accepts complete editorial creates and partial editorial saves', () => {
    const create = { operation: 'create_lab_draft', input: { ...fields, idempotencyKey: 'parse-create' } };
    assert.deepEqual(parseManagementLabRequest(create), create);
    const edit = { operation: 'update_lab_draft', input: { labId: 'id', expectedRevision: 1, expectedDraftRevision: 0, patch: { links: { repo: fields.links.repo } }, idempotencyKey: 'parse-edit' } };
    assert.deepEqual(parseManagementLabRequest(edit), edit);
  });

  it('rejects hidden publication, generated stats, curation and unknown nested fields', () => {
    const input = { ...fields, idempotencyKey: 'parse-reject' };
    for (const extra of [{ published: true }, { liveStats: {} }, { featured: true }, { sortOrder: 0 }, { revision: 9 }]) {
      assert.throws(() => parseManagementLabRequest({ operation: 'create_lab_draft', input: { ...input, ...extra } }), /invalid-input/);
      assert.throws(() => parseManagementLabRequest({ operation: 'update_lab_draft', input: { labId: 'id', expectedRevision: 1, expectedDraftRevision: 0, idempotencyKey: 'parse-patch', patch: extra } }), /invalid-input/);
    }
    assert.throws(() => parseManagementLabRequest({ operation: 'create_lab_draft', input: { ...input, links: { ...fields.links, injected: true } } }), /invalid-input/);
  });
});
