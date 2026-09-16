# MCP management security review

Reviewed 17 September 2026, before the initial MCP commit. Scope: the new
management gateway, credential lifecycle, post workflow, stdio adapter and
existing post endpoints affected by the shared-operation extraction.

No remaining critical or high-severity unauthorized-write issue was found in
this scope. Anonymous callers, other signed-in Clerk accounts, guessed tokens,
expired/revoked tokens and read-only credentials are rejected in the tested
paths. This is a source review and local integration result, not a production
penetration test or verification of deployed configuration.

## Findings resolved before this review

1. **High: read-only inbox access exposed an upload capability.** The scoped
   inbox detail now projects readable fields and excludes `attachmentSecret`
   and storage keys. A real HTTP/Convex integration test verifies this boundary.
2. **Low: malformed write arguments returned misleading server errors.** The
   gateway validates against the shared operation shape and returns safe input
   errors, without echoing arguments or credentials.

No unresolved critical/high findings remain from these checks.

## Controls verified

| Boundary | Evidence |
| --- | --- |
| Machine requests cannot choose arbitrary functions or tables | `packages/convex/convex/managementHttp.ts:21` enforces an explicit operation allowlist. |
| Unknown or incorrectly configured credentials fail closed | `packages/convex/convex/lib/managementAuth.ts:24` and `:50` require explicit environment, owner binding, digest lookup, expiry, revocation and operation scope. |
| Credentials have substantial random entropy and are not stored in plaintext | `packages/convex/convex/lib/managementAuth.ts:34` hashes a 32-byte random secret; issuance returns the plaintext once. |
| Other signed-in users cannot mint or revoke tokens | `packages/convex/convex/managementTokens.ts:57` uses `requireAdmin`; CLI bootstrap/recovery use internal functions. |
| Legacy post APIs do not bypass authorization | `packages/convex/convex/posts.ts:175` and the other five write handlers check the exact owner before shared domain operations. |
| Revocation and scopes still apply to retries | Authorization occurs before idempotency lookup inside the write transaction. |
| Editing does not silently publish content | Separate staged rows and required base/draft revisions protect the live post. Publishing requires `content:publish`. |
| Credentials are not forwarded through redirects | `packages/mcp/src/backend.ts` rejects redirects; config requires HTTPS except loopback fixtures. |
| Browser requests do not gain management access | The gateway rejects Origin-bearing requests; this is additional protection, not a replacement for token authorization. |

The added denial test calls the actual HTTP router and legacy public mutations,
then checks that rejected requests created no content, receipts or audit rows.
Existing tests cover wrong owner/environment, absent configuration, revocation
on replay, private drafts, transaction rollback and credential redaction.

## Deployment boundary

Management is not deployed or enabled by this review. Before rollout, confirm
the intended deployment's `ADMIN_CLERK_USER_ID` and `MANAGEMENT_ENVIRONMENT`,
issue a minimally scoped credential through the owner/deployment-authorized
bootstrap, and repeat the deployed denial and client-connection checks. Keep
credentials in private client configuration and revoke them if exposed.

This slice bounds request/response sizes and list pages. It does not add a
dedicated management request-rate limiter; availability/load testing is outside
this authorization review. Public contact/Ask rate limits remain unchanged.

Framework behavior was checked against the official
[Convex internal-functions guidance](https://docs.convex.dev/functions/internal-functions)
and [authorization guidance](https://docs.convex.dev/auth/overview). The installed
security skill has no Convex-specific reference; the review traced the actual
implementation and used local integration tests.
