/**
 * ask-contract.ts — the wire shapes `/api/ask` and the `/ask` UI both speak.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  NOT server-only, and that is the point. This module holds **types and
 *  constants only** — no `process.env`, no `next/headers`, no Convex client,
 *  no `ai` runtime import. A `"use client"` chat component may import from it
 *  directly; `@/lib/ask` (which is server-only) may not be imported there.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The split exists because the two halves of Ask Corey are written by different
 * hands against the same envelope. Leaving the envelope inside the server-only
 * module would force the UI to re-declare it, and a re-declared wire type is a
 * wire type that drifts the first time a field is added. Everything below is a
 * single source of truth for both sides.
 *
 * ── Nothing here is hand-typed from the backend ────────────────────────────
 *
 * `AskCitation`, `AskRetrievalMode` and `AskRetrievalReason` are **derived**
 * from `FunctionReturnType<typeof api.ask.retrieve>` rather than copied out of
 * `packages/convex/convex/ask.ts`. That package's `exports` map only publishes
 * `./api`, `./dataModel` and `./schema`, so its `RetrievalReason` union is not
 * importable — but the generated `api.d.ts` carries the action's return type in
 * full, and reading the field off it means a new `reason` variant landing in
 * Convex is a *type error here*, not a silently unhandled string in the UI.
 *
 * The import is `import type`, so with `isolatedModules` on (see the app's
 * tsconfig) it is erased entirely — no Convex code reaches any bundle because
 * of this file.
 *
 * ── ADR 015, restated as a data structure ──────────────────────────────────
 *
 * `AskRetrieval.mode` and `.degraded` are not diagnostics. They are the
 * ADR's honesty requirement in the payload: real retrieval is vector search over
 * embeddings, and the lexical path that answers when vectors cannot is *the same
 * class of thing ADR 015 exists to replace*. A UI that renders a lexical answer
 * as though it were a vector one would be the v2 matcher wearing the new label.
 * Render the flag.
 *
 * The live deployment retrieves on **vectors** — one `OPENAI_API_KEY` powers
 * embeddings and answering both, and `knowledge:backfill` has been run against
 * the corpus (all 8 published rows embedded, 2026-07-31). The lexical path is
 * therefore the *fallback*, not the status quo, and it is reached in exactly two
 * situations: a fresh deployment whose rows still carry `embedding: []` (expect
 * `reason: 'empty-vector-index'` until backfill runs), or a Convex deployment
 * with no key at all (`reason: 'no-key'`). Both remain reachable, so both are
 * still the UI's job to render — do not assume the vector path.
 */

import type { UIMessage } from "ai";
import type { FunctionReturnType } from "convex/server";

import type { api } from "@home/convex/api";

/* ------------------------------------------------------------------ *
 * Derived from the Convex action, never re-typed
 * ------------------------------------------------------------------ */

/** The full envelope `api.ask.retrieve` resolves to. Internal to this module. */
type RetrieveResult = FunctionReturnType<typeof api.ask.retrieve>;

/** `'vector'` | `'lexical'`. See the ADR note in this file's header. */
export type AskRetrievalMode = RetrieveResult["retrievalMode"];

/**
 * Why retrieval is not running on vectors, or `null` when it is.
 *
 * `null` is the live deployment's value: retrieval runs on vectors. The two
 * non-null variants are the fallback paths, and neither is an error.
 *
 * `'empty-vector-index'` means the key is set on the Convex deployment but
 * `knowledge:backfill` has not run there, so nothing is embedded — the state a
 * *fresh* deployment starts in. `'no-key'` means that deployment's
 * `OPENAI_API_KEY` is missing entirely. The two want different sentences from
 * the UI: one is a command somebody has not run, the other is a variable
 * somebody has not set.
 */
export type AskRetrievalReason = RetrieveResult["reason"];

/**
 * One retrieved source, plus the number the answer's `[n]` markers refer to.
 *
 * `index` is added by the route and is 1-based, so `citations[0].index === 1`.
 * It exists because the marker in the prose has to survive a UI that filters,
 * re-orders or collapses the list — resolve `[n]` by matching `index`, never by
 * array position.
 *
 * `score` is a real cosine similarity on the vector path and **`null` on the
 * lexical path**. Convex's search index returns documents in relevance order
 * without exposing a score, so there is no number to show; rendering one would
 * mean inventing it. Show rank, or show nothing.
 */
export type AskCitation = RetrieveResult["results"][number] & { index: number };

