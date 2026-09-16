/** Private machine post writes. Authorization, revisions and receipts share one transaction. */
import { ConvexError, type Infer, type GenericValidator, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, type MutationCtx } from './_generated/server';
import { requireManagement } from './lib/managementAuth';
import { beginManagementWrite, completeManagementWrite } from './lib/managementWrites';
import {
  createPost, postCreateFields, postPatchFields, preparePostPatch,
  publishPost, unpublishPost, updatePost, type PostContent,
} from './lib/postOperations';
import { assertExpectedRevision, currentRevision, nextRevision } from './lib/revision';
import { invalid, nowIso } from './lib/validate';
import { managementEnvironment } from './schema';

const writeKey = { idempotencyKey: v.string() };
// Normalize IDs inside the handler so malformed HTTP IDs have a structured error.
const existing = { postId: v.string(), expectedRevision: v.number() };
const staged = { ...existing, expectedDraftRevision: v.number() };
const auth = { token: v.string(), environment: managementEnvironment };
const managementPostRequest = v.union(
  v.object({ operation: v.literal('create_post_draft'), input: v.object({ ...postCreateFields, ...writeKey }) }),
  v.object({ operation: v.literal('update_post_draft'), input: v.object({ ...staged, patch: v.object(postPatchFields), ...writeKey }) }),
  v.object({ operation: v.literal('discard_post_draft'), input: v.object({ ...staged, ...writeKey }) }),
  v.object({ operation: v.literal('publish_post'), input: v.object({ ...staged, ...writeKey }) }),
  v.object({ operation: v.literal('unpublish_post'), input: v.object({ ...existing, ...writeKey }) }),
);
export const managementPostWriteArgs = { ...auth, request: managementPostRequest };
export type ManagementPostRequest = Infer<typeof managementPostRequest>;
export type ManagementPostWriteArgs = ManagementPostRequest & { token: string; environment: Infer<typeof managementEnvironment> };
/** Structural validation for the HTTP boundary, derived from the Convex contract. */
function matchesValidator(value: unknown, validator: GenericValidator): boolean {
  switch (validator.kind) {
    case 'null': return value === null;
    case 'string': return typeof value === 'string';
    case 'float64': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean': return typeof value === 'boolean';
    case 'literal': return value === validator.value;
    case 'union': return validator.members.some((member: GenericValidator) => matchesValidator(value, member));
    case 'array': return Array.isArray(value) && value.every((item) => matchesValidator(item, validator.element));
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const object = value as Record<string, unknown>;
      const prototype = Object.getPrototypeOf(object);
      if (prototype !== Object.prototype && prototype !== null) return false;
      if (Object.keys(object).some((key) => !Object.prototype.hasOwnProperty.call(validator.fields, key))) return false;
      return Object.entries(validator.fields).every(([key, field]) =>
        Object.prototype.hasOwnProperty.call(object, key) ? matchesValidator(object[key], field) : field.isOptional === 'optional',
      );
    }
    // This contract is JSON-only. New validator types must be handled explicitly.
    default: return false;
  }
}

export function parseManagementPostRequest(value: unknown): ManagementPostRequest {
  if (!matchesValidator(value, managementPostRequest)) {
    throw new ConvexError({ code: 'invalid-input', message: 'Invalid post management operation or input fields.' });
  }
  return value as ManagementPostRequest;
}

