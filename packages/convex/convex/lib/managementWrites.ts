import type { Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type { ManagementActor } from './managementAuth';
import { managementSha256 } from './managementAuth';
import { assertText, invalid, nowIso } from './validate';

export const MANAGEMENT_RECEIPT_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
export const MANAGEMENT_RECEIPT_CLEANUP_LIMIT = 100;
type ReceiptInput = Omit<Doc<'managementReceipts'>, '_id' | '_creationTime' | 'resultJson'>;
type AuditInput = Pick<Doc<'managementAudit'>,
  'entityType' | 'entityId' | 'oldRevision' | 'newRevision' | 'changedFields'>;

/** Key order is irrelevant, but array order and every JSON value are significant. */
function canonicalJson(value: unknown, depth = 0): string {
  if (depth > 32) invalid({ code: 'invalid-format', message: 'Management input is too deeply nested.' });
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item, depth + 1)).join(',')}]`;
  if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key], depth + 1)}`).join(',')}}`;
  }
  invalid({ code: 'invalid-format', message: 'Management input must contain JSON values only.' });
}

/**
 * Call after requireManagement, before checking the entity revision. The owner
 * and environment namespace makes retries safe across credential rotation.
 * Convex serializes competing key lookups/inserts within the content mutation.
 */
export async function beginManagementWrite<T>(
  ctx: MutationCtx,
  actor: ManagementActor,
  args: { idempotencyKey: string; operation: string; input: unknown },
): Promise<{ replayed: true; result: T } | { replayed: false; receipt: ReceiptInput }> {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(args.idempotencyKey)) {
    invalid({ code: 'invalid-format', field: 'idempotencyKey', message: 'Use a 1–128 character idempotency key containing letters, numbers, dots, colons, dashes or underscores.' });
  }
  assertText(args.operation, 'operation', 120);
  const request = canonicalJson({ operation: args.operation, input: args.input });
  if (new TextEncoder().encode(request).byteLength > 524_288) {
    invalid({ code: 'out-of-range', message: 'Management input exceeds 512 KiB.' });
  }
  const requestHash = await managementSha256(request);
  const existing = await ctx.db.query('managementReceipts')
    .withIndex('by_owner_environment_key', (q) => q.eq('ownerSubject', actor.ownerSubject)
      .eq('environment', actor.environment).eq('idempotencyKey', args.idempotencyKey))
    .unique();
  if (existing && Date.parse(existing.expiresAt) > Date.now()) {
    if (existing.operation !== args.operation || existing.requestHash !== requestHash) {
      invalid({ code: 'conflict', field: 'idempotencyKey', message: 'This idempotency key was already used for a different request.' });
    }
    await ctx.db.patch(actor.tokenId, { lastUsedAt: nowIso() });
    return { replayed: true, result: JSON.parse(existing.resultJson) as T };
  }
  // An expired key may be reused after the documented seven-day window.
  if (existing) await ctx.db.delete(existing._id);
  return {
    replayed: false,
    receipt: {
      ownerSubject: actor.ownerSubject, environment: actor.environment,
      idempotencyKey: args.idempotencyKey, operation: args.operation, requestHash,
      createdAt: nowIso(), expiresAt: new Date(Date.now() + MANAGEMENT_RECEIPT_RETENTION_MS).toISOString(),
    },
  };
}

/** Persist metadata and a bounded result in the same transaction as the write. */
export async function completeManagementWrite<T>(
  ctx: MutationCtx,
  actor: ManagementActor,
  receipt: ReceiptInput,
  result: T,
  audit: AuditInput,
): Promise<T> {
  const resultJson = canonicalJson(result);
  if (new TextEncoder().encode(resultJson).byteLength > 65_536) {
    invalid({ code: 'out-of-range', message: 'The management operation result exceeds 64 KiB.' });
  }
  assertText(audit.entityType, 'entityType', 120);
  assertText(audit.entityId, 'entityId', 256);
  if (audit.changedFields.length > 100) invalid({ code: 'out-of-range', message: 'Too many audit fields.' });
  for (const field of audit.changedFields) assertText(field, 'changedFields', 120);
  for (const revision of [audit.oldRevision, audit.newRevision]) {
    if (revision !== null && (!Number.isSafeInteger(revision) || revision < 0)) {
      invalid({ code: 'invalid-format', message: 'Audit revisions must be nonnegative integers or null.' });
    }
  }
  await ctx.db.insert('managementReceipts', { ...receipt, resultJson });
  await ctx.db.insert('managementAudit', {
    ...audit, changedFields: [...new Set(audit.changedFields)],
    ownerSubject: actor.ownerSubject, actorTokenId: actor.tokenId,
    environment: actor.environment, operation: receipt.operation, createdAt: nowIso(),
  });
  await ctx.db.patch(actor.tokenId, { lastUsedAt: nowIso() });
  return result;
}

/** One bounded batch per scheduled invocation; no client can prune receipts. */
export async function deleteExpiredManagementReceipts(ctx: MutationCtx) {
  const rows = await ctx.db.query('managementReceipts')
    .withIndex('by_expiresAt', (q) => q.lte('expiresAt', nowIso()))
    .take(MANAGEMENT_RECEIPT_CLEANUP_LIMIT);
  for (const row of rows) await ctx.db.delete(row._id);
  return { removed: rows.length };
}
