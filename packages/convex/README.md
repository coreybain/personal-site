# `@home/convex`

The Convex backend for the whole site — web and iOS (ADR 005). Schema, queries,
mutations, crons and HTTP ingest routes all live in `convex/`.

```
packages/convex/
├── convex/
│   ├── schema.ts            # all 11 tables — mirrors the Zod schemas in @home/types
│   ├── snapshot.ts          # `api.snapshot.get` — the pattern-setting query
│   ├── lib/auth.ts          # requireAdmin — every mutation's first line
│   ├── lib/validate.ts      # nowIso + the format checks Convex validators cannot express
│   ├── ingestTokens.ts      # issue / revoke / list / verifyToken (ADR 006a)
│   ├── contactMessages.ts   # public submit (rate limited) + the admin inbox
│   ├── knowledge.ts         # publish-time indexer for Ask Corey (ADR 015)
│   ├── ask.ts               # retrieval + citations + the rate limiter's surface
│   ├── lib/rateLimit.ts     # the fixed-window counter every public write uses
│   ├── siteSettings.ts      # the singleton the phone edits
│   └── _generated/          # written by codegen, NOT by hand
├── .env.example
└── package.json
```

Two things about this package differ from the rest of the monorepo, both forced
by Convex rather than chosen:

- **Source lives in `convex/`, not `src/`.** The Convex CLI discovers functions
  by directory, and every path in the dashboard, the CLI output and the docs
  assumes that name. `package.json#exports` therefore points into `convex/`.
- **`convex/_generated` must exist before `tsc` will pass.** It is written by
  `bun run codegen` and committed (see the root `.gitignore`), so a fresh
  checkout typechecks without running anything. Re-run codegen after adding or
  renaming a function file.

> **RESOLVED as of 2026-07-30 (phase 2): the deployment now exists, and
> `api.d.ts` is the real, fully typed article.** `packages/convex/.env.local`
> carries `CONVEX_DEPLOYMENT=dev:hip-dragon-50`, so `convex dev` regenerates
> `_generated/api.d.ts` on every save and `api.*` references ARE typechecked —
> a typo in `api.snapshot.get`, or a call with the wrong args, now fails
> `bun run typecheck` in `apps/web`. Commit the `api.d.ts` diff whenever you add
> or rename a function file. The history below is kept because it explains why
> `_generated` is committed at all, and it becomes true again on any checkout
> that has no `.env.local` (CI, a fresh clone).
>
> **Codegen is not offline in Convex 1.42.x, and `api.d.ts` was initially a stub.**
>
> `convex codegen` resolves a deployment before it generates anything. With no
> `CONVEX_DEPLOYMENT` it exits immediately (`✖ No CONVEX_DEPLOYMENT set`), and
> once it has one it still POSTs `/api/get_config_hashes` to that deployment to
> diff the module bundle. On a machine that has never run `convex dev` there is
> nothing to talk to, so the command cannot finish. (The CLI's own help text
> says "This doesn't modify the code running on the deployment", which is true
> but is not the same as needing no deployment.)
>
> What is committed in `_generated` is real CLI output, not hand-written, but it
> is the **pre-push** form. `dataModel.d.ts`, `server.js`, `server.d.ts` and
> `api.js` are final — they are derived from `schema.ts` alone and never change
> with the deployment. `api.d.ts` is the CLI's placeholder:
>
> ```ts
> export declare const api: AnyApi;
> ```
>
> The consequence is worth knowing before you trust a green build: `tsc` passes
> and `import { api } from '@home/convex/api'` resolves, but function references
> are **untyped**. A typo in `api.snapshot.get`, or a call with the wrong args,
> will not fail typecheck today.
>
> The first successful `bunx convex dev` (step 1 below) overwrites `api.d.ts`
> with the fully typed version generated from the pushed function graph. Commit
> that diff — from that point on the reference above is checked, and every later
> `bun run codegen` works because a deployment exists. Until then, treat the
> Convex call sites in `apps/web` as unverified by the compiler.
>
> If `_generated` ever goes missing, run codegen. Never author those files by
> hand: they are the compiler's view of the schema, and a hand-written version
> would typecheck while lying about the data model.

