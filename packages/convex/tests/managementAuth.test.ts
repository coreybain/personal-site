import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { MutationCtx } from '../convex/_generated/server';
import type { Doc } from '../convex/_generated/dataModel';
import { issue, issueForMachine, list, revoke, revokeForMachine } from '../convex/managementTokens';
import { requireManagement, managementSha256, type ManagementActor } from '../convex/lib/managementAuth';
import {
  beginManagementWrite, completeManagementWrite, deleteExpiredManagementReceipts,
  MANAGEMENT_RECEIPT_CLEANUP_LIMIT,
} from '../convex/lib/managementWrites';
import {
  ManagementAuditSchema, ManagementReceiptSchema, ManagementTokenSchema,
  ManagementTokenIssueSchema,
} from '../../types/src/management';

type Row = Record<string, unknown> & { _id: string; _creationTime: number };
function database() {
  const tables = new Map<string, Row[]>();
  const writes: Array<{ action: string; table?: string; value?: unknown }> = [];
  let sequence = 0;
  const getRows = (table: string) => tables.get(table) ?? [];
  const db = {
    query: (table: string) => {
      let conditions: Array<(row: Row) => boolean> = [];
      let descending = false;
      const results = () => getRows(table).filter((row) => conditions.every((check) => check(row)))
        .sort((a, b) => descending ? b._creationTime - a._creationTime : a._creationTime - b._creationTime);
      const builder = {
        withIndex: (_name: string, callback?: (q: unknown) => unknown) => {
          const index = {
            eq: (field: string, value: unknown) => { conditions.push((row) => row[field] === value); return index; },
            lte: (field: string, value: string) => { conditions.push((row) => String(row[field]) <= value); return index; },
          };
          callback?.(index);
          return builder;
        },
        order: (direction: string) => { descending = direction === 'desc'; return builder; },
        unique: async () => {
          const found = results();
          if (found.length > 1) throw new Error('Duplicate unique index result');
          return found[0] ? structuredClone(found[0]) : null;
        },
        collect: async () => results(),
        take: async (limit: number) => results().slice(0, limit),
      };
      return builder;
    },
    insert: async (table: string, value: Record<string, unknown>) => {
      const row = { ...value, _id: `${table}-${++sequence}`, _creationTime: Date.now() };
      tables.set(table, [...getRows(table), row]);
      writes.push({ action: 'insert', table, value });
      return row._id;
    },
    get: async (id: string) => {
      const row = [...tables.values()].flat().find((item) => item._id === id);
      return row ? structuredClone(row) : null;
    },
    patch: async (id: string, value: Record<string, unknown>) => {
      const row = [...tables.values()].flat().find((item) => item._id === id);
      if (!row) throw new Error('Missing fixture');
      Object.assign(row, value);
      writes.push({ action: 'patch', value });
    },
    delete: async (id: string) => {
      for (const [table, rows] of tables) tables.set(table, rows.filter((row) => row._id !== id));
      writes.push({ action: 'delete' });
    },
  };
  const ctx = {
    db,
    auth: { getUserIdentity: async () => ({ subject: 'owner', tokenIdentifier: 'clerk|owner' }) },
  } as unknown as MutationCtx;
  return { ctx, db, tables, writes, getRows };
}

// Exercise each actual registered function's authorization wrapper as well as
// the domain helper; no Convex deployment or production credentials are needed.
function handler<Args, Result>(fn: unknown) {
  return (fn as { _handler: (ctx: MutationCtx, args: Args) => Promise<Result> })._handler;
}
const issueHandler = handler<{
  name: string; scopes: Doc<'managementTokens'>['scopes'];
  environment: 'development' | 'production'; expiresAt: string;
}, { token: string; tokenId: string }>(issue);
const listHandler = handler<Record<string, never>, Array<Record<string, unknown>>>(list);
const revokeHandler = handler<{ tokenId: string }, { alreadyRevoked: boolean; revokedAt: string }>(revoke);
const issueArgs = () => ({
  name: 'Local agent', scopes: ['content:read', 'content:write'] as Doc<'managementTokens'>['scopes'],
  environment: 'development' as const, expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
});
const previousOwner = process.env.ADMIN_CLERK_USER_ID;
const previousEnvironment = process.env.MANAGEMENT_ENVIRONMENT;
beforeEach(() => {
  process.env.ADMIN_CLERK_USER_ID = 'owner';
  process.env.MANAGEMENT_ENVIRONMENT = 'development';
});
afterEach(() => {
  if (previousOwner === undefined) delete process.env.ADMIN_CLERK_USER_ID;
  else process.env.ADMIN_CLERK_USER_ID = previousOwner;
  if (previousEnvironment === undefined) delete process.env.MANAGEMENT_ENVIRONMENT;
  else process.env.MANAGEMENT_ENVIRONMENT = previousEnvironment;
});

