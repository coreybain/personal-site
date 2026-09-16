/** Private machine lab writes. Authorization, revisions and receipts share one transaction. */
import { ConvexError, type Infer, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, type MutationCtx } from './_generated/server';
import { matchesValidator } from './lib/managementValidation';
import { requireManagement } from './lib/managementAuth';
import { beginManagementWrite, completeManagementWrite } from './lib/managementWrites';
import {
  createLab, labEditorialFields, labEditorialPatchFields, prepareLabPatch,
  publishLab, unpublishLab, updateLab, type LabContent,
} from './lib/labOperations';
import { assertExpectedRevision, currentRevision, nextRevision } from './lib/revision';
import { invalid, nowIso } from './lib/validate';
import { managementEnvironment } from './schema';

const writeKey = { idempotencyKey: v.string() };
// Normalize IDs inside the handler so malformed HTTP IDs have a structured error.
const existing = { labId: v.string(), expectedRevision: v.number() };
const staged = { ...existing, expectedDraftRevision: v.number() };
const auth = { token: v.string(), environment: managementEnvironment };
const managementLabRequest = v.union(
  v.object({ operation: v.literal('create_lab_draft'), input: v.object({ ...labEditorialFields, ...writeKey }) }),
  v.object({ operation: v.literal('update_lab_draft'), input: v.object({ ...staged, patch: v.object(labEditorialPatchFields), ...writeKey }) }),
  v.object({ operation: v.literal('discard_lab_draft'), input: v.object({ ...staged, ...writeKey }) }),
  v.object({ operation: v.literal('publish_lab'), input: v.object({ ...staged, ...writeKey }) }),
  v.object({ operation: v.literal('unpublish_lab'), input: v.object({ ...existing, ...writeKey }) }),
);
export const managementLabWriteArgs = { ...auth, request: managementLabRequest };
export type ManagementLabRequest = Infer<typeof managementLabRequest>;
export type ManagementLabWriteArgs = ManagementLabRequest & { token: string; environment: Infer<typeof managementEnvironment> };
export function parseManagementLabRequest(value: unknown): ManagementLabRequest {
  if (!matchesValidator(value, managementLabRequest)) {
    throw new ConvexError({ code: 'invalid-input', message: 'Invalid lab management operation or input fields.' });
  }
  return value as ManagementLabRequest;
}

export type LabWriteResult = {
  labId: Id<'labs'>;
  slug: string;
  revision: number;
  draftRevision: number;
  published: boolean;
  status: 'draft' | 'published' | 'published_with_draft';
  changed: boolean;
};

function assertRevisionInput(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    invalid({ code: 'invalid-format', field, message: `${field} must be a non-negative integer.` });
  }
}

function assertDraftRevision(draft: Doc<'managementLabDrafts'> | null, expected: number) {
  assertRevisionInput(expected, 'expectedDraftRevision');
  if ((draft?.revision ?? 0) !== expected) {
    invalid({ code: 'conflict', field: 'expectedDraftRevision', message: 'The staged draft changed. Read the lab and review its latest draft before retrying.' });
  }
}

function assertDraftBase(draft: Doc<'managementLabDrafts'> | null, row: Doc<'labs'>) {
  if (draft && draft.baseRevision !== currentRevision(row.revision)) {
    invalid({ code: 'conflict', field: 'expectedRevision', message: 'The lab changed after this draft was started. Review both versions before replacing the staged draft.' });
  }
}

export function labContent(row: LabContent): LabContent {
  return { slug: row.slug, title: row.title, summary: row.summary, repoFullName: row.repoFullName, language: row.language, coverImage: row.coverImage, links: row.links };
}

function resultFor(row: Doc<'labs'>, draftRevision: number, changed: boolean): LabWriteResult {
  return {
    labId: row._id, slug: row.slug, revision: currentRevision(row.revision), draftRevision,
    published: row.published,
    status: row.published ? (draftRevision ? 'published_with_draft' : 'published') : 'draft',
    changed,
  };
}

