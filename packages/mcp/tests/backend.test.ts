import { describe, expect, test } from 'bun:test';
import { ManagementBackend } from '../src/backend.js';
import type { ManagementConfig } from '../src/config.js';

const config: ManagementConfig = {
  endpoint: 'http://127.0.0.1:1234/management/v1',
  environment: 'development',
  token: `mgmt_${'a'.repeat(64)}`,
  timeoutMs: 1000,
};
const requestWith = (fn: (url: string, init: RequestInit) => Promise<Response>) =>
  fn as unknown as typeof fetch;

describe('gateway boundary', () => {
  test('sends the fixed operation and environment with header-only credentials', async () => {
    const backend = new ManagementBackend(config, requestWith(async (url, init) => {
      expect(url).toBe(config.endpoint);
      expect(init.redirect).toBe('error');
      expect(init.headers).toMatchObject({ authorization: `Bearer ${config.token}` });
      expect(JSON.parse(String(init.body))).toEqual({ environment: 'development', operation: 'get_post', input: { postId: 'post1' } });
      expect(String(init.body)).not.toContain(config.token);
      return Response.json({ ok: true, result: { post: { _id: 'post1' }, draft: null } });
    }));
    expect(await backend.call('get_post', { postId: 'post1' })).toEqual({ ok: true, result: { post: { _id: 'post1' }, draft: null } });
  });

  test('preserves structured authorization and conflict errors, redacting any echoed token', async () => {
    const backend = new ManagementBackend(config, requestWith(async () => Response.json({
      ok: false, error: { code: 'revision-conflict', message: `Stale revision; diagnostic ${config.token}`, field: 'expectedRevision' },
    }, { status: 409 })));
    expect(await backend.call('publish_post', {})).toEqual({
      ok: false, error: { code: 'revision-conflict', message: 'Stale revision; diagnostic [REDACTED]', field: 'expectedRevision' },
    });
  });

  test('redacts tokens in successful result content as well', async () => {
    const backend = new ManagementBackend(config, requestWith(async () => Response.json({ ok: true, result: { note: config.token } })));
    expect(JSON.stringify(await backend.call('get_management_status', {}))).not.toContain(config.token);
  });

  test('redacts a credential even if the gateway JSON-escapes it', async () => {
    const escaped = config.token.replaceAll('m', '\\u006d');
    const backend = new ManagementBackend(config, requestWith(async () => new Response(`{"ok":true,"result":{"note":"${escaped}"}}`)));
    expect(await backend.call('get_management_status', {})).toEqual({ ok: true, result: { note: '[REDACTED]' } });
  });

  test('does not expose unstructured service responses or fetch exception details', async () => {
    for (const response of [
      new Response(`<html>${config.token} private stack</html>`, { status: 500 }),
      Response.json({ ok: true }),
      Response.json({ ok: true, result: {} }, { status: 500 }),
      Response.json({ ok: false, error: { code: 'bad', message: 'bad', stack: 'private-stack' } }),
    ]) {
      const backend = new ManagementBackend(config, requestWith(async () => response));
      expect(await backend.call('get_management_status', {})).toEqual({ ok: false, error: { code: 'service-failure', message: 'The management gateway returned an invalid response.' } });
    }
    let calls = 0;
    const backend = new ManagementBackend(config, requestWith(async () => { calls++; throw new Error(config.token); }));
    const result = await backend.call('create_post_draft', { idempotencyKey: 'test-write-key-0001' });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(config.token);
    expect(calls).toBe(1);
  });

  test('bounds streaming responses and rejects oversized requests before sending', async () => {
    let calls = 0;
    const backend = new ManagementBackend(config, requestWith(async () => { calls++; return new Response('x'.repeat(2_000_001)); }));
    expect(await backend.call('get_management_status', {})).toMatchObject({ ok: false, error: { code: 'response-too-large' } });
    expect(await backend.call('create_post_draft', { body: 'x'.repeat(512_000) })).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    expect(calls).toBe(1);
  });

  test('reports uncertain timeout writes without automatically retrying', async () => {
    let calls = 0;
    const backend = new ManagementBackend({ ...config, timeoutMs: 5 }, requestWith(async (_url, init) => {
      calls++;
      return await new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    }));
    expect(await backend.call('publish_post', {})).toMatchObject({ ok: false, error: { code: 'timeout' } });
    expect(calls).toBe(1);
  });
});
