/**
 * protocol.ts — the UI's half of the `/api/ask` conversation.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  THE WIRE TYPES LIVE IN `@/lib/ask-contract`, NOT HERE
 *
 *  That module is the single source of truth both halves of Ask Corey import:
 *  the route writes those shapes, this folder reads them, and its own types
 *  are *derived* from `FunctionReturnType<typeof api.ask.retrieve>` rather
 *  than hand-copied — so a field changing in Convex is a type error on both
 *  sides rather than a silent mismatch.
 *
 *  This file adds only what a **renderer** needs on top of that: where to
 *  post, how to pull the parts out of a streamed message, and how to turn a
 *  thrown transport error into the panel a reader should see. Nothing here
 *  re-declares a wire shape. If you find yourself typing `{ title: string;
 *  url: string }`, you are in the wrong file.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── Reading a stream defensively, even with types ─────────────────────────
 *
 * The readers below still validate. A type is a compile-time claim, and these
 * values arrive at runtime from a separate deployment that may be a version
 * behind — mid-deploy, a browser tab left open across a release, a proxy that
 * mangles a chunk. What is dropped is dropped silently and specifically: a
 * citation with no site-relative URL is a chip that goes nowhere, and a chip
 * that goes nowhere is worse than one fewer chip, because the whole claim of
 * this feature (ADR 015) is that its answers are traceable to real pages here.
 */

import type {
  AskCitation,
  AskErrorCode,
  AskRetrieval,
  AskUIMessage,
} from "@/lib/ask-contract";

/**
 * Where the chat posts.
 *
 * A constant rather than a literal at the call site so there is one string to
 * change if the route moves.
 */
export const ASK_ENDPOINT = "/api/ask";

/* ------------------------------------------------------------------ *
 * Runtime guards
 * ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

/**
 * A citation is renderable only if it has a title and a **site-relative** URL.
 *
 * Everything Ask Corey can quote was indexed from a page on this site, so a
 * citation that pointed off-site would mean the corpus had grown a source
 * nobody documented. `//evil.example` is rejected along with `https://…`: a
 * protocol-relative URL is resolved off-origin by every browser, and this value
 * ends up in an `href`.
 */
function renderable(citation: AskCitation): boolean {
  return (
    str(citation.title) !== null &&
    typeof citation.url === "string" &&
    citation.url.startsWith("/") &&
    !citation.url.startsWith("//")
  );
}

/* ------------------------------------------------------------------ *
 * Readers — message in, view model out
 * ------------------------------------------------------------------ */

/**
 * The ranked citation list attached to one assistant message.
 *
 * The route writes it as a single `data-citations` part (stable id
 * `"citations"`) before the first token, so it is on screen while the answer is
 * still arriving. One part carrying the whole list, never one per source —
 * splitting it would lose the ranking, which is the part that matters.
 *
 * De-duplicated by URL, order preserved. `index` is **not** recomputed: it is
 * the number the answer's `[n]` markers refer to, assigned once by the route,
 * and renumbering a filtered list is exactly how a marker comes to point at the
 * wrong source.
 */
export function citationsOf(message: AskUIMessage): AskCitation[] {
  const seen = new Set<string>();
  const out: AskCitation[] = [];

  for (const part of message.parts) {
    if (part.type !== "data-citations" || !Array.isArray(part.data)) continue;

    for (const citation of part.data) {
      if (!isRecord(citation)) continue;
      const candidate = citation as AskCitation;
      if (!renderable(candidate) || seen.has(candidate.url)) continue;
      seen.add(candidate.url);
      out.push(candidate);
    }
  }

  return out;
}

/**
 * How that list was found — `'vector'` or `'lexical'`.
 *
 * ⚠️ A message with citations and no retrieval part must **not** render as
 * though retrieval succeeded on vectors; the caller renders nothing at all in
 * that case rather than assuming. See `AskRetrievalStrip`.
 */
