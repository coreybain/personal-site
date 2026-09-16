import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConvexError } from 'convex/values';
import { handleManagementRequest, parseManagementRequest } from '../convex/managementHttp';
import { pageInput, readInput } from '../convex/managementReads';

const TOKEN = 'test-credential-do-not-use-123456789';
function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://example.convex.site/management/v1', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, ...headers },
    body: JSON.stringify(body),
  });
}
const valid = { environment: 'development', operation: 'get_resume', input: {} };
function context(error?: Error) {
  const calls: Array<{ kind: string; args: unknown }> = [];
  return { calls, ctx: {
    runQuery: async (_: unknown, args: unknown) => { calls.push({ kind: 'query', args }); if (error) throw error; return { revision: 7 }; },
    runMutation: async (_: unknown, args: unknown) => { calls.push({ kind: 'mutation', args }); if (error) throw error; return { revision: 8 }; },
  } as unknown as Parameters<typeof handleManagementRequest>[0] };
}

describe('management HTTP boundary', () => {
  it('refuses arbitrary operation names, implicit environments and unknown fields', () => {
    for (const value of [null, [], { ...valid, operation: 'seed:run' }, { ...valid, environment: undefined }, { ...valid, token: TOKEN }, { ...valid, input: [] }]) {
      assert.throws(() => parseManagementRequest(value));
    }
  });

  it('rejects unauthenticated and browser requests before backend dispatch', async () => {
    for (const headers of [{ Authorization: '' }, { Origin: 'https://evil.example' }]) {
      const { ctx, calls } = context();
      const result = await handleManagementRequest(ctx, request(valid, headers));
      assert.ok(result.status === 401 || result.status === 403);
      assert.equal(calls.length, 0);
    }
  });

  it('rejects oversized streamed bodies without trusting a missing content length', async () => {
    const { ctx, calls } = context();
    const result = await handleManagementRequest(ctx, request({ ...valid, input: { body: 'x'.repeat(512 * 1024) } }));
    assert.equal(result.status, 413);
    assert.equal(calls.length, 0);
  });

  it('dispatches allowlisted reads and writes without putting credentials in output', async () => {
    const { ctx, calls } = context();
    const read = await handleManagementRequest(ctx, request(valid));
    assert.deepEqual(await read.json(), { ok: true, result: { revision: 7 } });
    const input = { postId: 'sample', expectedRevision: 0, expectedDraftRevision: 0, idempotencyKey: 'publish-test' };
    const write = await handleManagementRequest(ctx, request({ ...valid, operation: 'publish_post', input }));
    assert.equal(write.status, 200);
    assert.equal(calls[0].kind, 'query');
    assert.equal(calls[1].kind, 'mutation');
    assert.equal((calls[0].args as { token: string }).token, TOKEN);
    assert.deepEqual(calls[1].args, {
      token: TOKEN, environment: 'development', request: { operation: 'publish_post', input },
    });
    assert.equal(read.headers.get('cache-control'), 'no-store');
  });

  it('keeps structured conflicts and redacts unexpected errors containing credentials', async () => {
    const conflict = context(new ConvexError({ code: 'conflict', message: 'The post changed.', field: 'expectedRevision' }));
    const response = await handleManagementRequest(conflict.ctx, request(valid));
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { ok: false, error: { code: 'conflict', message: 'The post changed.', field: 'expectedRevision' } });
    const unexpected = context(new Error(`Request failed: ${TOKEN}`));
    const failed = await handleManagementRequest(unexpected.ctx, request(valid));
    assert.equal(failed.status, 500);
    assert.ok(!(await failed.text()).includes(TOKEN));
  });
});

describe('bounded management reads', () => {
  it('bounds pages and rejects arbitrary filters', () => {
    assert.deepEqual(pageInput({}), { numItems: 20, cursor: null, published: undefined });
    assert.equal(pageInput({ limit: 50, published: false }, true).published, false);
    for (const value of [{ limit: 0 }, { limit: 51 }, { limit: 1.5 }, { cursor: 6 }, { table: 'ingestTokens' }]) {
      assert.throws(() => pageInput(value));
    }
    assert.throws(() => readInput({ postId: 'x', secret: true }, ['postId']));
  });
});
