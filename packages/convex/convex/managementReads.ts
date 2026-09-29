import { v, ConvexError } from 'convex/values';
import { internalQuery } from './_generated/server';
import type { QueryCtx } from './_generated/server';
import type { Doc, TableNames } from './_generated/dataModel';
import { requireManagement } from './lib/managementAuth';

export const READ_OPERATIONS = [
  'get_management_status', 'list_posts', 'get_post', 'list_post_feedback', 'list_projects', 'get_project',
  'list_labs', 'get_lab', 'get_resume', 'list_experience', 'get_experience', 'get_site_settings',
  'list_fun_entries', 'get_fun_entry', 'list_inbox', 'get_inbox_message',
] as const;
export const POST_WRITE_OPERATIONS = [
  'create_post_draft', 'update_post_draft', 'publish_post', 'unpublish_post', 'discard_post_draft',
  'schedule_post', 'unschedule_post', 'resolve_post_feedback',
] as const;
/** Handled by `previewAccess.manage`, outside receipts: a code must exist only in its one response. */
export const PREVIEW_OPERATIONS = ['create_preview_code', 'revoke_preview_sessions'] as const;
export const PROJECT_WRITE_OPERATIONS = [
  'create_project_draft', 'update_project_draft', 'publish_project', 'unpublish_project', 'discard_project_draft',
] as const;
export const LAB_WRITE_OPERATIONS = [
  'create_lab_draft', 'update_lab_draft', 'publish_lab', 'unpublish_lab', 'discard_lab_draft',
] as const;
export const WRITE_OPERATIONS = [...POST_WRITE_OPERATIONS, ...PROJECT_WRITE_OPERATIONS, ...LAB_WRITE_OPERATIONS] as const;

function badInput(message: string): never {
  throw new ConvexError({ code: 'invalid-input', message });
}

export function readInput(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) badInput('input must be an object.');
  const object = input as Record<string, unknown>;
  if (Object.keys(object).some((key) => !allowed.includes(key))) badInput('Unknown input field.');
  return object;
}

export function pageInput(input: unknown, allowPublished = false) {
  const object = readInput(input, allowPublished ? ['limit', 'cursor', 'published'] : ['limit', 'cursor']);
  const limit = object.limit ?? 20;
  const cursor = object.cursor ?? null;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 50) {
    badInput('limit must be an integer between 1 and 50.');
  }
  if (cursor !== null && (typeof cursor !== 'string' || cursor.length > 4096)) badInput('Invalid cursor.');
  if (object.published !== undefined && typeof object.published !== 'boolean') badInput('published must be a boolean.');
  return { numItems: limit, cursor, published: object.published as boolean | undefined };
}

type ReadableTable = Extract<TableNames, 'posts' | 'projects' | 'labs' | 'funEntries' | 'experienceEntries' | 'contactMessages'>;

async function detail<T extends ReadableTable>(ctx: QueryCtx, table: T, input: unknown, key: string): Promise<Doc<T> | null> {
  const object = readInput(input, [key]);
  if (typeof object[key] !== 'string') badInput(`${key} is required.`);
  const id = ctx.db.normalizeId(table, object[key] as string);
  if (!id) badInput(`Invalid ${key}.`);
  return await ctx.db.get(id);
}

/** Large Markdown bodies and private message text are detail reads, never list payloads. */
function summary(row: Record<string, unknown>) {
  const keys = ['_id', '_creationTime', 'slug', 'title', 'company', 'name', 'type', 'status',
    'published', 'publishedAt', 'scheduledFor', 'scheduleFailure', 'featured', 'sortOrder', 'occurredAt', 'createdAt', 'startDate', 'endDate'];
  return { ...Object.fromEntries(keys.filter((key) => row[key] !== undefined).map((key) => [key, row[key]])), revision: row.revision ?? 0 };
}

async function list<T extends ReadableTable>(ctx: QueryCtx, table: T, input: unknown) {
  const { published, ...pagination } = pageInput(input, table === 'posts');
  const query = table === 'posts' && published !== undefined
    ? ctx.db.query('posts').withIndex('by_published_publishedAt', (q) => q.eq('published', published)).order('desc')
    : ctx.db.query(table).order('desc');
  const result = await query.paginate(pagination);
  return { items: result.page.map((row) => summary(row)), continueCursor: result.continueCursor, isDone: result.isDone };
}

