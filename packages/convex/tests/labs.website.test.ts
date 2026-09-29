import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { convexTest } from 'convex-test';
import { api, internal } from '../convex/_generated/api';
import { managementSha256 } from '../convex/lib/managementAuth';
import schema from '../convex/schema';

/**
 * Website-only Labs (ADR 008): a private-source product published under its
 * product name. The rows must never hold a repository identifier, repo link or
 * GitHub figure, because `labs.list` is public and returns whole documents.
 */

const modules = {
  '../convex/_generated/api.js': () => import('../convex/_generated/api.js'),
  '../convex/labs.ts': () => import('../convex/labs'),
  '../convex/managementLabs.ts': () => import('../convex/managementLabs'),
  '../convex/knowledge.ts': () => import('../convex/knowledge'),
  '../convex/snapshotBuild.ts': () => import('../convex/snapshotBuild'),
};
const owner = 'website-labs-test-owner';
const token = `mgmt_${'c'.repeat(64)}`;
const cover = { kind: 'image' as const, url: 'https://example.com/cover.png', alt: 'Product screenshot' };
const website = {
  slug: 'product', title: 'Product', summary: 'A private-source product.', kind: 'website' as const,
  language: 'TypeScript', coverImage: cover, links: { live: 'https://product.example' },
};
const repository = {
  slug: 'workspace', title: 'Workspace', summary: 'An open-source workspace.',
  repoFullName: 'example/workspace', language: 'TypeScript', coverImage: cover,
  links: { repo: 'https://github.com/example/workspace' },
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

function setup() {
  const t = convexTest(schema, modules);
  return { t, admin: t.withIdentity({ subject: owner }) };
}

async function rejects(run: () => Promise<unknown>, field: string) {
  await assert.rejects(run, (error: unknown) => {
    const data = (error as { data?: unknown }).data;
    return (typeof data === 'string' ? data : JSON.stringify(data ?? String(error))).includes(`"field":"${field}"`);
  });
}

describe('website-only Labs', () => {
  it('stores and publishes no repository identifier, link or GitHub stats', async () => {
    const { t, admin } = setup();
    const created = await admin.mutation(api.labs.create, website);
    await admin.mutation(api.labs.publish, { labId: created.labId, expectedRevision: 1 });
    await t.finishInProgressScheduledFunctions();

    const [row] = await t.query(api.labs.list, {});
    assert.equal(row?.kind, 'website');
    assert.equal(row?.links.live, 'https://product.example');
    for (const key of ['repoFullName', 'liveStats'] as const) assert.equal(key in (row ?? {}), false, key);
    assert.equal('repo' in (row?.links ?? {}), false, 'links.repo');
  });

  it('refuses repository fields on a website Lab and requires its website link', async () => {
    const { admin } = setup();
    await rejects(() => admin.mutation(api.labs.create, { ...website, repoFullName: 'example/private' }), 'repoFullName');
    await rejects(
      () => admin.mutation(api.labs.create, { ...website, links: { live: 'https://product.example', repo: 'https://github.com/example/private' } }),
      'links.repo',
    );
    await rejects(() => admin.mutation(api.labs.create, { ...website, links: {} }), 'links.live');
  });

  it('keeps the kind fixed and refuses a repository added by a later edit', async () => {
    const { admin } = setup();
    const created = await admin.mutation(api.labs.create, website);
    await rejects(
      () => admin.mutation(api.labs.update, { labId: created.labId, expectedRevision: 1, repoFullName: 'example/private' }),
      'repoFullName',
    );
    await rejects(
      () => admin.mutation(api.labs.update, { labId: created.labId, expectedRevision: 1, kind: 'repository' }),
      'kind',
    );
    const saved = await admin.mutation(api.labs.update, { labId: created.labId, expectedRevision: 1, summary: 'Updated.' });
    assert.equal(saved.changed, true);
  });

  it('still requires both repository fields on a repository Lab', async () => {
    const { admin } = setup();
    const { repoFullName: _omitted, ...withoutName } = repository;
    await rejects(() => admin.mutation(api.labs.create, withoutName), 'repoFullName');
    await rejects(() => admin.mutation(api.labs.create, { ...repository, links: {} }), 'links.repo');
    const created = await admin.mutation(api.labs.create, repository);
    assert.equal(created.created, true);
  });

  it('is never handed to the GitHub sync', async () => {
    const { t, admin } = setup();
    await admin.mutation(api.labs.create, website);
    await admin.mutation(api.labs.create, repository);
    const repos = await t.query(internal.snapshotBuild.curatedLabRepos, {});
    assert.deepEqual(repos.map((repo) => repo.slug), ['workspace']);
  });

  it('round-trips through a management draft and publish without gaining repository keys', async () => {
    const { t } = setup();
    await t.run(async (ctx) => ctx.db.insert('managementTokens', {
      name: 'Labs editor', hashedToken: await managementSha256(token), ownerSubject: owner,
      environment: 'development', scopes: ['content:read', 'content:write', 'content:publish'],
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(), lastUsedAt: null, revokedAt: null,
    }));
    const credentials = { token, environment: 'development' as const };
    const created = await t.mutation(internal.managementLabs.execute, {
      ...credentials, request: { operation: 'create_lab_draft', input: { ...website, idempotencyKey: 'website-create' } },
    });
    await t.mutation(internal.managementLabs.execute, {
      ...credentials,
      request: {
        operation: 'update_lab_draft',
        input: { labId: created.labId, expectedRevision: 1, expectedDraftRevision: 0, patch: { summary: 'Drafted.' }, idempotencyKey: 'website-update' },
      },
    });
    await t.mutation(internal.managementLabs.execute, {
      ...credentials,
      request: { operation: 'publish_lab', input: { labId: created.labId, expectedRevision: 1, expectedDraftRevision: 1, idempotencyKey: 'website-publish' } },
    });
    await t.finishInProgressScheduledFunctions();

    const [row] = await t.query(api.labs.list, {});
    assert.equal(row?.summary, 'Drafted.');
    assert.equal(row?.kind, 'website');
    assert.equal('repoFullName' in (row ?? {}), false);
    assert.equal('repo' in (row?.links ?? {}), false);
  });
});
