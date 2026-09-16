import { ConvexError } from 'convex/values';
import { httpAction } from './_generated/server';
import type { ActionCtx } from './_generated/server';
import { internal } from './_generated/api';
import { READ_OPERATIONS, WRITE_OPERATIONS, PROJECT_WRITE_OPERATIONS, LAB_WRITE_OPERATIONS } from './managementReads';
import { parseManagementPostRequest } from './managementPosts';
import { parseManagementProjectRequest } from './managementProjects';
import { parseManagementLabRequest } from './managementLabs';

const MAX_REQUEST_BYTES = 512 * 1024;
const operations = new Set<string>([...READ_OPERATIONS, ...WRITE_OPERATIONS]);
const writes = new Set<string>(WRITE_OPERATIONS);
const projectWrites = new Set<string>(PROJECT_WRITE_OPERATIONS);
const labWrites = new Set<string>(LAB_WRITE_OPERATIONS);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

function failure(status: number, code: string, message: string): Response {
  return json(status, { ok: false, error: { code, message } });
}

export function parseManagementRequest(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !['environment', 'operation', 'input'].includes(key))) throw new Error('Unknown request field.');
  if (record.environment !== 'development' && record.environment !== 'production') throw new Error('Explicit development or production environment is required.');
  if (typeof record.operation !== 'string' || !operations.has(record.operation)) throw new Error('Unsupported management operation.');
  if (!record.input || typeof record.input !== 'object' || Array.isArray(record.input)) throw new Error('input must be an object.');
  return { environment: record.environment, operation: record.operation, input: record.input } as const;
}

/** Bounded streaming read; Content-Length is only an early rejection, never trusted. */
async function readBoundedBody(request: Request): Promise<string | null> {
  if (Number(request.headers.get('content-length')) > MAX_REQUEST_BYTES) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_REQUEST_BYTES) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

export async function handleManagementRequest(ctx: Pick<ActionCtx, 'runQuery' | 'runMutation'>, request: Request): Promise<Response> {
  // No browser management API: local stdio clients send bearer credentials without Origin.
  if (request.headers.has('origin')) return failure(403, 'forbidden', 'Browser requests are not supported.');
  const authorization = request.headers.get('authorization') ?? '';
  const match = /^Bearer (\S{20,512})$/.exec(authorization);
  if (!match) return failure(401, 'unauthenticated', 'A management credential is required.');
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return failure(415, 'invalid-input', 'Content-Type must be application/json.');

  let parsed: ReturnType<typeof parseManagementRequest>;
  try {
    const body = await readBoundedBody(request);
    if (body === null) return failure(413, 'invalid-input', 'Request is too large.');
    parsed = parseManagementRequest(JSON.parse(body));
  } catch { return failure(400, 'invalid-input', 'Invalid management request.'); }

  try {
    const args = { ...parsed, token: match[1] };
    const result = projectWrites.has(parsed.operation)
      ? await ctx.runMutation(internal.managementProjects.execute, {
        token: args.token, environment: args.environment,
        request: parseManagementProjectRequest({ operation: args.operation, input: args.input }),
      })
      : labWrites.has(parsed.operation)
      ? await ctx.runMutation(internal.managementLabs.execute, {
        token: args.token, environment: args.environment,
        request: parseManagementLabRequest({ operation: args.operation, input: args.input }),
      })
      : writes.has(parsed.operation)
      ? await ctx.runMutation(internal.managementPosts.execute, {
        token: args.token, environment: args.environment,
        request: parseManagementPostRequest({ operation: args.operation, input: args.input }),
      })
      : await ctx.runQuery(internal.managementReads.execute, args);
    return json(200, { ok: true, result });
  } catch (error) {
    // Typed errors are safe contracts; never echo unknown SDK errors or arguments containing tokens.
    if (error instanceof ConvexError && error.data && typeof error.data === 'object') {
      const data = error.data as Record<string, unknown>;
      if (typeof data.code === 'string' && typeof data.message === 'string') {
        const status = data.code === 'unauthenticated' || data.code === 'unauthorized' ? 401
          : data.code === 'forbidden' ? 403 : data.code === 'conflict' || data.code === 'idempotency-conflict' ? 409
            : data.code === 'not-found' ? 404 : data.code === 'rate-limited' ? 429
              : data.code === 'authorization-not-configured' ? 503 : 400;
        return json(status, { ok: false, error: { code: data.code, message: data.message, ...(typeof data.field === 'string' ? { field: data.field } : {}) } });
      }
    }
    return failure(500, 'internal-error', 'The management request failed.');
  }
}

export const managementGateway = httpAction(handleManagementRequest);
