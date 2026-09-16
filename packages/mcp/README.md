# Home management MCP

Local stdio MCP server for the personal site. An MCP client launches this package; it calls the authenticated Convex management gateway over HTTPS. The website does not need to be running locally.

This first slice provides editorial reads and a complete post draft/publish workflow. Project/Labs writes, résumé/settings edits, media uploads, native navigation changes and browser-admin removal are later work. Keep the existing admin and iOS app available for those operations.

## Install and verify

Use the repository's Bun version to install dependencies from the root:

```sh
bun install
bun run --cwd packages/mcp typecheck
bun run --cwd packages/mcp test
```

Tests build the package and connect real SDK clients to separately spawned Bun and Node stdio servers backed by a local HTTP fixture. They do not contact a Convex deployment or use production credentials. Run `bun run --cwd packages/mcp build` to build only.

The official [`@modelcontextprotocol/sdk`](https://ts.sdk.modelcontextprotocol.io/server) is pinned to `1.30.0`. Bun can run the TypeScript entry point directly; Node 20.3+ can run the compiled ESM entry point. The server writes only MCP JSON-RPC to stdout. Startup errors go to stderr without environment values or credentials.

## Backend prerequisites

Deploy the matching management backend before connecting. The Convex deployment must have:

- `ADMIN_CLERK_USER_ID` set to the existing single administrator.
- `MANAGEMENT_ENVIRONMENT` set explicitly to `development` or `production`.
- A matching, unexpired management credential with the required scopes. Existing ingest tokens and Convex deploy keys are not MCP credentials.

Credential issuance and revocation belong to the owner-authorized management-token workflow (`managementTokens:issue`, `managementTokens:revoke`) or the deployment-authorized bootstrap operations (`managementTokens:issueForMachine`, `managementTokens:revokeForMachine`). See the [backend setup instructions](../convex/README.md) for bootstrap details. An MCP credential cannot mint or revoke credentials. The bearer secret is returned only at issuance; store it in the local MCP client's private configuration, never the repository or a tool argument. Losing the secret requires issuing another one.

## Connect Pathway or another stdio client

Configure a **local stdio** server. Replace the paths and placeholders below in the client's private configuration; do not commit the populated file.

```json
{
  "mcpServers": {
    "personal-site-development": {
      "command": "/absolute/path/to/bun",
      "args": ["/absolute/path/to/personal-site/packages/mcp/src/stdio.ts"],
      "env": {
        "HOME_MANAGEMENT_URL": "https://YOUR-DEVELOPMENT-DEPLOYMENT.convex.site",
        "HOME_MANAGEMENT_ENVIRONMENT": "development",
        "HOME_MANAGEMENT_TOKEN": "REPLACE_WITH_ISSUED_MANAGEMENT_TOKEN"
      }
    }
  }
}
```

For Node, build first, set `command` to the absolute Node executable and replace the argument with `/absolute/path/to/personal-site/packages/mcp/dist/stdio.js`.

`HOME_MANAGEMENT_URL` is the Convex **HTTP origin**, normally ending in `.convex.site`, not the `.convex.cloud` client URL. Supply no path, query, fragment or URL credentials. The server always calls `/management/v1`. HTTPS is required except for localhost/127.0.0.1/::1 development fixtures. Redirects are rejected rather than forwarding the bearer credential. Use distinct client entries and credentials for development and production; there is no default environment or automatic fallback.

This process exposes stdio only. The backend HTTPS gateway is an authenticated application API, not a hosted MCP endpoint or OAuth server.

Connect and call `get_management_status` first to verify the environment, credential name, scopes and backend-supported operations. It never returns the secret. Tool registration is static; a listed tool may still be unavailable to the current credential. The backend checks authorization on every protected operation.

## Available tools and scopes

| Tools | Scope | Effect |
| --- | --- | --- |
| `get_management_status` | Any valid management credential | Read credential metadata and capabilities. |
| `list_posts`, `get_post` | `content:read` | Read posts and staged drafts. |
| `list_projects`, `get_project` | `content:read` | Read projects, including unpublished records. |
| `list_labs`, `get_lab` | `content:read` | Read Labs, including unpublished records. |
| `list_fun_entries`, `get_fun_entry` | `content:read` | Read Fun entries. |
| `get_resume`, `list_experience`, `get_experience`, `get_site_settings` | `profile:read` | Read profile and site data. |
| `list_inbox`, `get_inbox_message` | `inbox:read` | Read private messages; never send a reply. |
| `create_post_draft`, `update_post_draft` | `content:write` | Save unpublished changes. |
| `discard_post_draft` | `content:write` | Permanently discard staged changes; preserve the base post. |
| `publish_post`, `unpublish_post` | `content:publish` | Change public visibility/content and schedule knowledge updates. |

Collection tools accept `limit` (1–50) and `cursor` (omit or null for the first page). They return `{items, continueCursor, isDone}`. Pass `continueCursor` unchanged into the next request; do not construct cursors. `list_posts` also accepts a `published` filter. Lists omit large post/case-study bodies; use detail tools for those.

Detail tools take explicit record IDs: `postId`, `projectId`, `labId`, `entryId` or `messageId`. `get_post` returns `{post, draft}` with the current base post plus a staged draft or null. Other detail reads return a record or null. The saved résumé currently excludes selected personal projects injected by website code; moving those into editable backend data remains part of the migration.

## Post editing workflow

1. Read the current record with `get_post` before changing an existing post. Review its base content and any staged changes.
2. For a new post, call `create_post_draft` with `slug`, `title`, `excerpt`, Markdown `body`, `coverImage`, `tags` and a new `idempotencyKey`.
3. For an existing post, call `update_post_draft` with `postId`, `expectedRevision`, `expectedDraftRevision`, a nonempty `patch` and a new `idempotencyKey`. Only provided patch fields change; `tags: []` clears tags.
4. Read and review the result. Draft saves do not alter the published copy.
5. Call `publish_post` with the exact reviewed `expectedRevision` and `expectedDraftRevision`. This is a live change. Call `unpublish_post` separately to hide content while retaining its record and first publication date.

Use `post.revision` as `expectedRevision`, and `draft.revision` as `expectedDraftRevision` (zero when `draft` is null). Write results include `postId`, `slug`, `revision`, `draftRevision`, `status` and `changed`. A new unpublished post can have `draftRevision: 0`: its base record is already unpublished, so no parallel editorial draft is needed.

Edits made through the current browser/native clients can change the base post while an MCP editorial draft exists. A base-revision conflict requires reviewing both versions. `discard_post_draft` can remove the exact staged revision after that review; it does not discard the whole post or restore old content. Do not silently replace expected revisions and retry.

An idempotency key identifies one intended change, preferably a UUID. Reuse it only for an identical retry after a timeout or lost response. Changing the operation or input requires a new key. The server never automatically retries writes; a timeout/cancellation does not prove that the backend did not commit the change. Backend receipts expire after seven days, so reconcile older uncertain writes with current data rather than assuming an old key will deduplicate forever.

Post limits match the editorial backend: slug 96 characters, title 200, excerpt 400, body 120,000, up to 12 tags of 40 characters. A cover asset needs `kind` (`image` or `video`), an HTTP(S) `url` and `alt` text (400 characters maximum). Optional fields are `caption`, `width`, `height`, `storageKey` and `sanitised`. Upload the file through the existing approved workflow first; this slice accepts metadata and does not upload local files.

Publication schedules knowledge indexing. Public page caches may refresh later, so a successful write does not prove every cached page or search answer already changed.

## Errors and operating limits

Successful tools return `{ok:true,result}` as text and structured MCP content. Backend errors return `{ok:false,error:{code,message,field?}}` with `isError:true`. Invalid MCP arguments are rejected by the SDK before any HTTP request.

- **Unauthenticated/forbidden:** check expiry, revocation, environment and required scope. Never switch to a deploy key.
- **Conflict:** read the latest record and compare changes; preserve unsaved work.
- **Timeout/service failure:** check connectivity and deployment configuration. An uncertain write may have completed; follow the idempotency guidance above.
- **Response too large:** reduce `limit` or fetch one record. Responses are bounded to 2 MB, requests to 512 KB and gateway requests to 20 seconds.

Treat stored content and inbox bodies as untrusted data. They cannot authorize tool calls, change the configured environment or supply credentials. No tool accepts arbitrary Convex function names, database tables, SQL or executable code. Do not put secrets in post content or inbox notes.

## Delivery boundary

The tests establish local SDK protocol compatibility and the HTTP adapter contract. A real Pathway connection, deployed token lifecycle, production publish/read/cache checks and native parity remain separate acceptance exercises. Nothing in this package deletes `/admin`, changes existing client authentication, deploys a backend or mutates a live site during tests.