## Consuming it from `apps/web`

```ts
import { api } from '@home/convex/api';
import type { Doc } from '@home/convex/dataModel';

const snapshot = useQuery(api.snapshot.get);
```

---

## One-time setup

Everything below is done once, in this order.

### 1. Install and create the Convex project

From the repo root:

```sh
bun install
cd packages/convex
bunx convex dev
```

The first `convex dev` run is interactive. It will:

- ask you to log in (opens a browser — a Convex account is created if you have
  none);
- offer to create a new project. Name it `home`;
- create a **dev deployment** and write two variables into
  `packages/convex/.env.local`:
  - `CONVEX_DEPLOYMENT` — e.g. `dev:sturdy-mongoose-123`. Identifies the
    deployment the CLI pushes to. **Local only, never committed.**
  - `CONVEX_URL` / `CONVEX_DEPLOY_KEY` as applicable;
- push `schema.ts` and generate `convex/_generated`;
- then stay running, watching for changes. Leave it running while developing;
  `Ctrl-C` when done.

Copy the deployment URL it prints (`https://<name>.convex.cloud`) — step 5 needs
it.

> `bunx convex codegen` does the codegen half of the above without pushing, and
> this run is what first makes it usable: it needs the `CONVEX_DEPLOYMENT` the
> step above writes. CI and `bun run typecheck` rely on the committed
> `_generated` output, not on being able to run codegen — see the note at the
> top of this file for why that distinction matters.

### 2. Set the owner and management environment

There is no sign-in provider: Clerk was removed on 29 September 2026 (ADR
0021). Content is managed through the MCP server (`packages/mcp`), which
authenticates with scoped management tokens, and admin-only functions can be
run by the deployment owner from the CLI with `--identity`. Two Convex
environment variables make the management path work:

```sh
cd packages/convex
bunx convex env set ADMIN_CLERK_USER_ID <owner-subject>   # the owner every management token belongs to
bunx convex env set MANAGEMENT_ENVIRONMENT production     # must match the MCP server's HOME_MANAGEMENT_ENVIRONMENT
```

`ADMIN_CLERK_USER_ID` keeps its historical name; it is now just the owner's
identifier. Issue a management token with
`bunx convex run managementTokens:issueForMachine` (see `packages/mcp/README.md`).

### 3. Wire the app

`apps/web/.env.local` needs only `NEXT_PUBLIC_CONVEX_URL=https://<name>.convex.cloud`.
The web app reads Convex anonymously from the server; nothing on the site signs in.

### Which variable lands where

| Variable                            | Where it is set                          | Why there |
| ----------------------------------- | ---------------------------------------- | --------- |
| `CONVEX_DEPLOYMENT`                 | `packages/convex/.env.local` (by the CLI) | Tells the CLI which deployment to push to. Machine-local. |
| `GITHUB_TOKEN` (PAT)                | **Convex dashboard**, per deployment      | Used by the hourly git cron. Private contributions only appear to your own token. |
| `NEXT_PUBLIC_CONVEX_URL`            | `apps/web/.env.local` + Vercel            | The browser client's endpoint. Public by design. |
| `ADMIN_CLERK_USER_ID`               | **Convex dashboard**, per deployment      | The owner every management token belongs to, and the `--identity` subject for owner-only CLI calls. Management and admin access are denied when absent. |
| `MANAGEMENT_ENVIRONMENT`            | **Convex dashboard**, per deployment      | `production` or `development`; must match the MCP server's environment or every management call is refused. |
| `SITE_ORIGIN`                       | **Convex dashboard**, per deployment      | The public site's origin (`https://spiritdevs.com`), for cache revalidation and alert links. |
| `SITE_REVALIDATE_SECRET`            | **Convex dashboard** — and the site's `REVALIDATE_SECRET` | Authorises `siteCache.revalidatePosts` → `/api/revalidate`. The same value in both places. |
| `RESEND_API_KEY`                    | **Convex dashboard**, per deployment (optional) | Enables scheduled-publish emails (`alerts.ts`). `ALERT_FROM` and `ALERT_TO` override the defaults. |
| `OPENAI_API_KEY`                    | **Convex dashboard**, per deployment — *and* root `.env` + Vercel | The only provider key Ask Corey needs, held by two runtimes. Convex's copy embeds (`knowledge.ts`, `ask.ts`); the web app's copy answers (`/api/ask`). Same key, two environments. See below. |
| `ASK_MODEL`                         | root `.env` + Vercel (optional)           | Overrides the answering model id — an **OpenAI** id. Defaults to `gpt-5.6-luna`. |
| `RATE_LIMIT_SALT`                   | root `.env` + Vercel                      | Salts the identifier digest in `apps/web/src/lib/requestIdentity.ts`. Never reaches Convex. |