describe('management credential lifecycle', () => {
  test('issues unique secrets, persists only their digest, and lists no secret material', async () => {
    const { ctx, getRows } = database();
    const first = await issueHandler(ctx, issueArgs());
    const second = await issueHandler(ctx, issueArgs());
    expect(first.token).toMatch(/^mgmt_[a-f0-9]{64}$/);
    expect(first.token).not.toBe(second.token);
    const row = getRows('managementTokens')[0]!;
    expect(row.hashedToken).toBe(await managementSha256(first.token));
    expect(row.ownerSubject).toBe('owner');
    expect(row).not.toHaveProperty('token');
    const { _id, _creationTime, ...body } = row;
    expect(ManagementTokenSchema.safeParse(body).success).toBe(true);
    const visible = await listHandler(ctx, {});
    expect(visible).toHaveLength(2);
    expect(visible[0]).not.toHaveProperty('hashedToken');
    expect(visible[0]).not.toHaveProperty('token');
  });

  test('owner-only issue, list and revoke reject a different signed-in subject', async () => {
    const { ctx, getRows } = database();
    ctx.auth.getUserIdentity = async () => ({ subject: 'visitor' }) as never;
    await expect(issueHandler(ctx, issueArgs())).rejects.toMatchObject({ data: { code: 'forbidden' } });
    await expect(listHandler(ctx, {})).rejects.toMatchObject({ data: { code: 'forbidden' } });
    await expect(revokeHandler(ctx, { tokenId: 'unknown' })).rejects.toMatchObject({ data: { code: 'forbidden' } });
    expect(getRows('managementTokens')).toHaveLength(0);
  });

  test('unsigned callers cannot issue and bootstrap is internal only', async () => {
    const { ctx } = database();
    ctx.auth.getUserIdentity = async () => null;
    await expect(issueHandler(ctx, issueArgs())).rejects.toMatchObject({ data: { code: 'unauthenticated' } });
    expect(issueForMachine).toHaveProperty('isInternal', true);
    expect(issueForMachine).not.toHaveProperty('isPublic');
    expect(revokeForMachine).toHaveProperty('isInternal', true);
    expect(revokeForMachine).not.toHaveProperty('isPublic');
  });

  test('empty scopes, invalid expiry and a mismatching deployment cannot issue', async () => {
    const { ctx, getRows } = database();
    for (const args of [
      { ...issueArgs(), scopes: [] },
      { ...issueArgs(), expiresAt: new Date(Date.now() - 1).toISOString() },
      { ...issueArgs(), expiresAt: '2030-01-01' },
      { ...issueArgs(), expiresAt: '2030-02-31T00:00:00.000Z' },
      { ...issueArgs(), environment: 'production' as const },
      { ...issueArgs(), name: '  ' },
    ]) await expect(issueHandler(ctx, args)).rejects.toThrow();
    expect(getRows('managementTokens')).toHaveLength(0);
    expect(ManagementTokenIssueSchema.safeParse({ ...issueArgs(), unexpected: true }).success).toBe(false);
  });

  test('revocation is idempotent and immediately prevents use', async () => {
    const { ctx } = database();
    const issued = await issueHandler(ctx, issueArgs());
    await requireManagement(ctx, { token: issued.token, environment: 'development' }, 'content:read');
    const first = await revokeHandler(ctx, { tokenId: issued.tokenId });
    const second = await revokeHandler(ctx, { tokenId: issued.tokenId });
    expect(first.alreadyRevoked).toBe(false);
    expect(second.alreadyRevoked).toBe(true);
    expect(second.revokedAt).toBe(first.revokedAt);
    await expect(requireManagement(ctx, { token: issued.token, environment: 'development' }))
      .rejects.toMatchObject({ data: { code: 'unauthenticated' } });
  });
});

