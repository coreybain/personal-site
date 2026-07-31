import { createAnthropic } from "@ai-sdk/anthropic";
import type { ModelMessage } from "ai";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
} from "ai";
import { fetchAction, fetchMutation } from "convex/nextjs";

import { api } from "@home/convex/api";

import type {
  AskCitation,
  AskErrorBody,
  AskRetrieval,
  AskUIMessage,
} from "@/lib/ask-contract";
import { ASK_LIMITS } from "@/lib/ask-contract";
import {
  askConfiguration,
  groundingInstructions,
  parseAskRequest,
  unconfiguredMessage,
} from "@/lib/ask";
import { requestIdentifierHash } from "@/lib/requestIdentity";

/**
 * `POST /api/ask` — Ask Corey's answering route (ADR 015, build phase 6).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  The whole feature, as a sequence:
 *
 *    validate  →  meter  →  retrieve  →  ground  →  stream
 *
 *  Each step can refuse, and each refusal is an HTTP status with a
 *  machine-readable body (`AskErrorBody`) rather than a stream that says
 *  something went wrong. Nothing reaches Anthropic until the first four have
 *  passed.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── This route may fail. It may not fake. ──────────────────────────────────
 *
 * The deployment this ships to has **no `ANTHROPIC_API_KEY` and no
 * `OPENAI_API_KEY`**. Both absences are handled, and neither is papered over:
 *
 *   • no answering key  → `503` with `{ configured: false, missing: [...] }`
 *                          before a single token is generated. The `/ask` page
 *                          renders that state from `askConfiguration()` without
 *                          even making the request.
 *   • no embedding key  → the route answers normally, and the streamed
 *                          `data-retrieval` part carries `mode:
 *                          'lexical'` with `degraded: true` and
 *                          `reason: 'no-key'`. ADR 015 exists because v2's
 *                          lexical matcher was presented as AI; a UI that hides
 *                          this flag reintroduces exactly that.
 *
 * Set either key on the deployment and the corresponding path lights up on the
 * next request — nothing is read at module scope, so neither needs a redeploy.
 *
 * ── Metering: two buckets, counted once each ───────────────────────────────
 *
 * `ask.checkRateLimit({ bucket: 'ask' })` is called here, once per question
 * (10/hour). `ask.retrieve` then meters *itself* on the separate `ask-retrieve`
 * bucket (30/hour) as a backstop against someone calling the public action
 * directly. Calling `checkRateLimit` with `'ask-retrieve'` from this file would
 * double-count that backstop and is a documented mistake — don't.
 *
 * The identifier is a salted SHA-256 from `@/lib/requestIdentity`, the same
 * digest the contact form sends. No raw IP address is stored, logged, or sent
 * to Convex by any line below. That is a feature of this repository, not an
 * implementation detail.
 *
 * ── Why the answer streams but the failures do not ─────────────────────────
 *
 * A stream that opens with `200 OK` and then reports a rate limit inside its
 * body is a rate limit no proxy, no client library and no `curl -i` can see.
 * Every refusal below happens before `createUIMessageStreamResponse`, so `429`
 * carries a real `Retry-After` header and `503` a real status. Once the stream
 * is open the only failure left is a provider error mid-generation, which
 * arrives as an `error` chunk because by then there is no status line left to
 * change.
 *
 * ── Bundle cost ────────────────────────────────────────────────────────────
 *
 * Zero. A Route Handler has no client graph, so `ai`, `@ai-sdk/anthropic` and
 * `convex/nextjs` stay on the server however large they are. The `/ask` budget
 * in `tooling/perf/budgets.ts` covers the *page's* chat JS, which is the UI's
 * to spend — nothing in this file appears in it.
 */

/**
 * Node, not edge.
 *
 * `@/lib/requestIdentity` hashes with `node:crypto`. Declared rather than left
 * to the default so the constraint is stated where someone would otherwise
 * casually flip it — the same reason `/api/resume.pdf` declares it.
 */