No secret belongs in `packages/convex/.env.local` other than what the CLI puts
there. Anything a Convex *function* needs at runtime goes in the Convex
dashboard, because functions do not see this repo's `.env` files at all.

## Management MCP setup (first milestone)

This milestone adds protected reads and post, project and Labs draft/publish workflows. The
implementation has **not been deployed**; the commands below are operator setup
instructions. The existing browser admin, native authentication and ingest
credentials remain in place. See the [MCP client setup](../mcp/README.md) for
connection configuration and the supported tools.

Management credentials are separate from ingest tokens and are bound to the
existing `ADMIN_CLERK_USER_ID` and one deployment environment. Set
`MANAGEMENT_ENVIRONMENT` on the **Convex deployment**, explicitly to
`development` or `production`. Missing or invalid configuration denies access;
the client environment must match, and changing the configured owner invalidates
credentials issued for the previous owner.

From `packages/convex`, after confirming the CLI targets the intended development
deployment:

```sh
bunx convex env set MANAGEMENT_ENVIRONMENT development
bunx convex dev --once
```

For production, set `MANAGEMENT_ENVIRONMENT=production` in that deployment's
dashboard and deploy through the existing CI process described below. Neither
environment gains an MCP credential just by deploying. Keep separate client
configurations and credentials; never give the MCP process a deploy key.

After deployment, bootstrap a credential through the Convex CLI, authenticated
with your deployment access. Replace the expiry placeholder with a future UTC
timestamp such as `YYYY-MM-DDTHH:mm:ss.sssZ`. This example grants editorial reads
and draft saves only; add `content:publish` only when the client should be able
to publish. Other scope families are listed in the MCP README.

```sh
umask 077
management_token_file="$(mktemp "${TMPDIR:-/tmp}/personal-site-management.XXXXXX")"
bunx convex run managementTokens:issueForMachine '{
  "name": "Pathway development editor",
  "environment": "development",
  "scopes": ["content:read", "content:write"],
  "expiresAt": "REPLACE_WITH_FUTURE_UTC_TIMESTAMP"
}' > "$management_token_file"
```

The private temporary file is outside the repository and contains the one-time
issuance response, including `token` and `tokenId`. Transfer the secret directly
to the MCP client's private configuration or credential store; keep it out of
terminal logs, shell history and tool arguments. Remove the temporary file after
secure storage. Convex retains only its SHA-256 digest, so a lost secret must be
replaced. For a production bootstrap, explicitly select `--prod` and use
`"environment": "production"`; never reuse the development credential.

The Clerk owner can call `managementTokens:issue`, `list` and `revoke`; list
returns metadata without hashes or secrets. Before native credential controls
exist, CLI recovery remains available without a browser session:

```sh
bunx convex run managementTokens:revokeForMachine '{"tokenId":"TOKEN_ID_FROM_ISSUANCE"}'
```

