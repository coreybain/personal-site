/**
 * http.ts — the public HTTP surface. Two routes, both machine-to-machine.
 *
 * ```
 * POST /ingest/ai-usage   scope ai-usage:write   producer: tooling/collector (launchd, daily)
 * POST /ingest/health     scope health:write     producer: apps/ios (HKObserverQuery)
 * ```
 *
 * These exist because of the Ingest entry in the glossary: some data cannot be
 * pulled. The homepage's git Signal is a cron *calling out* to GitHub, but no
 * server can reach into `~/.codex` on a laptop or HealthKit on a phone, so those
 * two push. Nothing else does. There is no third route, and adding one to serve
 * a browser would be a mistake — the web app talks to Convex over the client
 * protocol with a Clerk session, which is authenticated, typed, reactive and
 * already there.
 *
 * ── Where this is served ──────────────────────────────────────────────────
 *
 * `https://<deployment>.convex.site` — the **`.convex.site`** domain, not
 * `.convex.cloud`. `.convex.cloud` speaks the Convex client protocol; this file
 * is served from a separate origin so that a browser reaching one can never
 * reach the other. Getting this wrong produces a 404 that looks like a routing
 * bug, so it is written down here rather than left to be rediscovered. Verified
 * 2026-07-31 against https://docs.convex.dev/functions/http-actions.
 *
 * ── Runtime ───────────────────────────────────────────────────────────────
 *
 * No `"use node"` directive, deliberately. HTTP actions run in Convex's default
 * V8 runtime, which is what these handlers want: neither route calls an external
 * API, and the default runtime has no cold start. `"use node"` would buy access
 * to npm/Node built-ins that nothing here needs and cost a container start on
 * the request path of a job that runs on a timer.
 *
 * ── No CORS headers, on purpose ───────────────────────────────────────────
 *
 * There is no `Access-Control-Allow-Origin` and no `OPTIONS` route. Neither
 * producer is a browser — one is a Bun script under launchd, the other is
 * `URLSession` on a phone — and both are unaffected by CORS, which is a browser
 * policy. Omitting it means no page on any origin can be induced to push, even
 * if it somehow held a token. Adding CORS here would be adding an attack surface
 * to serve a client that does not exist.
 *
 * ── Status codes, decided once ────────────────────────────────────────────
 *
 *   401  no `Authorization` header, not a `Bearer` scheme, unknown token, or a
 *        revoked token. Unknown and revoked deliberately look identical from
 *        outside — see `verifyToken`, which checks revocation before scope for
 *        the same reason.
 *   403  the token is real and live, but does not carry the scope this route
 *        requires. This is the ADR 006a property that matters: a compromised
 *        HealthKit token cannot post AI usage, and it finds out with a 403.
 *   400  the body is not JSON, or does not parse against the payload shape —
 *        including **an unknown key**, which is a privacy check and not a
 *        pedantry (see the header of ingest.ts).
 *   413  the body is larger than `MAX_BODY_BYTES`.
 *   200  written. The response is a terse JSON summary of what changed.
 *
 * Auth is checked *before* the body is read. A caller who cannot authenticate
 * learns nothing about what the endpoint would have accepted, and a 20 MB body
 * from an unauthenticated caller is never buffered.
 *
 * Every response is JSON, including the failures, because the consumer of a
 * failure here is a launchd job's log or an iOS retry policy — both of which
 * want a `code` to branch on rather than a sentence to regex.
 */

import { httpRouter } from 'convex/server';
import { internal } from './_generated/api';
import { httpAction } from './_generated/server';
import type { ActionCtx } from './_generated/server';
import { SNAPSHOT_REFOLD_FUNCTION, parseAiUsageBody, parseHealthBody } from './ingest';
import type { IngestProblem, ParseResult } from './ingest';

/* ------------------------------------------------------------------ *
 * Limits
 * ------------------------------------------------------------------ */

/**
 * Largest body either route will buffer, in bytes.
 *
 * Convex's own ceiling is 20 MB. These payloads are counts: the Collector's
 * biggest plausible push — a year of both agents, each day carrying a handful of
 * project slices — is well under 500 KB. 1 MB leaves an order of magnitude of
 * headroom while making "the producer is streaming a session file at us" a 413
 * instead of a timeout.
 *
 * Enforced on `Content-Length` first (cheap, and refuses before the transfer)
 * and on the decoded text second (a chunked request has no `Content-Length`).
 */