describe('management request authorization', () => {
  test('requires correct scope and never treats an ingest token as management credentials', async () => {
    const { ctx, writes } = database();
    const { token } = await issueHandler(ctx, issueArgs());
    writes.length = 0;
    const actor = await requireManagement(ctx, { token, environment: 'development' }, 'content:read');
    expect(actor.ownerSubject).toBe('owner');
    expect(actor).not.toHaveProperty('hashedToken');
    await expect(requireManagement(ctx, { token, environment: 'development' }, 'content:publish'))
      .rejects.toMatchObject({ data: { code: 'forbidden' } });
    await expect(requireManagement(ctx, { token: `ing_${'a'.repeat(64)}`, environment: 'development' }))
      .rejects.toMatchObject({ data: { code: 'unauthenticated' } });
    expect(writes).toHaveLength(0);
  });

  test('changed owner, expired/revoked row, invalid expiry and wrong row environment fail closed', async () => {
    for (const patch of [
      { ownerSubject: 'old-owner' }, { expiresAt: new Date(Date.now() - 1).toISOString() },
      { expiresAt: 'invalid' }, { revokedAt: new Date().toISOString() }, { environment: 'production' },
    ]) {
      const { ctx, db, writes } = database();
      const issued = await issueHandler(ctx, issueArgs());
      await db.patch(issued.tokenId, patch);
      writes.length = 0;
      await expect(requireManagement(ctx, { token: issued.token, environment: 'development' }))
        .rejects.toMatchObject({ data: { code: 'unauthenticated' } });
      expect(writes).toHaveLength(0);
    }
  });

  test('request and server environment must be explicit; missing owner/config cannot authorize', async () => {
    const { ctx } = database();
    const { token } = await issueHandler(ctx, issueArgs());
    await expect(requireManagement(ctx, { token, environment: 'production' }))
      .rejects.toMatchObject({ data: { code: 'forbidden' } });
    delete process.env.MANAGEMENT_ENVIRONMENT;
    await expect(requireManagement(ctx, { token, environment: 'development' }))
      .rejects.toMatchObject({ data: { code: 'authorization-not-configured' } });
    process.env.MANAGEMENT_ENVIRONMENT = 'development';
    delete process.env.ADMIN_CLERK_USER_ID;
    await expect(requireManagement(ctx, { token, environment: 'development' }))
      .rejects.toMatchObject({ data: { code: 'authorization-not-configured' } });
  });
});