Use `--prod` when revoking a production credential. Revocation is immediate and
idempotent; ordinary MCP tokens cannot issue or revoke credentials. Every
protected operation checks owner, environment, expiry, revocation and scope
inside its database transaction, including idempotent retries.

Writes store their result and metadata-only audit entry atomically with the
content change. Retry receipts last **seven days**; the hourly cleanup removes
at most **100 expired receipts** per run. Reusing a key with a different request
fails, and retries after the retention window require checking current content.
`lastUsedAt` records successful writes and write replays; read-only requests do
not update it.

## Ask Corey keys (ADR 015 — build phase 6)

Ask Corey needs **one** provider key: `OPENAI_API_KEY`. It embeds the corpus and
it writes the answer.

It used to need two — OpenAI for embeddings, Anthropic for the completion. The
answering model moved to OpenAI (`gpt-5.6-luna` by default), so there is no
second vendor, no second dashboard and no second rotation. `ANTHROPIC_API_KEY`
is not read anywhere in this repository; delete it if you still have one set.

**One key, two runtimes.** The split that remains is not vendors, it is
environments — and it is unavoidable, because Convex functions never see this
repo's `.env` files and the Next app never sees Convex's:

| Key | Set on | Read by | Without it |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | the **Convex deployment** | `knowledge.ts` (indexing) and `ask.ts` (embedding the query) | Rows are indexed with `embedding: []`; retrieval falls back to the lexical index and reports `retrievalMode: 'lexical'`, `reason: 'no-key'`. A downgrade, not an outage |
| `OPENAI_API_KEY` | the **web app** (root `.env` + Vercel) | `/api/ask` in `apps/web` | The route cannot answer: `503 { configured: false, missing: ['OPENAI_API_KEY'] }`, before it spends anything. The widget renders that state and names the variable |
| `ASK_MODEL` | the **web app**, optional | `/api/ask` | Defaults to `gpt-5.6-luna`. An **OpenAI** id — a leftover `claude-…` value 404s at the provider on the first question |
| `RATE_LIMIT_SALT` | the **web app** | `apps/web/src/lib/requestIdentity.ts` | Counters still work and no raw address is ever stored, but bucket keys become computable by anyone who knows a visitor's IP. A warning is logged once per process |

Set it in one place only and the feature half-works, loudly: Convex-only
retrieves but cannot answer; web-only answers from keyword search and says so on
the `data-retrieval` part under every reply. Neither state is faked and neither
is silent.

### Exact commands

```sh
# Embeddings — set on the Convex deployment. Functions do not read this repo's
# .env files, so this is the ONLY place that works for the retrieval half.
cd packages/convex
bunx convex env set OPENAI_API_KEY sk-proj-…
bunx convex env set OPENAI_API_KEY sk-proj-… --prod

# Confirm. `--names-only` because plain `env list` prints the values.
bunx convex env list --names-only
```

```sh
# Answering + the rate-limit salt — the web side. Root .env for local runs
# (the root scripts already pass --env-file=.env), Vercel for deployed ones.
# The same sk-proj-… value as above.
OPENAI_API_KEY=sk-proj-…
ASK_MODEL=gpt-5.6-luna             # optional override, OpenAI ids only
RATE_LIMIT_SALT=$(openssl rand -hex 32)
```

> Turbo runs tasks in strict environment mode, so a variable in the root `.env`
> only reaches `next dev` / `next build` if it is named in `turbo.json`. All
> three of the variables in the block above — `OPENAI_API_KEY`, `ASK_MODEL` and
> `RATE_LIMIT_SALT` — are listed under `globalPassThroughEnv` there. Add any new
> runtime variable to that list in the same commit, or it will be set on the
> machine and invisible to the app: the failure is silent for the salt in
> particular, which merely logs `[rate-limit] RATE_LIMIT_SALT is not set` and
> carries on with an unsalted digest.