export function retrievalOf(message: AskUIMessage): AskRetrieval | null {
  for (const part of message.parts) {
    if (part.type !== "data-retrieval" || !isRecord(part.data)) continue;
    const mode = str((part.data as AskRetrieval).mode);
    if (mode === "vector" || mode === "lexical") {
      return part.data as AskRetrieval;
    }
  }
  return null;
}

/** The message's text, concatenated in part order. Streaming-safe. */
export function textOf(message: AskUIMessage): string {
  let text = "";
  for (const part of message.parts) {
    if (part.type === "text") text += part.text;
  }
  return text;
}

/**
 * The quota line the route attaches on `start`, if it has arrived yet.
 *
 * Rendered only after an answer, and only when it is getting low: a counter on
 * screen from the first question would make a generous limit feel like a meter
 * running.
 */
export function remainingOf(message: AskUIMessage): number | null {
  const remaining = message.metadata?.rateLimit?.remaining;
  return typeof remaining === "number" && remaining >= 0 ? remaining : null;
}

/* ------------------------------------------------------------------ *
 * Failures
 * ------------------------------------------------------------------ */

/** What the UI should say about a failed turn. */
export type AskFailure =
  | {
      kind: "unconfigured";
      /** The route's own words. Always safe to render — see `AskErrorBody`. */
      detail: string | null;
      /** Which variables the route named as missing, if any. */
      missing: string[];
    }
  | {
      kind: "rate-limited";
      retryAfterSeconds: number | null;
      detail: string | null;
    }
  | { kind: "offline"; detail: string | null }
  | { kind: "error"; detail: string | null };

/** Body JSON, or `null` when the body was not JSON (an HTML error page, say). */
function parseBody(message: string): Record<string, unknown> | null {
  const trimmed = message.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** A non-negative whole number, or `null`. Used for both status and seconds. */
function count(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.ceil(value);
}

/**
 * The thrown error → the panel to render.
 *
 * Pure, total, and the single place the classification is decided — which is
 * what makes it testable without a browser or a network. It reads exactly one
 * string: `error.message`, which for a failed request is the response body as
 * the transport saw it, **enriched with `status` and `retryAfterSeconds` by the
 * `fetch` wrapper in `AskPanel`** (the SDK discards both; see the comment on
 * `askTransport`).
 *
 * ── Branch on `error`, not on the status code ─────────────────────────────
 *
 * `AskErrorBody.error` is the stable machine-readable code and the status is
 * not sufficient on its own: the route returns **503 for two different things**
 * — `unconfigured` (no key; nothing to answer with; retrying is pointless) and
 * `upstream-unavailable` (keys are set, Convex did not answer; retrying in a
 * moment is exactly right). Reading only the status would tell a reader the
 * site was unfinished during a transient outage.
 *
 * The status is still read, as the fallback for a body that arrived without a
 * code — a platform-generated 429 or 503 that never reached the handler.
 */
export function describeAskFailure(error: Error): AskFailure {
  const body = parseBody(error.message);
  const detail = body === null ? null : str(body.message);
  const status = count(body?.status);
  const code = (body === null ? null : str(body.error)) as AskErrorCode | null;

  if (code === "unconfigured" || body?.configured === false) {
    return {
      kind: "unconfigured",
      detail,
      missing: Array.isArray(body?.missing)
        ? body.missing.filter((entry): entry is string => typeof entry === "string")
        : [],
    };
  }

  if (code === "rate-limited" || status === 429) {
    return {
      kind: "rate-limited",
      retryAfterSeconds: count(body?.retryAfterSeconds),
      detail,
    };
  }

  // `invalid-request` (400) and `upstream-unavailable` (503) both land here:
  // both are transient from the reader's side, both carry a sentence written
  // for a reader, and both are worth a retry.
  if (code !== null || status !== null) {
    return { kind: "error", detail };
  }

  // No status at all: the request never produced a response. An aborted fetch,
  // a dropped connection, a dev server that is not running.
  return { kind: "offline", detail: null };
}