export async function readManagement(ctx: QueryCtx, args: {
  token: string; environment: 'development' | 'production'; operation: string; input: unknown;
}) {
  const scope = args.operation.startsWith('get_inbox') || args.operation === 'list_inbox'
    ? 'inbox:read' : ['get_resume', 'list_experience', 'get_experience', 'get_site_settings'].includes(args.operation)
      ? 'profile:read' : 'content:read';
  const actor = await requireManagement(ctx, args, args.operation === 'get_management_status' ? undefined : scope);
  switch (args.operation) {
    case 'get_management_status':
      readInput(args.input, []);
      return { environment: actor.environment, token: { name: actor.name, scopes: actor.scopes },
        supportedOperations: [...READ_OPERATIONS, ...WRITE_OPERATIONS, ...PREVIEW_OPERATIONS] };
    case 'list_posts': return await list(ctx, 'posts', args.input);
    case 'get_post': {
      const post = await detail(ctx, 'posts', args.input, 'postId');
      const draft = post ? await ctx.db.query('managementPostDrafts').withIndex('by_postId', (q) => q.eq('postId', post._id)).first() : null;
      return { post: post ? { ...post, revision: post.revision ?? 0 } : null, draft };
    }
    case 'list_post_feedback': {
      const object = readInput(args.input, ['postId', 'status']);
      const status = object.status ?? 'open';
      if (status !== 'open' && status !== 'resolved' && status !== 'all') badInput('status must be open, resolved or all.');
      const postId = object.postId === undefined ? null : typeof object.postId === 'string' ? ctx.db.normalizeId('posts', object.postId) : null;
      if (object.postId !== undefined && !postId) badInput('Invalid postId.');
      const rows = postId
        ? await ctx.db.query('postFeedback').withIndex('by_postId', (q) => q.eq('postId', postId)).collect()
        : status === 'all'
          ? (await ctx.db.query('postFeedback').collect()).filter((row) => row.status !== 'archived')
          : await ctx.db.query('postFeedback').withIndex('by_status', (q) => q.eq('status', status)).collect();
      const items = rows
        .filter((row) => row.status !== 'archived' && (status === 'all' || row.status === status))
        .map((row) => ({
          feedbackId: row._id, postId: row.postId, anchor: row.anchor, reaction: row.reaction, note: row.note,
          status: row.status, resolution: row.resolution, createdAt: row.createdAt,
          standing: row.reaction === 'love' && row.note === null,
        }));
      return { items, meaning: { love: 'Keep this; do not change it in later edits.', unclear: 'Reword or explain this.', dislike: 'Rewrite or remove this.' } };
    }
    case 'list_projects': return await list(ctx, 'projects', args.input);
    case 'get_project': {
      const project = await detail(ctx, 'projects', args.input, 'projectId');
      const draft = project ? await ctx.db.query('managementProjectDrafts').withIndex('by_projectId', (q) => q.eq('projectId', project._id)).unique() : null;
      return { project: project ? { ...project, revision: project.revision ?? 0 } : null, draft };
    }
    case 'list_labs': return await list(ctx, 'labs', args.input);
    case 'get_lab': {
      const lab = await detail(ctx, 'labs', args.input, 'labId');
      const draft = lab ? await ctx.db.query('managementLabDrafts').withIndex('by_labId', (q) => q.eq('labId', lab._id)).unique() : null;
      return { lab: lab ? { ...lab, revision: lab.revision ?? 0 } : null, draft };
    }
    case 'list_experience': return await list(ctx, 'experienceEntries', args.input);
    case 'get_experience': return await detail(ctx, 'experienceEntries', args.input, 'entryId');
    case 'list_fun_entries': return await list(ctx, 'funEntries', args.input);
    case 'get_fun_entry': return await detail(ctx, 'funEntries', args.input, 'entryId');
    case 'list_inbox': return await list(ctx, 'contactMessages', args.input);
    case 'get_inbox_message': {
      const row = await detail(ctx, 'contactMessages', args.input, 'messageId');
      if (!row) return null;
      // attachmentSecret authorizes writes; it must never accompany a scoped read.
      return {
        _id: row._id, _creationTime: row._creationTime, name: row.name, email: row.email,
        ...(row.company === undefined ? {} : { company: row.company }),
        message: row.message, status: row.status, createdAt: row.createdAt,
        attachments: (row.attachments ?? []).map(({ name, url, size, contentType }) => ({ name, url, size, contentType })),
      };
    }
    case 'get_resume':
      readInput(args.input, []);
      return await ctx.db.query('resumeDocument').order('desc').first();
    case 'get_site_settings':
      readInput(args.input, []);
      return await ctx.db.query('siteSettings').order('desc').first();
    default: badInput('Unsupported read operation.');
  }
}

export const execute = internalQuery({
  args: { token: v.string(), environment: v.union(v.literal('development'), v.literal('production')), operation: v.string(), input: v.any() },
  handler: readManagement,
});