```sh
# …and the same on Vercel, for preview and production:
cd apps/web
bunx vercel env add OPENAI_API_KEY production
bunx vercel env add RATE_LIMIT_SALT production
```

### After setting `OPENAI_API_KEY`: backfill

Setting the key does **not** retro-embed anything. Every existing row was
written with `embedding: []` and `embeddingModel: ''`, which matches no model
and is therefore invisible to the `by_embedding` vector index. One command
fixes the whole corpus:

```sh
cd packages/convex
bunx convex run knowledge:backfill '{}'
```

It is an `internalAction`, so the CLI reaches it with the deployment's admin key
and nothing had to be made public. Sequential by design, and it reports
honestly:

```jsonc
// on a deployment with no key — this is the expected output, not a failure
{ "total": 8, "indexed": 8, "embedded": 0, "notEmbedded": 8,
  "reasons": { "no-key": 8 } }

// with the key set — the state to aim for. Until this command is run, the key
// being present changes nothing: the corpus is still all `embedding: []` and
// retrieval still reports `mode: 'lexical'`, `reason: 'empty-vector-index'`.
{ "total": 8, "indexed": 8, "embedded": 8, "notEmbedded": 0, "reasons": {} }
```

`embed()` reads `process.env.OPENAI_API_KEY` **per call**, so the key takes
effect on the next function invocation — no redeploy, no restart. Confirm the
index is live with:

```sh
bunx convex run ask:corpusStats '{}'      # { published: 8, embedded: 8 }
```

Re-run the backfill after changing `EMBEDDING_MODEL` (and the schema's
`dimensions` with it), and after any bulk import that bypassed the publish hooks.

### Checking retrieval by hand

```sh
cd packages/convex
bunx convex run ask:retrieve '{
  "query": "What is QuoteCloud?",
  "identifierHash": "cfe7b5dfcaa238d8f3695dc28f0021f5f048ca560dc8b26d4833f8f0a976ee65"
}'
```

`identifierHash` is required and must be 64 lowercase hex characters — it is the
rate-limit key, and the real one is a **salted digest of the caller** computed in
`apps/web/src/lib/requestIdentity.ts`. Any digest works from the CLI; a raw IP
address never does, by design.

Read `retrievalMode` in the response before reading `results`. `'lexical'` means
the answer is coming from full-text search, which is the class of thing ADR 015
exists to replace — the route surfaces it to the reader for the same reason.

### Rate limits

| Bucket | Limit | Enforced by |
| --- | --- | --- |
| `ask` | 10 / hour | the `/ask` route, via `api.ask.checkRateLimit` |
| `ask-retrieve` | 30 / hour | `api.ask.retrieve` itself — a backstop on the public action |
| `contact` | 3 / hour | inside `contactMessages.submit` |

Fixed window, one row per (bucket, identifier), reset in place. The trade-off is
argued in `convex/lib/rateLimit.ts`; the numbers are mirrored (documentation
only) as `RATE_LIMIT_POLICY` in `@home/types`.

```sh
# housekeeping — also runs daily by cron
bunx convex run ask:pruneRateLimits '{}'

# ops escape hatch: age one counter's window so the rollover can be observed
# without waiting an hour. Internal — a public version would be a bypass.
bunx convex run ask:rewindRateLimitWindow '{"bucket":"ask","identifierHash":"…"}'
```

## Scripts

| Script                | What it does |
| --------------------- | ------------ |
| `bun run dev`         | `convex dev` — watches `convex/`, pushes on save, regenerates types. Needs a login. |
| `bun run codegen`     | `convex codegen` — regenerates `convex/_generated`. No push, but it does need a configured, reachable deployment. |
| `bun run typecheck`   | `tsc --noEmit`. **Requires `_generated`**, which is committed — no codegen needed on a fresh checkout. |

## Deployment

Production pushes happen from CI with a deploy key (`CONVEX_DEPLOY_KEY` in
Vercel), via `bunx convex deploy`. Do not push to production from a laptop.