/** Domain dispatcher, called only by the authorized transactional entry point below. */
export async function applyManagementLabWrite(ctx: MutationCtx, args: ManagementLabWriteArgs) {
  if (args.operation === 'create_lab_draft') {
    const created = await createLab(ctx, args.input);
    const row = (await ctx.db.get(created.labId))!;
    return {
      result: resultFor(row, 0, true),
      audit: { entityType: 'lab', entityId: row._id, oldRevision: null, newRevision: created.revision, changedFields: Object.keys(labEditorialFields) },
    };
  }

  assertRevisionInput(args.input.expectedRevision, 'expectedRevision');
  const labId = ctx.db.normalizeId('labs', args.input.labId);
  if (!labId) invalid({ code: 'invalid-format', field: 'labId', message: 'A valid lab ID is required.' });
  const row = await ctx.db.get(labId);
  if (!row) invalid({ code: 'not-found', field: 'labId', message: 'That lab no longer exists.' });
  assertExpectedRevision(row.revision, args.input.expectedRevision);
  const draft = await ctx.db.query('managementLabDrafts')
    .withIndex('by_labId', (q) => q.eq('labId', row._id)).unique();
  const before = currentRevision(row.revision);

  if (args.operation === 'update_lab_draft') {
    assertDraftRevision(draft, args.input.expectedDraftRevision);
    assertDraftBase(draft, row);
    const content = labContent(draft ?? row);
    const patch = await prepareLabPatch(ctx, { ...content, _id: row._id }, args.input.patch);
    const changedFields = Object.keys(patch).filter((field) => {
      const key = field as keyof LabContent;
      return JSON.stringify(patch[key]) !== JSON.stringify(content[key]);
    });
    let draftRevision = draft?.revision ?? 0;
    if (changedFields.length) {
      draftRevision += 1;
      const value = {
        ...content, ...patch, labId: row._id, baseRevision: before,
        revision: draftRevision, updatedAt: nowIso(),
      };
      if (draft) await ctx.db.replace(draft._id, value);
      else await ctx.db.insert('managementLabDrafts', value);
    }
    return {
      result: resultFor(row, draftRevision, changedFields.length > 0),
      audit: { entityType: 'lab', entityId: row._id, oldRevision: before, newRevision: before, changedFields: changedFields.map((field) => `draft.${field}`) },
    };
  }

  if (args.operation === 'discard_lab_draft') {
    assertDraftRevision(draft, args.input.expectedDraftRevision);
    // Discard is the explicit recovery operation for a draft whose base is stale.
    let revision = before;
    if (draft) {
      await ctx.db.delete(draft._id);
      // Prevent an old (base, draft) pair matching a newly started draft after
      // discard. Content and publication stay unchanged; only the version moves.
      revision = nextRevision(row.revision);
      await ctx.db.patch(row._id, { revision });
    }
    return {
      result: resultFor({ ...row, revision }, 0, draft !== null),
      audit: { entityType: 'lab', entityId: row._id, oldRevision: before, newRevision: revision, changedFields: draft ? ['draft'] : [] },
    };
  }

  if (args.operation === 'publish_lab') {
    assertDraftRevision(draft, args.input.expectedDraftRevision);
    assertDraftBase(draft, row);
    let revision = before;
    if (draft) {
      // Apply editorial fields only; the current liveStats and curation survive publication.
      const updated = await updateLab(ctx, { labId: row._id, expectedRevision: revision, ...labContent(draft) });
      revision = updated.revision;
    }
    const published = await publishLab(ctx, { labId: row._id, expectedRevision: revision });
    if (draft) await ctx.db.delete(draft._id);
    const current = (await ctx.db.get(row._id))!;
    return {
      result: resultFor(current, 0, draft !== null || published.changed),
      audit: { entityType: 'lab', entityId: row._id, oldRevision: before, newRevision: currentRevision(current.revision), changedFields: [...(draft ? Object.keys(labEditorialFields) : []), ...(published.changed ? ['published'] : [])] },
    };
  }

  const unpublished = await unpublishLab(ctx, { labId: row._id, expectedRevision: before });
  // Unpublishing changes visibility only: keep a current editorial draft usable.
  // An already-stale draft is deliberately not rebased onto unrelated human edits.
  if (draft && draft.baseRevision === before && unpublished.changed) {
    await ctx.db.patch(draft._id, { baseRevision: unpublished.revision });
  }
  const current = (await ctx.db.get(row._id))!;
  return {
    result: resultFor(current, draft?.revision ?? 0, unpublished.changed),
    audit: { entityType: 'lab', entityId: row._id, oldRevision: before, newRevision: unpublished.revision, changedFields: unpublished.changed ? ['published'] : [] },
  };
}

export async function executeManagementLabWrite(ctx: MutationCtx, args: ManagementLabWriteArgs): Promise<LabWriteResult> {
  const scope = args.operation === 'publish_lab' || args.operation === 'unpublish_lab' ? 'content:publish' : 'content:write';
  const actor = await requireManagement(ctx, args, scope);
  const receipt = await beginManagementWrite<LabWriteResult>(ctx, actor, {
    idempotencyKey: args.input.idempotencyKey, operation: args.operation, input: args.input,
  });
  if (receipt.replayed) return receipt.result;
  const { result, audit } = await applyManagementLabWrite(ctx, args);
  return await completeManagementWrite(ctx, actor, receipt.receipt, result, audit);
}

export const execute = internalMutation({
  args: managementLabWriteArgs,
  handler: (ctx, args) => executeManagementLabWrite(ctx, { ...args.request, token: args.token, environment: args.environment }),
});