/* ------------------------------------------------------------------ *
 * The streamed envelope
 * ------------------------------------------------------------------ */

/**
 * How the answer's context was found — the fact ADR 015 insists is surfaced.
 *
 * Delivered as a **data part** (`data-retrieval`, stable id `"retrieval"`)
 * before the first token, alongside `data-citations`. Two parts rather than one
 * envelope because they answer different questions: this one is *how the answer
 * was grounded*, the other is *what it was grounded in*, and a UI renders them
 * in different places — a notice above the answer, a list of chips below it.
 *
 * `mode: 'lexical'` means the vector index could not answer — no embedding key
 * on the Convex deployment, or a corpus nobody has backfilled — and retrieval
 * fell back to Convex's text search: the same class of matcher the rebuild
 * exists to replace. Say so in words. The live deployment sends
 * `mode: 'vector'`, so this is the branch that is easy to leave untested and
 * exactly the branch worth rendering carefully.
 */
export type AskRetrieval = {
  /** ⚠️ Surface this. `'lexical'` means degraded — see the file header. */
  mode: AskRetrievalMode;
  /** `mode === 'lexical'`. The same fact, pre-computed for a `&&`. */
  degraded: boolean;
  /** Machine-readable *why*. `null` only on the un-degraded vector path. */
  reason: AskRetrievalReason;
  /** Embedding model used, or `null` when the query was never embedded. */
  embeddingModel: string | null;
  /**
   * The state of the index. `{ published: 8, embedded: 8 }` on the live
   * deployment (backfilled 2026-07-31) — a fully embedded corpus. The field
   * earns its place in the degraded case: `embedded: 0` lets the UI say
   * "nothing is embedded yet" rather than the much less useful "no match".
   */
  corpus: { published: number; embedded: number } | null;
};

/**
 * The ranked citation list, delivered as a **data part** (`data-citations`,
 * stable id `"citations"`) before the first token of the answer.
 *
 * A data part rather than message metadata because this is message *content*:
 * the list is what a reader checks the answer against, it persists in
 * `message.parts`, and it is what makes `[1]` resolvable after the stream ends.
 * Metadata (below) carries facts *about* the message instead — which model, what
 * quota is left — exactly the split the AI SDK's own guidance draws.
 *
 * Sent as one part carrying the whole list, never one part per source: the list
 * is **ranked**, and ranking is the thing that gets lost when it is split.
 */
export type AskCitations = AskCitation[];

/**
 * Per-message metadata, sent on `start` and again on `finish`.
 *
 * Every field is optional because the AI SDK calls the producing callback twice
 * and merges what it returns: the `start` pass knows the model and the quota,
 * the `finish` pass knows how generation ended. A client must treat any field as
 * possibly-absent mid-stream.
 */
export type AskMetadata = {
  /** `Date.now()` at the moment the answer began streaming. */
  createdAt?: number;
  /** The answering model id actually used, after the `ASK_MODEL` override. */
  model?: string;
  /**
   * What is left of this reader's hourly allowance, *after* this question.
   * Straight from the Convex meter; `resetAt` is RFC 3339 UTC.
   */
  rateLimit?: { limit: number; remaining: number; resetAt: string };
  /**
   * How generation ended — `'stop'` is the normal case. `'length'` means the
   * answer was cut off at `MAX_ANSWER_TOKENS` and the UI may want to say so.
   */
  finishReason?: string;
};

/**
 * The `UIMessage` shape for this route. Pass it to `useChat<AskUIMessage>()`
 * and to `DefaultChatTransport` so `message.metadata` and the `data-citations`
 * and `data-retrieval` parts are all typed rather than `unknown`.
 */
export type AskDataParts = {
  /** → part type `data-citations`. One part, the whole ranked list. */
  citations: AskCitations;
  /** → part type `data-retrieval`. How that list was found. */
  retrieval: AskRetrieval;
};

export type AskUIMessage = UIMessage<AskMetadata, AskDataParts>;

/* ------------------------------------------------------------------ *
 * Failures — every non-200 has this body
 * ------------------------------------------------------------------ */

/**
 * Which environment variables a fully-configured Ask Corey needs.
 *
 * Two, and only two — because `OPENAI_API_KEY` is now both halves of the
 * feature. It answers (read by the route, from the web app's environment) and
 * it embeds (read by `knowledge.ts` and `ask.ts`, from the *Convex
 * deployment's* environment). Same credential, two runtimes.
 *
 * ⚠️ This list is what the **web app** requires, so `OPENAI_API_KEY` here means
 * the answering copy. A deployment can be fully `configured` by this measure
 * and still retrieve lexically, because Convex's copy is unset or the corpus
 * was never backfilled — a downgrade, not an outage, and reported separately on
 * `AskRetrieval`. Never collapse the two: an unanswerable question and a
 * keyword-matched one are different facts and get different panels.
 */