export const runtime = "nodejs";

/**
 * Generation ceiling, in seconds, for platforms that read it (Vercel).
 *
 * A grounded two-to-five-sentence answer finishes in a few seconds. Thirty is
 * headroom for a slow provider, not a budget to fill: the request also carries
 * `abortSignal`, so a reader who closes the tab stops generation immediately
 * rather than paying for tokens nobody will read.
 */
export const maxDuration = 30;

/**
 * Output ceiling, in tokens.
 *
 * Deliberately small. The prompt asks for two to five sentences, this is a
 * public endpoint an anonymous caller can drive, and an answer that needs more
 * than this is an answer that has stopped citing and started essaying. When the
 * cap is reached the `finish` metadata carries `finishReason: 'length'`, so the
 * UI can say the answer was cut rather than presenting a sentence that stops
 * mid-word as though it were finished.
 *
 * ⚠️ Read with the `thinking: 'disabled'` setting below. `maxOutputTokens` caps
 * thinking *plus* visible text on models where thinking is on by default —
 * Sonnet 5 is one — so a value this small with thinking enabled would truncate
 * real answers. The two settings are a pair; change them together.
 */
const MAX_ANSWER_TOKENS = 1024;

/* ------------------------------------------------------------------ *
 * Refusals
 * ------------------------------------------------------------------ */

/**
 * One JSON refusal.
 *
 * `no-store` on every one of them: these bodies are per-request (a rate limit
 * decision, a validation message) and a cached `429` served to the next reader
 * would be a bug that is very hard to see.
 */
function refusal(
  body: AskErrorBody,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });
}

/**
 * `429`, from a Convex rate-limit decision.
 *
 * `Retry-After` is the header the decision's `retryAfterSeconds` field was named
 * for, and the body repeats it so a `fetch` caller does not have to read
 * headers. `resetAt` is there for a UI that would rather print a time than a
 * countdown.
 */
function rateLimited(decision: {
  limit: number;
  retryAfterSeconds: number;
  resetAt: string;
}): Response {
  const minutes = Math.max(1, Math.ceil(decision.retryAfterSeconds / 60));

  return refusal(
    {
      error: "rate-limited",
      configured: true,
      message:
        `That is ${decision.limit} questions this hour, which is the limit. ` +
        `Try again in ${minutes} minute${minutes === 1 ? "" : "s"} — or use the ` +
        `contact page, which is not limited.`,
      retryAfterSeconds: decision.retryAfterSeconds,
      resetAt: decision.resetAt,
      limit: decision.limit,
    },
    429,
    { "retry-after": String(Math.max(1, Math.ceil(decision.retryAfterSeconds))) },
  );
}

/**
 * `503`, when Convex is configured but did not answer.
 *
 * Distinct from the unconfigured `503` by its `error` code, and `configured` is
 * `true` — the keys are set, the dependency is simply down. The distinction
 * matters to the reader: one of these is worth retrying in a minute and the
 * other is not worth retrying at all.
 *
 * The underlying error is logged server-side and never returned. A Convex error
 * can carry a deployment name or an argument value, and this response is public.
 */
/**
 * The one sentence a mid-stream failure is allowed to put on the wire.
 *
 * Reached once the response is already `200` and streaming — a rotated key, a
 * provider outage, a refusal — so there is no status line left to change and
 * the only honest thing left is to say what happened in the stream itself.
 *
 * ⚠️ Must be passed to **both** `createUIMessageStream` *and* the inner
 * `toUIMessageStream`. They each carry their own `onError`, each defaulting to
 * the SDK's opaque "An error occurred.", and a provider failure surfaces
 * through the *inner* one — setting only the outer handler leaves the default
 * in place and looks fine right up until something actually breaks. Verified by
 * doing exactly that: with a placeholder key the stream ended
 * `{"type":"error","errorText":"An error occurred."}` until this was shared.
 *
 * The returned string reaches the client verbatim, so it is a complete sentence
 * and contains nothing else. The provider's own message — which can carry a key
 * prefix, an account id or a request id — is logged and never returned.
 */
