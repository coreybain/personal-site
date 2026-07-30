# @home/seed

One-shot backfill of the live Convex deployment from the mock Snapshot.

```sh
cd tooling/seed && bun run seed
```

## What it does

`apps/web/src/lib/data.ts` prefers Convex and falls back to
`apps/web/src/lib/snapshot.ts` **per domain** — an empty table means the mock for
that domain only. So an empty deployment is indistinguishable from no
deployment. This script is what makes the switch visible: it maps the mock into
the shapes `packages/convex/convex/schema.ts` describes and hands them to
`seed:seedAll`, an `internalMutation` (unreachable from browsers, from iOS, and
from `ConvexHttpClient` — the CLI reaches it with deploy credentials).

## Safety

**Insert-only, and per table.** The mutation writes into a table only when that
table is currently empty, all six in one Convex transaction. There is no update
path, no delete path, and no `force` argument. Run it as many times as you like;
the second run writes nothing. **The admin owns this data the moment it lands** —
this is a ladder, not a refresh.

## Seeded / not seeded

| Table | |
|---|---|
| `siteSettings` `snapshot` `projects` `labs` `experienceEntries` `resumeDocument` | seeded |
| `funEntries` | **not seeded** — `photo` is a required `MediaAsset` and the mock's entries have no imagery. `/fun` keeps rendering from the mock. |
| `posts` | not seeded — no blog in the mock; ADR 018 ships `nav.blog: false` |
| `contactMessages` `ingestTokens` `knowledgeDocs` | not content — an inbox, credentials, a derived index |

Every synthesised, derived and skipped field is documented at the field in
`seed.ts`. Read those comments before changing a mapping.

## Requirements

No dependencies of its own. It shells out to `bunx convex run … --push` with
`packages/convex` as the working directory, so the Convex CLI and
`CONVEX_DEPLOYMENT` both come from that package. `--push` is required, not
optional: `convex run` executes the function as it exists *on the deployment*,
and `seed.ts` is a new module.

`tooling/*` is not yet in the root `workspaces` array, so `bun run seed` is run
from this directory rather than from the repo root.
