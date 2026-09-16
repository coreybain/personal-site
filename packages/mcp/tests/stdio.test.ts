import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { toolDefinitions } from '../src/tools.js';

const token = `mgmt_${'a'.repeat(64)}`;
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const postInput = {
  slug: 'test-post', title: 'Test post', excerpt: 'Test excerpt', body: '# Test body',
  tags: ['test'], coverImage: { kind: 'image', url: 'https://example.test/cover.png', alt: 'Test cover' },
  idempotencyKey: 'stdio-create-post-0001',
};

for (const runtime of ['bun', 'node'] as const) {
  describe(`real ${runtime} stdio MCP session`, () => {
    const requests: Array<{ environment: string; operation: string; input: Record<string, unknown> }> = [];
    let backend: ReturnType<typeof Bun.serve>;
    let client: Client;
    let transport: StdioClientTransport;
    let stderr = '';

    beforeAll(async () => {
      backend = Bun.serve({
        hostname: '127.0.0.1', port: 0,
        async fetch(request) {
          expect(new URL(request.url).pathname).toBe('/management/v1');
          expect(request.method).toBe('POST');
          expect(request.headers.get('authorization')).toBe(`Bearer ${token}`);
          const envelope = await request.json() as (typeof requests)[number];
          requests.push(envelope);
          expect(envelope.environment).toBe('development');
          if (envelope.operation === 'get_inbox_message') {
            return Response.json({ ok: false, error: { code: 'forbidden', message: 'Requires inbox:read.' } }, { status: 403 });
          }
          if (envelope.operation === 'publish_post' && envelope.input.expectedRevision === 1) {
            return Response.json({ ok: false, error: { code: 'revision-conflict', message: 'Read the latest post.', field: 'expectedRevision' } }, { status: 409 });
          }
          return Response.json({ ok: true, result: { operation: envelope.operation, input: envelope.input } });
        },
      });
      transport = new StdioClientTransport({
        command: runtime,
        args: [runtime === 'bun' ? 'src/stdio.ts' : 'dist/stdio.js'],
        cwd: packageRoot,
        env: { HOME_MANAGEMENT_URL: `http://127.0.0.1:${backend.port}`, HOME_MANAGEMENT_ENVIRONMENT: 'development', HOME_MANAGEMENT_TOKEN: token },
        stderr: 'pipe',
      });
      transport.stderr?.on('data', data => { stderr += String(data); });
      client = new Client({ name: 'home-mcp-integration-test', version: '1.0.0' });
      await client.connect(transport);
    });

    afterAll(async () => {
      await client?.close();
      backend?.stop(true);
    });

    test('initializes and advertises only the scoped explicit tools', async () => {
      const { tools } = await client.listTools();
      expect(tools.map(tool => tool.name).sort()).toEqual(toolDefinitions.map(tool => tool.name).sort());
      expect(tools.find(tool => tool.name === 'get_management_status')?.annotations?.readOnlyHint).toBe(true);
      expect(tools.find(tool => tool.name === 'publish_post')?.annotations?.readOnlyHint).toBe(false);
      expect(tools.find(tool => tool.name === 'discard_post_draft')?.annotations?.destructiveHint).toBe(true);
      expect(tools.find(tool => tool.name === 'create_post_draft')?.annotations?.destructiveHint).toBe(false);
      expect(JSON.stringify(tools)).not.toContain(token);
      for (const tool of tools) expect(tool.inputSchema.properties).not.toHaveProperty('token');
    });

    test('round-trips paginated reads and every explicit detail read', async () => {
      const inputs: Record<string, Record<string, unknown>> = {
        get_management_status: {}, list_posts: { limit: 2, cursor: null, published: false }, get_post: { postId: 'post1' },
        list_projects: { limit: 3, cursor: 'opaque-next-page' }, get_project: { projectId: 'project1' },
        list_labs: {}, get_lab: { labId: 'lab1' }, get_resume: {}, list_experience: {}, get_experience: { entryId: 'experience1' }, get_site_settings: {},
        list_fun_entries: {}, get_fun_entry: { entryId: 'entry1' }, list_inbox: {},
      };
      for (const [name, input] of Object.entries(inputs)) {
        const result = await client.callTool({ name, arguments: input });
        expect(result.isError).toBe(false);
        expect(result.structuredContent).toEqual({ ok: true, result: { operation: name, input } });
      }
    });

    test('validates writes and forwards concurrency expectations and retry keys exactly', async () => {
      const writes = [
        ['create_post_draft', postInput],
        ['update_post_draft', { postId: 'post1', expectedRevision: 2, expectedDraftRevision: 3, patch: { body: 'Updated body' }, idempotencyKey: 'stdio-update-post-0001' }],
        ['publish_post', { postId: 'post1', expectedRevision: 2, expectedDraftRevision: 4, idempotencyKey: 'stdio-publish-post-0001' }],
        ['unpublish_post', { postId: 'post1', expectedRevision: 3, idempotencyKey: 'stdio-unpublish-post-0001' }],
        ['discard_post_draft', { postId: 'post1', expectedRevision: 3, expectedDraftRevision: 4, idempotencyKey: 'stdio-discard-post-0001' }],
      ] as const;
      for (const [name, input] of writes) {
        const result = await client.callTool({ name, arguments: input });
        expect(result.isError).toBe(false);
        expect(result.structuredContent).toEqual({ ok: true, result: { operation: name, input } });
      }
      await client.callTool({ name: 'create_post_draft', arguments: postInput });
      const creates = requests.filter(request => request.operation === 'create_post_draft');
      expect(creates[0]).toEqual(creates[1]);
    });

    test('rejects unknown properties, missing revisions, excessive payloads and unsafe media URLs before HTTP', async () => {
      const before = requests.length;
      const invalidCalls = [
        { name: 'get_management_status', arguments: { token: 'not-a-tool-argument' } },
        { name: 'list_posts', arguments: { limit: 51 } },
        { name: 'publish_post', arguments: { postId: 'post1', expectedRevision: 1, idempotencyKey: 'stdio-invalid-key-0001' } },
        { name: 'update_post_draft', arguments: { postId: 'post1', expectedRevision: 1, expectedDraftRevision: 1, patch: {}, idempotencyKey: 'stdio-invalid-key-0002' } },
        { name: 'create_post_draft', arguments: { ...postInput, published: true } },
        { name: 'create_post_draft', arguments: { ...postInput, body: 'x'.repeat(120_001) } },
        { name: 'create_post_draft', arguments: { ...postInput, coverImage: { kind: 'image', alt: 'bad', url: 'javascript:alert(1)' } } },
      ];
      for (const invalid of invalidCalls) {
        const result = await client.callTool(invalid);
        expect(result.isError).toBe(true);
      }
      expect(requests.length).toBe(before);
    });

    test('returns actionable backend errors as MCP tool errors and never exposes credentials', async () => {
      const denied = await client.callTool({ name: 'get_inbox_message', arguments: { messageId: 'message1' } });
      expect(denied.isError).toBe(true);
      expect(denied.structuredContent).toEqual({ ok: false, error: { code: 'forbidden', message: 'Requires inbox:read.' } });
      const stale = await client.callTool({ name: 'publish_post', arguments: { postId: 'post1', expectedRevision: 1, expectedDraftRevision: 1, idempotencyKey: 'stdio-conflict-key-0001' } });
      expect(stale.isError).toBe(true);
      expect(stale.structuredContent).toMatchObject({ ok: false, error: { code: 'revision-conflict', field: 'expectedRevision' } });
      expect(stderr).toBe('');
      expect(JSON.stringify(requests)).not.toContain(token);
    });
  });
}