export type AskRequiredEnvVar = "OPENAI_API_KEY" | "NEXT_PUBLIC_CONVEX_URL";

/**
 * Why the route refused. Stable strings — branch on these, not on `message`.
 *
 *   `unconfigured`          503. A key is missing. `missing` names which.
 *   `rate-limited`          429. `retryAfterSeconds` and `resetAt` are set.
 *   `invalid-request`       400. Malformed or out-of-bounds payload; `field`
 *                           names the offending part where one can be named.
 *   `upstream-unavailable`  503. Configured, but Convex could not be reached.
 */
export type AskErrorCode =
  | "unconfigured"
  | "rate-limited"
  | "invalid-request"
  | "upstream-unavailable";

/**
 * The body of every non-200 response from `POST /api/ask`.
 *
 * `configured` is present on **all** of them, always a boolean, because the
 * brief's contract with the UI is a machine-readable `{ configured: false }` for
 * the unconfigured case — and a field that only sometimes exists is a field
 * every caller has to guard. `message` is a complete sentence written for a
 * reader and is safe to render verbatim; it never contains a stack, a provider
 * error, an env value or an IP address.
 */
export type AskErrorBody = {
  error: AskErrorCode;
  /** `false` only for `error: 'unconfigured'`. */
  configured: boolean;
  /** Renderable, human, no secrets. */
  message: string;
  /** Set for `unconfigured`: exactly which variables are unset. */
  missing?: AskRequiredEnvVar[];
  /** Set for `rate-limited`. Mirrors the `Retry-After` header. */
  retryAfterSeconds?: number;
  /** Set for `rate-limited`. RFC 3339 UTC instant the window rolls. */
  resetAt?: string;
  /** Set for `rate-limited`. The ceiling that was applied. */
  limit?: number;
  /** Set for `invalid-request` when one part of the payload is to blame. */
  field?: string;
};

/* ------------------------------------------------------------------ *
 * Bounds — the same numbers the route enforces
 * ------------------------------------------------------------------ */

/**
 * Payload bounds, exported so the composer can stop a reader *before* the round
 * trip rather than after a 400.
 *
 * ⚠️ These are a courtesy, not the enforcement. `@/lib/ask` checks every one of
 * them again on the server, because a Route Handler is a public HTTP endpoint
 * and nothing a browser does can be relied on. Mirror them in the UI; do not
 * treat a UI check as the limit.
 */
export const ASK_LIMITS = {
  /**
   * Longest question accepted, in characters. Mirrors `MAX_QUERY_CHARS` in
   * `packages/convex/convex/ask.ts` so the two refusals agree — the Convex
   * action would reject a longer one anyway, and rejecting here saves the trip.
   */
  maxQuestionChars: 500,
  /**
   * Turns of history the model is shown, newest-last, *including* the question.
   * Older turns are dropped rather than refused: a long conversation is normal,
   * and refusing it would break a session that has simply gone on a while.
   */
  maxHistoryMessages: 12,
  /**
   * Characters of history the model is shown, after the turn cap. Trimmed
   * oldest-first for the same reason.
   */
  maxHistoryChars: 6_000,
  /**
   * Messages accepted in one payload at all. Beyond this the request is
   * **refused**, not trimmed — a body with hundreds of turns is not a reader
   * whose session ran long, and parsing it is work an anonymous caller should
   * not be able to buy.
   */
  maxPayloadMessages: 64,
  /** Text parts accepted on one message. A composer sends exactly one. */
  maxPartsPerMessage: 16,
  /** Request body ceiling in bytes, checked before `JSON.parse`. */
  maxBodyBytes: 64 * 1024,
  /** Citations retrieved and shown to the model. */
  maxCitations: 5,
} as const;

/**
 * Questions per hour, from `RATE_LIMIT_POLICY.ask` in `@home/types`.
 *
 * Restated here as a plain number so the UI can say "ten an hour" without
 * importing the Zod-bearing types package into a client component. The
 * enforcing copy is `RATE_LIMITS` in `packages/convex/convex/lib/rateLimit.ts`;
 * this is the third mirror of it and, like the others, changes last.
 */
export const ASK_QUESTIONS_PER_HOUR = 10;
