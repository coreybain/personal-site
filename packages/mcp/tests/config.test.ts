import { describe, expect, test } from 'bun:test';
import { readConfig } from '../src/config.js';

const valid = {
  HOME_MANAGEMENT_URL: 'https://example.convex.site',
  HOME_MANAGEMENT_ENVIRONMENT: 'development',
  HOME_MANAGEMENT_TOKEN: `mgmt_${'a'.repeat(64)}`,
};

describe('explicit management configuration', () => {
  test('uses only the configured origin, fixed endpoint and declared environment', () => {
    expect(readConfig(valid)).toEqual({
      endpoint: 'https://example.convex.site/management/v1',
      environment: 'development',
      token: valid.HOME_MANAGEMENT_TOKEN,
      timeoutMs: 20_000,
    });
    expect(readConfig({ ...valid, HOME_MANAGEMENT_ENVIRONMENT: 'production' }).environment).toBe('production');
  });

  test('requires both environment and token rather than guessing defaults', () => {
    for (const key of ['HOME_MANAGEMENT_ENVIRONMENT', 'HOME_MANAGEMENT_TOKEN', 'HOME_MANAGEMENT_URL']) {
      expect(() => readConfig({ ...valid, [key]: undefined })).toThrow();
    }
    expect(() => readConfig({ ...valid, HOME_MANAGEMENT_ENVIRONMENT: 'prod' })).toThrow();
    expect(() => readConfig({ ...valid, HOME_MANAGEMENT_TOKEN: 'secret\r\nunsafe' })).toThrow();
  });

  test('permits HTTP only for loopback and rejects credential-bearing or non-origin URLs', () => {
    for (const origin of ['http://localhost:3211', 'http://127.0.0.1:3211', 'http://[::1]:3211']) {
      expect(readConfig({ ...valid, HOME_MANAGEMENT_URL: origin }).endpoint).toBe(`${origin}/management/v1`);
    }
    for (const origin of [
      'http://example.convex.site', 'http://localhost.attacker.test', 'https://user:password@example.com',
      'https://example.com/api', 'https://example.com?token=secret', 'https://example.com#secret', 'file:///tmp/gateway',
    ]) {
      expect(() => readConfig({ ...valid, HOME_MANAGEMENT_URL: origin })).toThrow();
    }
  });

  test('configuration errors never print submitted secrets', () => {
    const secret = 'SECRET_PRIVATE_VALUE';
    try { readConfig({ ...valid, HOME_MANAGEMENT_URL: `https://${secret}@example.com` }); } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});