const MAX_BODY_BYTES = 1_000_000;

/* ------------------------------------------------------------------ *
 * Responses
 * ------------------------------------------------------------------ */

/** Machine-readable failure codes. The producer branches on these, not on prose. */
type IngestErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'payload-too-large'
  | 'malformed-body';

/**
 * A JSON response with no caching and no content sniffing.
 *
 * `no-store` because every one of these is the result of a write; `nosniff`
 * because there is no reason for any intermediary to guess at the type of a
 * response this specific.
 */
function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });
}

/**
 * An error response.
 *
 * `field` is carried through from the parser when there is one, so a Collector
 * log line names `days[3].projects[0].hours` rather than "invalid request".
 *
 * 401s carry `WWW-Authenticate: Bearer`, which is what makes the response
 * standards-correct rather than merely conventional: RFC 9110 requires the
 * header on a 401, and an HTTP client library that retries auth reads it.
 */
function errorResponse(
  status: number,
  code: IngestErrorCode,
  message: string,
  field?: string,
): Response {
  return json(
    status,
    { ok: false, error: field === undefined ? { code, message } : { code, field, message } },
    status === 401 ? { 'WWW-Authenticate': 'Bearer realm="ingest"' } : {},
  );
}

/* ------------------------------------------------------------------ *
 * Auth
 * ------------------------------------------------------------------ */

/** The scopes an ingest route can require. Mirrors `ingestScope` in schema.ts. */
type IngestScope = 'ai-usage:write' | 'health:write' | 'git:write';

/**
 * Pull the bearer credential out of an `Authorization` header.
 *
 * Returns `null` for a missing header or any scheme other than `Bearer`, both of
 * which the caller turns into a 401 *without touching the database* — an
 * unauthenticated flood should not become a write transaction per request.
 *
 * The scheme match is case-insensitive because RFC 9110 says auth schemes are,
 * and because `URLSession` and `curl` do not agree on the casing they send. The
 * credential itself is passed through verbatim: it is hashed on the other side,
 * so trimming, lowercasing or unescaping it would break verification in a way
 * that reads as "the token is wrong".
 */
function bearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization');
  if (header === null) return null;

  const separator = header.indexOf(' ');
  if (separator === -1) return null;

  if (header.slice(0, separator).toLowerCase() !== 'bearer') return null;

  const credential = header.slice(separator + 1).trim();
  return credential.length === 0 ? null : credential;
}

/**
 * Authenticate and authorise, or produce the response that refuses.
 *
 * Delegates to `internal.ingestTokens.verifyToken`, which is the single
 * definition of how a token is hashed and checked (ADR 006a) — this file never
 * hashes anything, so issue and verify cannot drift apart. That call is a
 * *mutation* rather than a query on purpose: a successful verify stamps
 * `lastUsedAt`, which is how the admin list shows that the collector stopped
 * running without any monitoring being built.
 *
 * @returns `{ ok: true, tokenName }` or `{ ok: false, response }`, so the route
 *   body stays a straight line rather than a nest of conditionals.
 */
async function authorize(
  ctx: ActionCtx,
  request: Request,
  requiredScope: IngestScope,
): Promise<{ ok: true; tokenName: string } | { ok: false; response: Response }> {
  const token = bearerToken(request);

  if (token === null) {
    return {
      ok: false,
      response: errorResponse(
        401,
        'unauthorized',
        'Missing or malformed Authorization header. Send `Authorization: Bearer ing_…`.',
      ),
    };
  }

  const result = await ctx.runMutation(internal.ingestTokens.verifyToken, {
    token,
    // Never omitted. `verifyToken` types this optional so a future non-scoped
    // use can exist; an ingest route that leaves it out has issued itself every
    // scope, which is precisely the failure ADR 006a exists to prevent.
    requiredScope,
  });

  if (!result.ok) {
    if (result.reason === 'missing-scope') {
      return {
        ok: false,
        response: errorResponse(
          403,
          'forbidden',
          `This token does not carry the ${requiredScope} scope.`,
        ),
      };
    }

    // 'unknown-token' and 'revoked' collapse into one response. Telling them
    // apart would confirm to a caller holding a revoked token that the token was
    // once real — and, worse, would let a brute-force distinguish a near miss.
    return {
      ok: false,
      response: errorResponse(401, 'unauthorized', 'That token is not valid.'),
    };
  }

  return { ok: true, tokenName: result.name };
}

