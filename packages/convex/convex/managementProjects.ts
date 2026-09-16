/** Private machine project writes. Authorization, revisions and receipts share one transaction. */
import { ConvexError, type Infer, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, type MutationCtx } from './_generated/server';
import { matchesValidator } from './lib/managementValidation';
import { requireManagement } from './lib/managementAuth';
import { beginManagementWrite, completeManagementWrite } from './lib/managementWrites';
import {
  createProject, projectEditorialFields, projectEditorialPatchFields, prepareProjectPatch,
  publishProject, unpublishProject, updateProject, type ProjectContent,
} from './lib/projectOperations';
import { assertExpectedRevision, currentRevision, nextRevision } from './lib/revision';
import { invalid, nowIso } from './lib/validate';
import { managementEnvironment } from './schema';

const writeKey = { idempotencyKey: v.string() };
// Normalize IDs inside the handler so malformed HTTP IDs have a structured error.
const existing = { projectId: v.string(), expectedRevision: v.number() };
const staged = { ...existing, expectedDraftRevision: v.number() };
const auth = { token: v.string(), environment: managementEnvironment };
const managementProjectRequest = v.union(
  v.object({ operation: v.literal('create_project_draft'), input: v.object({ ...projectEditorialFields, ...writeKey }) }),
  v.object({ operation: v.literal('update_project_draft'), input: v.object({ ...staged, patch: v.object(projectEditorialPatchFields), ...writeKey }) }),
  v.object({ operation: v.literal('discard_project_draft'), input: v.object({ ...staged, ...writeKey }) }),
  v.object({ operation: v.literal('publish_project'), input: v.object({ ...staged, ...writeKey }) }),
  v.object({ operation: v.literal('unpublish_project'), input: v.object({ ...existing, ...writeKey }) }),
);
export const managementProjectWriteArgs = { ...auth, request: managementProjectRequest };
export type ManagementProjectRequest = Infer<typeof managementProjectRequest>;
export type ManagementProjectWriteArgs = ManagementProjectRequest & { token: string; environment: Infer<typeof managementEnvironment> };
export function parseManagementProjectRequest(value: unknown): ManagementProjectRequest {
  if (!matchesValidator(value, managementProjectRequest)) {
    throw new ConvexError({ code: 'invalid-input', message: 'Invalid project management operation or input fields.' });
  }
  return value as ManagementProjectRequest;
}