export type PostWriteResult = {
  postId: Id<'posts'>;
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

function assertDraftRevision(draft: Doc<'managementPostDrafts'> | null, expected: number) {
  assertRevisionInput(expected, 'expectedDraftRevision');
  if ((draft?.revision ?? 0) !== expected) {
    invalid({ code: 'conflict', field: 'expectedDraftRevision', message: 'The staged draft changed. Read the post and review its latest draft before retrying.' });
  }
}

function assertDraftBase(draft: Doc<'managementPostDrafts'> | null, row: Doc<'posts'>) {
  if (draft && draft.baseRevision !== currentRevision(row.revision)) {
    invalid({ code: 'conflict', field: 'expectedRevision', message: 'The post changed after this draft was started. Review both versions before replacing the staged draft.' });
  }
}

export function postContent(row: PostContent): PostContent {
  return { slug: row.slug, title: row.title, excerpt: row.excerpt, body: row.body, coverImage: row.coverImage, tags: row.tags };
}

function resultFor(row: Doc<'posts'>, draftRevision: number, changed: boolean): PostWriteResult {
  return {
    postId: row._id, slug: row.slug, revision: currentRevision(row.revision), draftRevision,
    published: row.published,
    status: row.published ? (draftRevision ? 'published_with_draft' : 'published') : 'draft',
    changed,
  };
}

/** Domain dispatcher, called only by the authorized transactional entry point below. */
export async function applyManagementPostWrite(ctx: MutationCtx, args: ManagementPostWriteArgs) {
  if (args.operation === 'create_post_draft') {
    const created = await createPost(ctx, args.input);
    const row = (await ctx.db.get(created.postId))!;
    return {
      result: resultFor(row, 0, true),
      audit: { entityType: 'post', entityId: row._id, oldRevision: null, newRevision: created.revision, changedFields: Object.keys(postCreateFields) },
    };
  }

  assertRevisionInput(args.input.expectedRevision, 'expectedRevision');
  const postId = ctx.db.normalizeId('posts', args.input.postId);
  if (!postId) invalid({ code: 'invalid-format', field: 'postId', message: 'A valid post ID is required.' });
  const row = await ctx.db.get(postId);
  if (!row) invalid({ code: 'not-found', field: 'postId', message: 'That post no longer exists.' });
  assertExpectedRevision(row.revision, args.input.expectedRevision);
  const draft = await ctx.db.query('managementPostDrafts')
    .withIndex('by_postId', (q) => q.eq('postId', row._id)).unique();
  const before = currentRevision(row.revision);

  if (args.operation === 'update_post_draft') {
    assertDraftRevision(draft, args.input.expectedDraftRevision);
    assertDraftBase(draft, row);
    const content = postContent(draft ?? row);
    const patch = await preparePostPatch(ctx, { ...content, _id: row._id }, args.input.patch);
    const changedFields = Object.keys(patch).filter((field) => {
      const key = field as keyof PostContent;
      return JSON.stringify(patch[key]) !== JSON.stringify(content[key]);
    });
    let draftRevision = draft?.revision ?? 0;
    if (changedFields.length) {
      draftRevision += 1;
      const value = {
        ...content, ...patch, postId: row._id, baseRevision: before,
        revision: draftRevision, updatedAt: nowIso(),
      };
      if (draft) await ctx.db.replace(draft._id, value);
      else await ctx.db.insert('managementPostDrafts', value);
    }
    return {
      result: resultFor(row, draftRevision, changedFields.length > 0),
      audit: { entityType: 'post', entityId: row._id, oldRevision: before, newRevision: before, changedFields: changedFields.map((field) => `draft.${field}`) },
    };
  }

  if (args.operation === 'discard_post_draft') {
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
      audit: { entityType: 'post', entityId: row._id, oldRevision: before, newRevision: revision, changedFields: draft ? ['draft'] : [] },
    };
  }

  if (args.operation === 'publish_post') {
    assertDraftRevision(draft, args.input.expectedDraftRevision);
    assertDraftBase(draft, row);
    let revision = before;
    if (draft) {
      // Shared operations preserve slug uniqueness, media checks and knowledge jobs.
      const updated = await updatePost(ctx, { postId: row._id, expectedRevision: revision, ...postContent(draft) });
      revision = updated.revision;
    }
    const published = await publishPost(ctx, { postId: row._id, expectedRevision: revision });
    if (draft) await ctx.db.delete(draft._id);
    const current = (await ctx.db.get(row._id))!;
    return {
      result: resultFor(current, 0, draft !== null || published.changed),
      audit: { entityType: 'post', entityId: row._id, oldRevision: before, newRevision: currentRevision(current.revision), changedFields: [...(draft ? Object.keys(postCreateFields) : []), ...(published.changed ? ['published', 'publishedAt'] : [])] },
    };
  }

  const unpublished = await unpublishPost(ctx, { postId: row._id, expectedRevision: before });
  // Unpublishing changes visibility only: keep a current editorial draft usable.
  // An already-stale draft is deliberately not rebased onto unrelated human edits.
  if (draft && draft.baseRevision === before && unpublished.changed) {
    await ctx.db.patch(draft._id, { baseRevision: unpublished.revision });
  }
  const current = (await ctx.db.get(row._id))!;
  return {
    result: resultFor(current, draft?.revision ?? 0, unpublished.changed),
    audit: { entityType: 'post', entityId: row._id, oldRevision: before, newRevision: unpublished.revision, changedFields: unpublished.changed ? ['published'] : [] },
  };
}

export async function executeManagementPostWrite(ctx: MutationCtx, args: ManagementPostWriteArgs): Promise<PostWriteResult> {
  const scope = args.operation === 'publish_post' || args.operation === 'unpublish_post' ? 'content:publish' : 'content:write';
  const actor = await requireManagement(ctx, args, scope);
  const receipt = await beginManagementWrite<PostWriteResult>(ctx, actor, {
    idempotencyKey: args.input.idempotencyKey, operation: args.operation, input: args.input,
  });
  if (receipt.replayed) return receipt.result;
  const { result, audit } = await applyManagementPostWrite(ctx, args);
  return await completeManagementWrite(ctx, actor, receipt.receipt, result, audit);
}

export const execute = internalMutation({
  args: managementPostWriteArgs,
  handler: (ctx, args) => executeManagementPostWrite(ctx, { ...args.request, token: args.token, environment: args.environment }),
});