/* ------------------------------------------------------------------ *
 * Body reading
 * ------------------------------------------------------------------ */

/**
 * Read the body, enforce the size cap, decode the JSON, and run `parse`.
 *
 * One function for both routes because the failure modes are identical and there
 * is exactly one interesting difference between the two endpoints — which parser
 * runs — which is the argument.
 *
 * `Content-Type` is deliberately **not** required to be `application/json`. The
 * body either parses as JSON or it does not, and that is the fact worth
 * enforcing; refusing a correct payload because a Swift `URLSession` extension
 * set `application/json; charset=UTF-8` in an unexpected form would be a
 * self-inflicted outage on a pipeline that runs unattended.
 */
async function readBody<T>(
  request: Request,
  parse: (raw: unknown) => ParseResult<T>,
): Promise<{ ok: true; value: T } | { ok: false; response: Response }> {
  const declaredLength = Number(request.headers.get('Content-Length') ?? Number.NaN);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: errorResponse(
        413,
        'payload-too-large',
        `Body exceeds ${MAX_BODY_BYTES} bytes. These endpoints take aggregates; chunk the push.`,
      ),
    };
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return {
      ok: false,
      response: errorResponse(400, 'malformed-body', 'Request body could not be read.'),
    };
  }

  // The chunked-transfer case, where `Content-Length` was absent above.
  if (text.length > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: errorResponse(
        413,
        'payload-too-large',
        `Body exceeds ${MAX_BODY_BYTES} bytes.`,
      ),
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // The parse error's message is not echoed. It quotes the input, and the
    // input on this endpoint is the one thing that must never reach a log.
    return {
      ok: false,
      response: errorResponse(400, 'malformed-body', 'Body is not valid JSON.'),
    };
  }

  const parsed = parse(raw);
  if (!parsed.ok) {
    return { ok: false, response: malformed(parsed.problem) };
  }

  return { ok: true, value: parsed.value };
}

/** A parser problem as a 400. Splits `field` out so the producer can branch on it. */
function malformed(problem: IngestProblem): Response {
  return errorResponse(
    400,
    'malformed-body',
    problem.message,
    problem.field === '' ? undefined : problem.field,
  );
}

/* ------------------------------------------------------------------ *
 * The snapshot refold
 * ------------------------------------------------------------------ */

/**
 * The Snapshot rebuild an AI-usage ingest asks for.
 *
 * **INTEGRATION SEAM** — the long version, including why the target is
 * `gitStats.rebuild` and not `snapshotBuild.apply`, is on
 * `SNAPSHOT_REFOLD_FUNCTION` in ingest.ts.
 *
 * This was a `makeFunctionReference("gitStats:rebuild")` while that module was
 * being written in parallel with this one; it is now the generated
 * `internal.gitStats.rebuild`, so the module, the export, the function kind and
 * the (empty) argument shape are all checked by `tsc`.
 */
const snapshotRefold = SNAPSHOT_REFOLD_FUNCTION;

/**
 * Ask for a Snapshot rebuild, and never fail the ingest over it.
 *
 * The write has already committed by the time this runs — `httpAction` is an
 * action, not a transaction, so a throw here cannot roll it back. That is the
 * design: the Snapshot is a *derived* row (ADR 004) rebuilt hourly by the cron
 * regardless, so the worst case of a missing, renamed or broken rebuild is that
 * the homepage shows the previous hour's figures for a while. Losing the raw row
 * because its derived copy could not be refreshed would be the wrong trade in
 * every direction, and it is the raw row that cannot be re-fetched from
 * anywhere.
 *
 * The `catch` is therefore load-bearing rather than defensive decoration, and it
 * was confirmed to fire: while `gitStats.ts` did not yet exist, this returned
 * `'unavailable'` and the push still 200'd — `ctx.scheduler.runAfter` rejects an
 * unresolvable reference at schedule time, so a broken seam does not even leave
 * a failing job behind. The reference is compiler-checked now, so that
 * particular cause is gone; the catch remains for the ones that are not
 * checkable ahead of time — a scheduler outage, or the deployment being at a
 * push where `rebuild` has been removed but this route has not.
 *
 * @returns what happened, echoed in the response so a curl during bring-up says
 *   whether the seam is connected yet.
 */