describe('management write receipts', () => {
  async function setup() {
    const state = database();
    const { token } = await issueHandler(state.ctx, issueArgs());
    const actor = await requireManagement(state.ctx, { token, environment: 'development' }, 'content:write');
    return { ...state, actor };
  }
  const request = { idempotencyKey: 'save-123', operation: 'posts.save', input: { revision: 2, title: 'Title' } };
  const audit = { entityType: 'posts', entityId: 'post-1', oldRevision: 2, newRevision: 3, changedFields: ['title'] };

  test('returns the original result on retry, without a duplicate audit or content operation', async () => {
    const { ctx, actor, getRows } = await setup();
    const start = await beginManagementWrite<{ revision: number }>(ctx, actor, request);
    expect(start.replayed).toBe(false);
    if (start.replayed) throw new Error('Unexpected replay');
    await completeManagementWrite(ctx, actor, start.receipt, { revision: 3 }, audit);
    const retry = await beginManagementWrite(ctx, actor, {
      ...request, input: { title: 'Title', revision: 2 },
    });
    expect(retry).toEqual({ replayed: true, result: { revision: 3 } });
    expect(getRows('managementReceipts')).toHaveLength(1);
    expect(getRows('managementAudit')).toHaveLength(1);
    for (const [table, schema] of [
      ['managementReceipts', ManagementReceiptSchema], ['managementAudit', ManagementAuditSchema],
    ] as const) {
      const { _id, _creationTime, ...body } = getRows(table)[0]!;
      expect(schema.safeParse(body).success).toBe(true);
      expect(body).not.toHaveProperty('token');
      expect(body).not.toHaveProperty('input');
    }
  });

  test('a different payload or operation with the same key conflicts without writes', async () => {
    const { ctx, actor, writes } = await setup();
    const start = await beginManagementWrite(ctx, actor, request);
    if (start.replayed) throw new Error('Unexpected replay');
    await completeManagementWrite(ctx, actor, start.receipt, { revision: 3 }, audit);
    writes.length = 0;
    for (const changed of [
      { ...request, input: { revision: 3, title: 'Title' } }, { ...request, operation: 'posts.publish' },
    ]) await expect(beginManagementWrite(ctx, actor, changed)).rejects.toMatchObject({ data: { code: 'conflict' } });
    expect(writes).toHaveLength(0);
  });

  test('receipt namespace distinguishes owners and allows a rotated credential to retry', async () => {
    const { ctx, actor } = await setup();
    const start = await beginManagementWrite(ctx, actor, request);
    if (start.replayed) throw new Error('Unexpected replay');
    await completeManagementWrite(ctx, actor, start.receipt, { revision: 3 }, audit);
    const replacement = await issueHandler(ctx, issueArgs());
    const rotated = await requireManagement(ctx, { token: replacement.token, environment: 'development' });
    expect(await beginManagementWrite(ctx, rotated, request)).toEqual({ replayed: true, result: { revision: 3 } });
    const differentOwner = { ...actor, ownerSubject: 'other-owner' } as ManagementActor;
    expect((await beginManagementWrite(ctx, differentOwner, request)).replayed).toBe(false);
  });

  test('expired receipts release their keys and cleanup is bounded to expired rows', async () => {
    const { ctx, actor, db, getRows } = await setup();
    const start = await beginManagementWrite(ctx, actor, request);
    if (start.replayed) throw new Error('Unexpected replay');
    await completeManagementWrite(ctx, actor, start.receipt, { revision: 3 }, audit);
    await db.patch(getRows('managementReceipts')[0]!._id, { expiresAt: new Date(Date.now() - 1).toISOString() });
    expect((await beginManagementWrite(ctx, actor, request)).replayed).toBe(false);
    for (let i = 0; i < MANAGEMENT_RECEIPT_CLEANUP_LIMIT + 1; i++) {
      await db.insert('managementReceipts', { ...start.receipt, idempotencyKey: `old-${i}`, resultJson: '{}', expiresAt: '2020-01-01T00:00:00.000Z' });
    }
    await db.insert('managementReceipts', { ...start.receipt, idempotencyKey: 'live', resultJson: '{}' });
    expect(await deleteExpiredManagementReceipts(ctx)).toEqual({ removed: MANAGEMENT_RECEIPT_CLEANUP_LIMIT });
    expect(getRows('managementReceipts')).toHaveLength(2);
    expect(getRows('managementReceipts').some((row) => row.idempotencyKey === 'live')).toBe(true);
  });

  test('rejects invalid keys and oversized receipts before writing audit or receipt data', async () => {
    const { ctx, actor, getRows } = await setup();
    await expect(beginManagementWrite(ctx, actor, { ...request, idempotencyKey: '' })).rejects.toThrow();
    const start = await beginManagementWrite(ctx, actor, request);
    if (start.replayed) throw new Error('Unexpected replay');
    await expect(completeManagementWrite(ctx, actor, start.receipt, { body: 'x'.repeat(65_536) }, audit)).rejects.toThrow();
    expect(getRows('managementReceipts')).toHaveLength(0);
    expect(getRows('managementAudit')).toHaveLength(0);
  });
});