function describeStreamFailure(context: string, error: unknown): string {
  console.error(`ask: ${context}`, error);

  return (
    "The answer stopped part-way through — that is a fault on this side, not " +
    "with the question. Try again, or use the contact page."
  );
}

function upstreamUnavailable(context: string, error: unknown): Response {
  console.error(`ask: ${context}`, error);

  return refusal(
    {
      error: "upstream-unavailable",
      configured: true,
      message:
        "Ask Corey could not reach its index just now, so there is nothing to " +
        "answer from. Try again in a moment — the rest of the site is unaffected.",
    },
    503,
  );
}

/* ------------------------------------------------------------------ *
 * The route
 * ------------------------------------------------------------------ */

export async function POST(request: Request): Promise<Response> {
  /* ---- 1. configuration ------------------------------------------ */

  // First, and before the body is even read: an unconfigured deployment should
  // spend nothing on a request it cannot serve.
  const configuration = askConfiguration();
  if (!configuration.configured) {
    return refusal(
      {
        error: "unconfigured",
        configured: false,
        message: unconfiguredMessage(configuration.missing),
        missing: configuration.missing,
      },
      503,
    );
  }

  /* ---- 2. the payload -------------------------------------------- */

  const parsed = await parseAskRequest(request);
  if (!parsed.ok) {
    return refusal(parsed.error, 400);
  }
  const { question, history } = parsed.request;

  /* ---- 3. who is asking, and may they ---------------------------- */

  // The one value Convex genuinely cannot obtain for itself: a salted digest of
  // the caller's address, computed where the address exists. See the header of
  // `@/lib/requestIdentity` for why it is hashed rather than sent.
  const identifierHash = await requestIdentifierHash();

  let decision: Awaited<ReturnType<typeof fetchMutation<typeof api.ask.checkRateLimit>>>;
  try {
    decision = await fetchMutation(api.ask.checkRateLimit, {
      bucket: "ask",
      identifierHash,
    });
  } catch (error) {
    return upstreamUnavailable("checkRateLimit failed", error);
  }

  if (!decision.allowed) {
    return rateLimited(decision);
  }

  /* ---- 4. retrieval ---------------------------------------------- */

  let retrieval: Awaited<ReturnType<typeof fetchAction<typeof api.ask.retrieve>>>;
  try {
    retrieval = await fetchAction(api.ask.retrieve, {
      query: question,
      identifierHash,
      limit: ASK_LIMITS.maxCitations,
    });
  } catch (error) {
    // Includes the action's own argument validation — an over-long or empty
    // query throws a `ConvexError` here. `parseAskRequest` already enforces the
    // same bounds, so reaching this branch for that reason means the two have
    // drifted; it is logged as an upstream failure and worth investigating.
    return upstreamUnavailable("ask.retrieve failed", error);
  }

  // `ok: false` has exactly one cause: the `ask-retrieve` backstop refused. The
  // per-question `ask` bucket already allowed this call, so a reader only sees
  // this by driving the public action directly — which is what the backstop is
  // for. It is still a 429, with the backstop's own numbers.
  if (!retrieval.ok) {
    return rateLimited(retrieval.rateLimit);
  }

  /* ---- 5. grounding ---------------------------------------------- */

  // The numbering contract, established once, in one place: source `n` in the
  // prompt is the citation whose `index` is `n`, and the UI resolves an `[n]`
  // marker by matching that field. Every downstream consumer reads this array;
  // nothing renumbers it.
  const citations: AskCitation[] = retrieval.results.map((result, position) => ({
    ...result,
    index: position + 1,
  }));

  const grounding: AskRetrieval = {
    mode: retrieval.retrievalMode,
    degraded: retrieval.degraded,
    reason: retrieval.reason,
    embeddingModel: retrieval.embeddingModel,
    corpus: retrieval.corpus,
  };

  /* ---- 6. the answer --------------------------------------------- */

  // The provider is constructed per request, not at module scope, so the key is
  // read at call time — set `ANTHROPIC_API_KEY` on a running deployment and the
  // next question uses it. (`createAnthropic()` with no `apiKey` reads the
  // environment itself, but doing it explicitly keeps the read in one place and
  // makes the dependency obvious to anyone auditing where the key is touched.)
  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = configuration.model;

  // Already flattened to `{ role, text }` by `parseAskRequest`, so no data part,
  // tool result or file a caller invented can reach the provider. The system
  // prompt is `instructions` — AI SDK 7's name for what older versions called
  // `system` — and is built server-side; the SDK rejects a `system` role inside
  // `messages` by default, which is a second guard on the same attack.
  const messages: ModelMessage[] = history.map((turn) => ({
    role: turn.role,
    content: turn.text,
  }));

  const result = streamText({
    model: anthropic(model),
    instructions: groundingInstructions(citations),
    messages,
    maxOutputTokens: MAX_ANSWER_TOKENS,
    // A closed tab stops generation. Without this the provider keeps producing
    // (and billing for) an answer no one is reading.
    abortSignal: request.signal,
    providerOptions: {
      anthropic: {
        // Thinking off, effort low. This is a short extractive answer over five
        // snippets that are already in the prompt — there is nothing to reason
        // about, and on Sonnet 5 thinking is *on by default*, where it would
        // both add latency and eat the `MAX_ANSWER_TOKENS` ceiling the visible
        // answer needs. If `ASK_MODEL` is ever pointed at a model where a
        // grounded answer benefits from deliberation, raise the ceiling in the
        // same change.
        thinking: { type: "disabled" },
        effort: "low",
      },
    },
    onError: ({ error }) => {
      // `streamText` does not throw for mid-stream provider failures; it emits
      // them. Logged here so a 401 from a rotated key is visible in the
      // deployment log rather than only as a sentence in somebody's chat.
      console.error("ask: generation failed", error);
    },
  });

  /* ---- 7. the wire ----------------------------------------------- */

  const stream = createUIMessageStream<AskUIMessage>({
    // Failures raised by the outer stream itself — a `writer.write` that
    // throws, an exception out of `execute`.
    onError: (error) => describeStreamFailure("stream failed", error),
    execute: ({ writer }) => {
      // Written *before* the model stream is merged, so the citation list and
      // the degradation flag are on the wire before the first token. A UI can
      // render its sources panel and its "keyword search" notice while the
      // answer is still arriving, and both persist in `message.parts` after it
      // has finished.
      //
      // Data parts rather than metadata because this is message *content*: it
      // is what makes an `[n]` marker resolvable, and what a reader checks the
      // answer against. Both carry a stable `id`, so a future revision can
      // update one mid-stream by writing the same id instead of appending a
      // second part.
      writer.write({ type: "data-retrieval", id: "retrieval", data: grounding });
      writer.write({ type: "data-citations", id: "citations", data: citations });

      writer.merge(
        toUIMessageStream({
          stream: result.stream,
          // The handler that actually fires for a provider failure — see
          // `describeStreamFailure`. Without it the SDK's default masks a
          // rotated key as "An error occurred."
          onError: (error) => describeStreamFailure("generation failed", error),
          // Called on `start` and again on `finish`; the SDK merges what each
          // pass returns. Facts *about* the message — which model answered,
          // what quota is left — as opposed to the sources above, which are
          // part of the message.
          messageMetadata: ({ part }) => {
            if (part.type === "start") {
              return {
                createdAt: Date.now(),
                model,
                rateLimit: {
                  limit: decision.limit,
                  remaining: decision.remaining,
                  resetAt: decision.resetAt,
                },
              };
            }
            if (part.type === "finish") {
              return { finishReason: part.finishReason };
            }
            return undefined;
          },
        }),
      );
    },
  });

  return createUIMessageStreamResponse({ stream });
}