async function requestSnapshotRefold(ctx: ActionCtx): Promise<'scheduled' | 'unavailable'> {
  try {
    // `runAfter(0, …)` rather than `runAction`: the producer is waiting on this
    // response, and the target fetches GitHub and re-folds two tables.
    // Scheduling hands it to Convex to run immediately-but-separately, so the
    // push returns as soon as its own write has committed.
    await ctx.scheduler.runAfter(0, snapshotRefold, {});
    return 'scheduled';
  } catch {
    return 'unavailable';
  }
}

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */

/**
 * `POST /ingest/ai-usage` — the Collector's daily push (Pipeline 2).
 *
 * Body: `{ days: [{ day, agent, sessions, hours, projects: [{ projectSlug, sessions, hours }] }], postedAt }`.
 * Counts, durations and project slugs. Nothing else is accepted — an unknown key
 * is a 400, which is the mechanism the Verification plan's privacy assertion
 * rests on.
 *
 * Upserts by `(day, agent)`, refreshes `projects.aiBuildStats` for the projects
 * that moved (ADR 016), and asks for a Snapshot refold.
 */
const aiUsageIngest = httpAction(async (ctx, request) => {
  const auth = await authorize(ctx, request, 'ai-usage:write');
  if (!auth.ok) return auth.response;

  const body = await readBody(request, parseAiUsageBody);
  if (!body.ok) return body.response;

  const written = await ctx.runMutation(internal.ingest.recordAiUsage, body.value);
  const refold = await requestSnapshotRefold(ctx);

  return json(200, {
    ok: true,
    /** Which token wrote this. The producer's own label, echoed for its log. */
    token: auth.tokenName,
    daysCreated: written.daysCreated,
    daysUpdated: written.daysUpdated,
    /** Case studies whose `aiBuildStats` changed. */
    projectsUpdated: written.projectsUpdated,
    /** Case studies whose usage was revised away entirely. Almost always 0. */
    projectsCleared: written.projectsCleared,
    /**
     * Slugs with no matching `projects` row — a case study not written up yet.
     * A **count**, never the names (ADR 008), and not an error: the raw rows
     * keep the figures, so the numbers appear when the project does.
     */
    unmappedProjects: written.unmappedProjects,
    snapshotRefold: refold,
  });
});

/**
 * `POST /ingest/health` — the phone's daily movement push (Pipeline 3).
 *
 * Body: `{ days: [{ day, steps, distanceKm }], source: 'healthkit' | 'manual', postedAt }`.
 *
 * Upserts by `day`; a re-post replaces the day, which is the normal case rather
 * than the exception — HealthKit revises today's step count continuously, and
 * `HKObserverQuery` fires every time it does.
 *
 * No Snapshot refold is requested. `snapshot.healthStats` is folded hourly and
 * "steps as of the top of the hour" is the honest resolution for a figure the
 * dashboard renders as a life signal; scheduling a full rebuild every time a
 * watch syncs would be a rebuild every few minutes all day for no visible gain.
 */
const healthIngest = httpAction(async (ctx, request) => {
  const auth = await authorize(ctx, request, 'health:write');
  if (!auth.ok) return auth.response;

  const body = await readBody(request, parseHealthBody);
  if (!body.ok) return body.response;

  const written = await ctx.runMutation(internal.ingest.recordHealth, body.value);

  return json(200, {
    ok: true,
    token: auth.tokenName,
    daysCreated: written.daysCreated,
    daysUpdated: written.daysUpdated,
    /** Newest day in this push, echoed so the phone can confirm what landed. */
    latestDay: written.latestDay,
  });
});

/* ------------------------------------------------------------------ *
 * Router
 * ------------------------------------------------------------------ */

const http = httpRouter();

http.route({ path: '/ingest/ai-usage', method: 'POST', handler: aiUsageIngest });
http.route({ path: '/ingest/health', method: 'POST', handler: healthIngest });

// Only POST is routed. A GET on either path gets Convex's own 404, which is the
// right answer: there is nothing to read here, and a route that answered GET
// would be a route that could be reached by a link, a preview crawler or a
// browser address bar.
export default http;
