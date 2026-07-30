# `@home/convex`

The Convex backend for the whole site — web and iOS (ADR 005). Schema, queries,
mutations, crons and HTTP ingest routes all live in `convex/`.

```
packages/convex/
├── convex/
│   ├── schema.ts        # all 11 tables — mirrors the Zod schemas in @home/types
│   ├── auth.config.ts   # Clerk as the JWT issuer (ADR 006)
│   ├── snapshot.ts      # `api.snapshot.get` — the pattern-setting query
│   └── _generated/      # written by codegen, NOT by hand
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

> **Codegen is not offline in Convex 1.42.x, and `api.d.ts` is currently a stub.**
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

Everything below is done once, in this order. Steps 1 and 2 can be done in
either order, but 3 → 4 → 5 cannot be reordered: Clerk must exist before its
issuer URL can be given to Convex, and Convex must have that URL before any
authenticated call will succeed.

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

### 2. Create the Clerk application

In the [Clerk dashboard](https://dashboard.clerk.com):

1. **Create application** → name it `coreybaines.com`.
2. Enable the sign-in methods you want. This is a single-operator admin, so
   email + one social provider is plenty. **Turn off public sign-ups** once your
   own user exists — nobody else should ever be able to create an account.
3. From **API keys**, copy:
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (`pk_test_…` / `pk_live_…`)
   - `CLERK_SECRET_KEY` (`sk_test_…` / `sk_live_…`)

### 3. Add the `convex` JWT template in Clerk

**Configure → JWT templates → New template → Convex.**

- The template **must** be named exactly `convex`. That string is the
  `applicationID` in `convex/auth.config.ts`; Convex matches it against the
  token's `aud` claim. A mismatch does not error — every authenticated request
  simply looks unauthenticated.
- Leave the default claims as Clerk's Convex preset generates them.
- **Save**, then copy the **Issuer** URL shown on the template. It is your Clerk
  Frontend API URL:
  - dev: `https://<verb-noun-00>.clerk.accounts.dev`
  - prod: `https://clerk.coreybaines.com`

### 4. Give Convex the issuer URL

`auth.config.ts` reads `CLERK_JWT_ISSUER_DOMAIN` from the **Convex deployment**
environment, not from a local file — the file is evaluated on the Convex side.
Set it per deployment, in the [Convex dashboard](https://dashboard.convex.dev)
under **Settings → Environment Variables**, or from the CLI:

```sh
cd packages/convex
bunx convex env set CLERK_JWT_ISSUER_DOMAIN https://verb-noun-00.clerk.accounts.dev
bunx convex env set CLERK_JWT_ISSUER_DOMAIN https://clerk.coreybaines.com --prod
```

Dev and production are separate Clerk instances with separate issuer URLs. Set
both, or the production admin cannot log in.

Also mirror it into `packages/convex/.env.local` (see `.env.example`) so the
value is visible to anyone reading the repo's local config — the CLI does not
read it from there, but it documents which Clerk instance a checkout is pointed
at.

### 5. Wire the app

`apps/web/.env.local`:

```sh
NEXT_PUBLIC_CONVEX_URL=https://<name>.convex.cloud
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_…
CLERK_SECRET_KEY=sk_test_…
```

Then `ClerkProvider` must wrap `ConvexProviderWithClerk` (from
`convex/react-clerk`, passing Clerk's `useAuth`) in the root layout, so Convex
can read the Clerk session. Convex refuses the token otherwise.

### Which variable lands where

| Variable                            | Where it is set                          | Why there |
| ----------------------------------- | ---------------------------------------- | --------- |
| `CONVEX_DEPLOYMENT`                 | `packages/convex/.env.local` (by the CLI) | Tells the CLI which deployment to push to. Machine-local. |
| `CLERK_JWT_ISSUER_DOMAIN`           | **Convex dashboard**, per deployment      | Read by `auth.config.ts` at push time, on the Convex side. |
| `GITHUB_TOKEN` (PAT)                | **Convex dashboard**, per deployment      | Used by the hourly git cron. Private contributions only appear to your own token. |
| `NEXT_PUBLIC_CONVEX_URL`            | `apps/web/.env.local` + Vercel            | The browser client's endpoint. Public by design. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `apps/web/.env.local` + Vercel            | Clerk's browser SDK. Public by design. |
| `CLERK_SECRET_KEY`                  | `apps/web/.env.local` + Vercel            | Server-side Clerk calls in Next. Never `NEXT_PUBLIC_`. |

No secret belongs in `packages/convex/.env.local` other than what the CLI puts
there. Anything a Convex *function* needs at runtime goes in the Convex
dashboard, because functions do not see this repo's `.env` files at all.

## Scripts

| Script                | What it does |
| --------------------- | ------------ |
| `bun run dev`         | `convex dev` — watches `convex/`, pushes on save, regenerates types. Needs a login. |
| `bun run codegen`     | `convex codegen` — regenerates `convex/_generated`. No push, but it does need a configured, reachable deployment. |
| `bun run typecheck`   | `tsc --noEmit`. **Requires `_generated`**, which is committed — no codegen needed on a fresh checkout. |

## Deployment

Production pushes happen from CI with a deploy key (`CONVEX_DEPLOY_KEY` in
Vercel), via `bunx convex deploy`. Do not push to production from a laptop.
