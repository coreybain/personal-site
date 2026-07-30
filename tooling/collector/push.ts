/**
 * push.ts — the one function in this package that opens a socket.
 *
 * `POST {convexSiteUrl}/ingest/ai-usage`
 *   Authorization: Bearer ing_…
 *   Content-Type: application/json
 *   body: AiUsageIngest
 *
 * Note the host: Convex serves `convex/http.ts` routes from
 * `https://<deployment>.convex.site`, which is a different origin from the
 * `.convex.cloud` the web app's sync client talks to. Pointing this at `.cloud`
 * produces a 404 that looks like a routing bug for about twenty minutes.
 *
 * The body is `JSON.stringify` of whatever `buildPayload` returned, and
 * `buildPayload` returns a value that has been through `AiUsageIngestSchema`.
 * This module deliberately does not construct, merge, decorate or annotate the
 * payload — no client version, no hostname, no run id. If it did, the thing on
 * the wire would no longer be the thing the privacy tests validated.
 *
 * ── Retries ────────────────────────────────────────────────────────────────
 *
 * Idempotence is the endpoint's, not ours: every row upserts on (`day`,`agent`),
 * so re-sending the same body is a no-op rather than a doubling (see the raw
 * table rationale in packages/types/src/ingest.ts). That is what makes a blind
 * retry safe here and would not be safe against an appending endpoint.
 *
 * Retried: network failures and 5xx. Not retried: 401/403 (the token is wrong or
 * revoked — retrying is just a slower way to be refused) and 4xx generally (the
 * body is wrong, and it will still be wrong in ten seconds).
 */

import type { AiUsagePayload } from './payload';

const ENDPOINT_PATH = '/ingest/ai-usage';

/** Give up on a single attempt after this long. A daily job can afford to wait. */
const REQUEST_TIMEOUT_MS = 30_000;

const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 2_000;

/**
 * What the route reported about the write, when it said.
 *
 * Mirrors `AiUsageIngestResultSchema` in `@home/types`. Every field is nullable
 * because this is parsed defensively (see `pushAiUsage`): a successful write
 * that returned a body this collector did not recognise is still a successful
 * write, and failing a launchd job over a response it could not read would turn
 * a cosmetic mismatch into a missing day of data.
 */
export type IngestReport = {
  daysCreated: number | null;
  daysUpdated: number | null;
  projectsUpdated: number | null;
  unmappedProjects: number | null;
  snapshotRefold: string | null;
};

export type PushResult =
  | ({
      ok: true;
      status: number;
      attempts: number;
    } & IngestReport)
  | {
      ok: false;
      /** `null` when no response was received at all. */
      status: number | null;
      /** Short, already-safe: a status line or an error name. Logged verbatim. */
      detail: string;
      attempts: number;
    };

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Send one payload. Returns a result rather than throwing, so the CLI can set an
 * exit code and launchd can log a line instead of a stack trace.
 *
 * @param token - the plaintext `ing_…` token. Sent verbatim, prefix included:
 *   the prefix is part of what `ingestTokens.verifyToken` hashes.
 */
export async function pushAiUsage(
  payload: AiUsagePayload,
  options: { convexSiteUrl: string; token: string },
): Promise<PushResult> {
  const url = `${options.convexSiteUrl.replace(/\/+$/, '')}${ENDPOINT_PATH}`;
  const body = JSON.stringify(payload);

  let lastDetail = 'no attempt made';
  let lastStatus: number | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.token}`,
          'Content-Type': 'application/json',
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.ok) {
        // The route returns `AiUsageIngestResultSchema`. Read it defensively —
        // a successful write that returned an unexpected body is still a
        // successful write, and failing the run over it would be theatre.
        const report: IngestReport = {
          daysCreated: null,
          daysUpdated: null,
          projectsUpdated: null,
          unmappedProjects: null,
          snapshotRefold: null,
        };
        try {
          const parsed: unknown = await response.json();
          if (typeof parsed === 'object' && parsed !== null) {
            const record = parsed as Record<string, unknown>;
            for (const key of [
              'daysCreated',
              'daysUpdated',
              'projectsUpdated',
              'unmappedProjects',
            ] as const) {
              if (typeof record[key] === 'number') report[key] = record[key];
            }
            if (typeof record.snapshotRefold === 'string') {
              report.snapshotRefold = record.snapshotRefold;
            }
          }
        } catch {
          /* keep the nulls */
        }

        return { ok: true, status: response.status, attempts: attempt, ...report };
      }

      lastStatus = response.status;
      lastDetail = `HTTP ${response.status} ${response.statusText}`.trim();

      // 4xx is a verdict on this request. Repeating it changes nothing.
      if (response.status < 500) {
        return { ok: false, status: lastStatus, detail: lastDetail, attempts: attempt };
      }
    } catch (error) {
      lastStatus = null;
      // Name **and** message, deliberately, and this comment used to claim
      // otherwise. A transport failure is the one class of failure with no HTTP
      // status to explain it, and `TypeError` on its own does not distinguish
      // "laptop is on a captive-network portal" from "DNS is down" from "the
      // deployment origin in the config has a typo" — which is exactly what the
      // launchd log exists to answer at 09:20 on a morning nobody is watching.
      //
      // The cost is that Bun/undici embed the request URL, and sometimes the
      // resolver detail, in `error.message`, so both land in
      // `~/Library/Logs/com.coreybaines.home-collector.log`. That is accepted:
      // the URL is `convexSiteUrl`, a public deployment origin that is already
      // in the committed config template, and the token is never in a URL — it
      // is an `Authorization` header, which no fetch error quotes. Nothing about
      // ADR 008 is at stake either; a repo name cannot reach this string.
      lastDetail = error instanceof Error ? `${error.name}: ${error.message}` : 'fetch failed';
    }

    if (attempt < MAX_ATTEMPTS) {
      await sleep(RETRY_BASE_DELAY_MS * attempt);
    }
  }

  return { ok: false, status: lastStatus, detail: lastDetail, attempts: MAX_ATTEMPTS };
}

/** The URL this collector would post to. Printed by the dry run. */
export function endpointFor(convexSiteUrl: string): string {
  return `${convexSiteUrl.replace(/\/+$/, '')}${ENDPOINT_PATH}`;
}
