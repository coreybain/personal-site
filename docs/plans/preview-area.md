# Draft preview area

Agreed 29 September 2026 (grill session). The spec for a private `/preview`
area where Corey reviews, schedules and publishes blog posts, and leaves
feedback that the agent acts on through the MCP server. Claude Code and Codex
both work from this document.

## Decisions

| # | Decision |
|---|---|
| 1 | The MCP server (`packages/mcp`) is configured in the repo for **both Claude Code (`.mcp.json`) and Codex (`.codex/config.toml`)**. Both run one launcher that loads the git-ignored root `.env`; no committed file holds a secret. |
| 2 | Access is by a **code issued through MCP**: short, single-use, 10-minute expiry, stored hashed. Redeeming it creates a **30-day rolling session** (httpOnly cookie). A revoke-all tool signs every browser out. |
| 3 | Scope is **blog posts only**. `/work` and Labs can follow later. |
| 4 | The area can change the live site, and keeps 30-day sessions with safeguards: explicit confirmation for publish and unpublish, every action in the management audit log, same-origin checks on every action, revoke-all. |
| 5 | Actions per post: **publish now; schedule / reschedule; cancel schedule; move back to draft (unpublish); publish changes; discard changes**. No in-browser text editing, no delete. |
| 6 | A scheduled post publishes **the latest draft at publish time**. The list flags "edited after scheduling" until the preview has been viewed. The public date is the scheduled time. |
| 7–10 | **Feedback**: select text (or hover/tap an image) → bubble with reactions ✅ love · ❓ unclear · 😠 don't like · 💬 note. A reaction shows on the anchor (Messenger-style); hovering again adds a note. Notes are text with emoji and one-tap reaction inserts. Chat keeps working as well. |
| 10 | Lifecycle: the agent resolves ❓/😠/notes with a **1–3 sentence reply** of what changed; resolved items collapse and can be reopened. ✅ are standing "keep" instructions and are never resolved. Anchors whose text no longer exists move to "No longer in the draft" with their quote. Everything is archived when the post publishes. |
| 11 | All scheduling is in **Sydney time** (AEST/AEDT, DST-aware). |
| 12–14 | The site moves to **Next 16 Cache Components** first, for the whole site, as its own verified change. Post reads are tagged `posts` (one tag: every post page and list reads the same list) and invalidated instantly: `updateTag` from preview Server Actions, `revalidateTag` from a secret route Convex calls after scheduled/MCP publishes. Everything else keeps a ≤5-minute refresh. |
| 15 | MCP gains **`upload_media`** (local file → Uploadfile → URL, width, height). |
| 16–18 | Scheduled publishes retry every minute for 15 minutes, then show **"Scheduled — failed"** with the reason in the preview list and MCP. **Email via Resend** (its HTTP API from a Convex action, `alerts.ts` — simpler than the `@convex-dev/resend` component and the same one key) from `alerts@spiritdevs.com` to `corey@spiritdevs.com`: failures always, plus a "went live" confirmation for scheduled posts. The API key is set in Convex as `RESEND_API_KEY`; until it exists, email is skipped and logged. |

## Build order

1. Cache Components migration, whole site; parity on pages, JS budget and LCP.
2. MCP connection: launcher, `.mcp.json`, `.codex/config.toml`, `MANAGEMENT_ENVIRONMENT`, a management token.
3. Convex: scheduling, preview codes and sessions, feedback, revalidation call, Resend.
4. Web: `/preview` list, `/preview/blog/[slug]`, actions, feedback UI.
5. End-to-end on production.

## As built (29 September 2026)

- **Web:** `/preview` (code form or list), `/preview/blog/[slug]` (the real post layout from the pending version, `instant = false`), Server Actions in `app/(site)/preview/actions.ts`, `components/site/preview/*`, `lib/preview.ts`, `lib/sydneyTime.ts`, `/api/revalidate`. Post dates now use the Sydney calendar day (`components/site/blog/meta.ts`).
- **Convex:** `previewAccess.ts` (codes, sessions, lockout, revoke), `preview.ts` (session-gated reads, actions, feedback), `lib/postSchedule.ts` + `postSchedule.ts` (rules and the every-minute publisher), `siteCache.ts` (calls `/api/revalidate`), `alerts.ts` (Resend). `publishPost` clears schedules and archives feedback; `publishPost`/`unpublishPost`/live `updatePost`/`removePost` revalidate the site.
- **MCP:** `create_preview_code`, `revoke_preview_sessions`, `schedule_post`, `unschedule_post`, `list_post_feedback`, `resolve_post_feedback`, and the local `upload_media`.
- **Environment:** Convex `SITE_ORIGIN`, `SITE_REVALIDATE_SECRET`, `MANAGEMENT_ENVIRONMENT`, and (to enable email) `RESEND_API_KEY` with optional `ALERT_FROM`/`ALERT_TO`; Vercel and `.env` `REVALIDATE_SECRET`.
- **CLI fallbacks:** `bunx convex run previewAccess:issueCodeForMachine` and `previewAccess:revokeAllForMachine`.