export type ProjectWriteResult = {
  projectId: Id<'projects'>;
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

function assertDraftRevision(draft: Doc<'managementProjectDrafts'> | null, expected: number) {
  assertRevisionInput(expected, 'expectedDraftRevision');
  if ((draft?.revision ?? 0) !== expected) {
    invalid({ code: 'conflict', field: 'expectedDraftRevision', message: 'The staged draft changed. Read the project and review its latest draft before retrying.' });
  }
}

function assertDraftBase(draft: Doc<'managementProjectDrafts'> | null, row: Doc<'projects'>) {
  if (draft && draft.baseRevision !== currentRevision(row.revision)) {
    invalid({ code: 'conflict', field: 'expectedRevision', message: 'The project changed after this draft was started. Review both versions before replacing the staged draft.' });
  }
}

export function projectContent(row: ProjectContent): ProjectContent {
  return {
    slug: row.slug, title: row.title, client: row.client, attribution: row.attribution,
    role: row.role, summary: row.summary, stack: row.stack, media: row.media,
    links: row.links, accent: row.accent, accentHue: row.accentHue,
    ...(row.period !== undefined ? { period: row.period } : {}),
    ...(row.problem !== undefined ? { problem: row.problem } : {}),
    ...(row.approach !== undefined ? { approach: row.approach } : {}),
    ...(row.outcomes !== undefined ? { outcomes: row.outcomes } : {}),
    ...(row.body !== undefined ? { body: row.body } : {}),
  };
}

/** Omitted snapshot fields mean a deliberate clear when applying the full draft. */
function publishPatch(row: ProjectContent) {
  return {
    ...projectContent(row), period: row.period ?? null, problem: row.problem ?? null,
    approach: row.approach ?? null, outcomes: row.outcomes ?? null, body: row.body ?? null,
  };
}

function resultFor(row: Doc<'projects'>, draftRevision: number, changed: boolean): ProjectWriteResult {
  return {
    projectId: row._id, slug: row.slug, revision: currentRevision(row.revision), draftRevision,
    published: row.published,
    status: row.published ? (draftRevision ? 'published_with_draft' : 'published') : 'draft',
    changed,
  };
}

/** Domain dispatcher, called only by the authorized transactional entry point below. */
export async function applyManagementProjectWrite(ctx: MutationCtx, args: ManagementProjectWriteArgs) {
  if (args.operation === 'create_project_draft') {
    const created = await createProject(ctx, args.input);
    const row = (await ctx.db.get(created.projectId))!;
    return {
      result: resultFor(row, 0, true),
      audit: { entityType: 'project', entityId: row._id, oldRevision: null, newRevision: created.revision, changedFields: Object.keys(projectEditorialFields) },
    };
  }

  assertRevisionInput(args.input.expectedRevision, 'expectedRevision');
  const projectId = ctx.db.normalizeId('projects', args.input.projectId);
  if (!projectId) invalid({ code: 'invalid-format', field: 'projectId', message: 'A valid project ID is required.' });
  const row = await ctx.db.get(projectId);
  if (!row) invalid({ code: 'not-found', field: 'projectId', message: 'That project no longer exists.' });
  assertExpectedRevision(row.revision, args.input.expectedRevision);
  const draft = await ctx.db.query('managementProjectDrafts')
    .withIndex('by_projectId', (q) => q.eq('projectId', row._id)).unique();
  const before = currentRevision(row.revision);

  if (args.operation === 'update_project_draft') {
    assertDraftRevision(draft, args.input.expectedDraftRevision);
    assertDraftBase(draft, row);
    const content = projectContent(draft ?? row);
    const patch = await prepareProjectPatch(ctx, { ...content, _id: row._id }, args.input.patch);
    const changedFields = Object.keys(patch).filter((field) => {
      const key = field as keyof ProjectContent;
      return JSON.stringify(patch[key]) !== JSON.stringify(content[key]);
    });
    let draftRevision = draft?.revision ?? 0;
    if (changedFields.length) {
      draftRevision += 1;
      const value = {
        ...projectContent({ ...content, ...patch }), projectId: row._id, baseRevision: before,
        revision: draftRevision, updatedAt: nowIso(),
      };
      if (draft) await ctx.db.replace(draft._id, value);
      else await ctx.db.insert('managementProjectDrafts', value);
    }
    return {
      result: resultFor(row, draftRevision, changedFields.length > 0),
      audit: { entityType: 'project', entityId: row._id, oldRevision: before, newRevision: before, changedFields: changedFields.map((field) => `draft.${field}`) },
    };
  }

  if (args.operation === 'discard_project_draft') {
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
      audit: { entityType: 'project', entityId: row._id, oldRevision: before, newRevision: revision, changedFields: draft ? ['draft'] : [] },
    };
  }

  if (args.operation === 'publish_project') {
    assertDraftRevision(draft, args.input.expectedDraftRevision);
    assertDraftBase(draft, row);
    let revision = before;
    if (draft) {
      // Shared operations preserve slug uniqueness, media checks and knowledge jobs.
      const updated = await updateProject(ctx, { projectId: row._id, expectedRevision: revision, ...publishPatch(draft) });
      revision = updated.revision;
    }
    const published = await publishProject(ctx, { projectId: row._id, expectedRevision: revision });
    if (draft) await ctx.db.delete(draft._id);
    const current = (await ctx.db.get(row._id))!;
    return {
      result: resultFor(current, 0, draft !== null || published.changed),
      audit: { entityType: 'project', entityId: row._id, oldRevision: before, newRevision: currentRevision(current.revision), changedFields: [...(draft ? Object.keys(projectEditorialFields) : []), ...(published.changed ? ['published'] : [])] },
    };
  }

  const unpublished = await unpublishProject(ctx, { projectId: row._id, expectedRevision: before });
  // Unpublishing changes visibility only: keep a current editorial draft usable.
  // An already-stale draft is deliberately not rebased onto unrelated human edits.
  if (draft && draft.baseRevision === before && unpublished.changed) {
    await ctx.db.patch(draft._id, { baseRevision: unpublished.revision });
  }
  const current = (await ctx.db.get(row._id))!;
  return {
    result: resultFor(current, draft?.revision ?? 0, unpublished.changed),
    audit: { entityType: 'project', entityId: row._id, oldRevision: before, newRevision: unpublished.revision, changedFields: unpublished.changed ? ['published'] : [] },
  };
}

export async function executeManagementProjectWrite(ctx: MutationCtx, args: ManagementProjectWriteArgs): Promise<ProjectWriteResult> {
  const scope = args.operation === 'publish_project' || args.operation === 'unpublish_project' ? 'content:publish' : 'content:write';
  const actor = await requireManagement(ctx, args, scope);
  const receipt = await beginManagementWrite<ProjectWriteResult>(ctx, actor, {
    idempotencyKey: args.input.idempotencyKey, operation: args.operation, input: args.input,
  });
  if (receipt.replayed) return receipt.result;
  const { result, audit } = await applyManagementProjectWrite(ctx, args);
  return await completeManagementWrite(ctx, actor, receipt.receipt, result, audit);
}

export const execute = internalMutation({
  args: managementProjectWriteArgs,
  handler: (ctx, args) => executeManagementProjectWrite(ctx, { ...args.request, token: args.token, environment: args.environment }),
});
