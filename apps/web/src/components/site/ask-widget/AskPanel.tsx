"use client";

/**
 * AskPanel.tsx — the chat itself: the thread, the composer, and the states that
 * are not an answer.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  THE ONE CHUNK ON THIS SITE THAT CARRIES THE AI SDK
 *
 *  Every public route ships zero client JavaScript of its own beyond the shell,
 *  and `tooling/perf/budget.ts` exists to keep it that way. This module is the
 *  documented exception (ADR 015) — a chat cannot be a form post — and the
 *  exception is now contained by *time* rather than by route: nothing here is
 *  in any page's first-load JS, because `AskLauncher` imports this module
 *  through `next/dynamic({ ssr: false })` and only on the reader's first click.
 *
 *  That is the whole point of the widget, and it is a stronger containment than
 *  `/ask` ever had. When Ask Corey was a page, visiting it cost 290 KB gzipped
 *  whether or not you typed anything; 122.6 KB of that was one chunk of AI SDK
 *  client runtime. Now the same bytes are fetched by the people who ask, at the
 *  moment they ask, and by nobody else.
 *
 *  Consequences worth keeping in mind before adding an import: this file and
 *  its graph are the entire weight of the exception. `useChat` +
 *  `DefaultChatTransport` are the whole SDK surface used; no provider SDK, no
 *  Convex client, no markdown library (see `markdown.tsx` for why).
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── What talks to what ────────────────────────────────────────────────────
 *
 *   this component  ──POST /api/ask──▶  route handler  ──▶  Convex `ask.retrieve`
 *                                                      └──▶  the answering model
 *
 * The panel never touches Convex and never sees a key. It posts UI messages and
 * renders what streams back; the route owns retrieval, metering and the model.
 * That split is why `NEXT_PUBLIC_CONVEX_URL` does not appear in this bundle and
 * why the rate-limit identifier — a salted digest of the caller's address — is
 * computed on the server, where the address exists.
 *
 * ── AI SDK v7, verified against `node_modules/ai/docs` ────────────────────
 *
 * `useChat` from `@ai-sdk/react`, `DefaultChatTransport` from `ai` 7.x. The v7
 * shapes this file depends on, all confirmed in the installed package rather
 * than recalled: messages carry `parts` (not `content`); `sendMessage` takes
 * `{ text }`; `status` is `submitted | streaming | ready | error`;
 * `clearError()` exists and returns the chat to `ready`; `regenerate()` with no
 * argument truncates to the last user message and re-requests it.
 *
 * ── What this file does *not* own ─────────────────────────────────────────
 *
 * The frame, the dialog role, focus management, Escape and the scroll lock all
 * live in `AskLauncher`, because they have to work in the interval before this
 * chunk arrives. This file's only claim on focus is one line: when it mounts,
 * the composer takes it.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

import {
  ASK_LIMITS,
  ASK_QUESTIONS_PER_HOUR,
  type AskCitation,
  type AskUIMessage,
} from "@/lib/ask-contract";

import {
  ASK_ENDPOINT,
  citationsOf,
  describeAskFailure,
  remainingOf,
  retrievalOf,
  textOf,
} from "./protocol";
import { MarkdownLite } from "./markdown";
import {
  AskErrorPanel,
  AskRateLimitPanel,
  AskRetrievalStrip,
  AskUnconfiguredPanel,
} from "./AskNotice";

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

/**
 * `Retry-After: 900` → `900`.
 *
 * The header may also carry an HTTP-date, which is parsed to a delta. A value
 * that is neither is dropped rather than guessed — the countdown says nothing
 * before it says something wrong.
 */
function parseRetryAfter(header: string | null): number | null {
  if (header === null) return null;

  const asSeconds = Number(header.trim());
  if (Number.isFinite(asSeconds) && asSeconds >= 0) return Math.ceil(asSeconds);

  const asDate = Date.parse(header);
  if (Number.isNaN(asDate)) return null;
  return Math.max(0, Math.ceil((asDate - Date.now()) / 1000));
}

/**
 * The transport, built once for the module.
 *
 * Module scope rather than `useMemo` because it holds no component state: it is
 * a URL and a `fetch`. A hook would only invite a dependency array to get it
 * wrong, and the React Compiler (enabled in this repo, and enforced by the lint
 * config) is entitled to drop a manual memo it cannot prove.
 *
 * ⚠️ "Once for the module" now means *once per session*: this module is loaded
 * on the reader's first open and stays loaded, so the transport survives the
 * panel being closed and reopened. Nothing about it is per-conversation, so
 * that is exactly the right lifetime — but it is worth knowing that closing the
 * widget does not reset anything here. The thread itself is unmounted with the
 * panel, which is what "close" is expected to mean.
 *
 * ── The `fetch` wrapper, and why it rewrites the body ─────────────────────
 *
 * On a non-2xx, `HttpChatTransport` throws `new Error(await response.text())`:
 * the **body only**, with the status code and every header discarded. That
 * loses the two things the UI most needs — the status (503 vs 429 vs 500) and
 * `Retry-After`, which is what makes the rate-limit countdown a real clock
 * rather than an invented one.
 *
 * The obvious fix — stash them in a ref and read it while rendering the error —
 * is a render-time read of mutable state, which React's own lint rules reject
 * and the compiler is free to break. So instead the failure is folded into the
 * body *before* the SDK sees it: the response is replaced with one whose JSON
 * carries the original fields plus `status` and `retryAfterSeconds`. The error
 * that surfaces is then self-describing, `describeAskFailure` stays a pure
 * function of one string, and no mutable state is read during render.
 *
 * A body that is not JSON (a framework HTML error page, a proxy's 502) is
 * **dropped**, not forwarded: only the status survives. Raw upstream markup has
 * no business reaching a reader, and `describeAskFailure` would refuse it
 * anyway.
 */
const askTransport = new DefaultChatTransport<AskUIMessage>({
  api: ASK_ENDPOINT,
  fetch: async (input, init) => {
    const response = await fetch(input, init);
    if (response.ok) return response;

    const raw = await response.text();
    let carried: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null) {
        carried = parsed as Record<string, unknown>;
      }
    } catch {
      // Not JSON. Nothing from the body is carried forward.
    }

    const retryAfter = parseRetryAfter(response.headers.get("retry-after"));

    return new Response(
      JSON.stringify({
        ...carried,
        status: response.status,
        // The header wins over a body field: it is the transport-level answer
        // and the one a proxy or the platform may have set.
        retryAfterSeconds: retryAfter ?? carried.retryAfterSeconds ?? null,
      }),
      {
        status: response.status,
        statusText: response.statusText,
        headers: { "content-type": "application/json" },
      },
    );
  },
});

/** The label under a citation chip. */
const SOURCE_LABEL: Record<string, string> = {
  project: "Case study",
  lab: "Lab",
  post: "Writing",
  resume: "Resume",
};

/* ------------------------------------------------------------------ *
 * Citations
 * ------------------------------------------------------------------ */

/**
 * The numbered chips under an answer.
 *
 * They are the feature. An answer with no chips is a claim; an answer with
 * chips is a claim plus the page it came from, which is the whole difference
 * ADR 015 asked for. So they render as real `<Link>`s to real site-relative
 * routes — prefetched, navigable, and verifiable in one click.
 *
 * ⚠️ Following one navigates the page *behind* the widget, and the widget's
 * open state does not survive that: the launcher is remounted by the new
 * route's render of the `(site)` layout with `open` back to `false`. That is
 * the intended behaviour — a citation is an invitation to go and read the page
 * — but it means a chip click ends the conversation, which is why nothing in a
 * thread is persisted or promised to be.
 *
 * `id` on each chip is what an inline `[1]` in the answer links to — and the
 * number rendered is the citation's own `index`, assigned once by the route,
 * **never its position in this array**. That distinction is the whole reason
 * the field exists: dropping one unrenderable source would otherwise renumber
 * every chip below it and quietly point half the answer's markers at the wrong
 * page.
 */
function AskCitations({
  citations,
  messageId,
}: {
  citations: AskCitation[];
  messageId: string;
}) {
  return (
    <div className="ask-cites">
      <span className="hor-label ask-cites-key">
        Sources · {citations.length}
      </span>
      <ol className="ask-cite-list">
        {citations.map((citation) => (
          <li key={citation.url} id={`${messageId}-source-${citation.index}`}>
            <Link className="ask-cite" href={citation.url}>
              <span className="ask-cite-num hor-mono" aria-hidden="true">
                {citation.index}
              </span>
              <span className="ask-cite-copy">
                <span className="ask-cite-title">{citation.title}</span>
                <span className="hor-micro ask-cite-meta">
                  {citation.sourceType === null
                    ? citation.url
                    : `${SOURCE_LABEL[citation.sourceType] ?? citation.sourceType} · ${citation.url}`}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * One assistant turn
 * ------------------------------------------------------------------ */

/**
 * An answer: prose, then its sources, then how they were found.
 *
 * The parse is memoised on the text so a finished answer stops re-parsing when
 * a later one streams — with two or three turns on screen that is the
 * difference between parsing one message per chunk and parsing all of them.
 */
function AskAnswer({
  message,
  streaming,
}: {
  message: AskUIMessage;
  streaming: boolean;
}) {
  const text = textOf(message);
  const citations = citationsOf(message);
  const retrieval = retrievalOf(message);
  const remaining = remainingOf(message);

  /**
   * Which `[n]` markers this answer can actually back up.
   *
   * A marker naming a source that is not on screen renders as plain text —
   * see `markdown.tsx`. A link to a chip that does not exist would be a
   * citation that cannot be checked, which is the one thing this widget is not
   * allowed to ship.
   */
  const numbered = citations.map((citation) => citation.index).join(",");

  const body = useMemo(() => {
    const known = new Set(
      numbered.length === 0 ? [] : numbered.split(",").map(Number),
    );
    return (
      <MarkdownLite
        text={text}
        idPrefix={message.id}
        citationHref={(index) =>
          known.has(index) ? `#${message.id}-source-${index}` : null
        }
      />
    );
  }, [text, message.id, numbered]);

  return (
    <article className="ask-turn ask-turn-answer" aria-label="Answer">
      <div className="ask-prose">
        {body}
        {streaming ? <span className="ask-caret" aria-hidden="true" /> : null}
      </div>

      {citations.length > 0 ? (
        <AskCitations citations={citations} messageId={message.id} />
      ) : null}

      {retrieval !== null ? <AskRetrievalStrip retrieval={retrieval} /> : null}

      {/* The quota, and only once it is nearly spent. A counter on screen from
          the first question turns a generous allowance into a meter running. */}
      {remaining !== null && remaining <= 3 && !streaming ? (
        <p className="hor-micro ask-quota">
          {remaining === 0
            ? "That was the last question in this hour's allowance."
            : `${remaining} question${remaining === 1 ? "" : "s"} left this hour.`}
        </p>
      ) : null}
    </article>
  );
}

/* ------------------------------------------------------------------ *
 * The panel body
 * ------------------------------------------------------------------ */

export type AskPanelProps = {
  /** Starter questions, built on the server from live content. */
  starters: string[];
  /**
   * Whether the server could see an answering key when the shell was rendered.
   *
   * ⚠️ **Advisory, not authoritative.** The route decides — it may read a key
   * the layout cannot see, and the shell may have been prerendered before the
   * key was set. So a `false` here shows the "not wired up" panel up front
   * (better than inviting a question that cannot be answered) but never
   * disables the composer: asking anyway is how a reader — or a deploy that has
   * just gained a key — finds out the truth from the only component that knows
   * it. A `503 { configured: false }` replaces this panel with the same one.
   */
  answeringConfigured: boolean;
};

export function AskPanel({ starters, answeringConfigured }: AskPanelProps) {
  const {
    messages,
    sendMessage,
    status,
    error,
    stop,
    regenerate,
    clearError,
    setMessages,
  } = useChat<AskUIMessage>({ transport: askTransport });

  const [input, setInput] = useState("");

  /**
   * Ids rather than literals, because this component is no longer guaranteed to
   * be a singleton on the page: it is a dynamic import, and a second mount
   * during a fast open/close/open would otherwise duplicate `id="ask-input"`
   * and break the `<label>`'s association.
   */
  const inputId = useId();
  const noteId = useId();

  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const busy = status === "submitted" || status === "streaming";
  // Pure: everything the classification needs is in the error's message, put
  // there by the transport's `fetch` wrapper above.
  const failure = error === undefined ? null : describeAskFailure(error);

  /**
   * The composer is closed only while a countdown is running.
   *
   * A refusal with no `Retry-After` leaves it open on purpose: the alternative
   * is a reader locked out with no clock and no way to discover the window has
   * reopened, and one extra 429 costs nothing.
   */
  const heldUntilReset =
    failure?.kind === "rate-limited" &&
    failure.retryAfterSeconds !== null &&
    failure.retryAfterSeconds > 0;

  const canSend = !busy && !heldUntilReset;

  const tooLong = input.trim().length > ASK_LIMITS.maxQuestionChars;

  const empty = messages.length === 0;

  /**
   * Waiting for the first token: the request is out and the assistant message
   * either does not exist yet or is still empty.
   */
  const last = messages[messages.length - 1];
  const lastText = last === undefined ? "" : textOf(last);
  const awaitingFirstToken =
    busy && (last === undefined || last.role === "user" || lastText.length === 0);

  /**
   * The composer takes focus when the chunk lands.
   *
   * `AskLauncher` has already moved focus to the panel so that Escape and the
   * trap work during the fetch; this hands it on to the thing a reader actually
   * wants, exactly once, on mount. Not on every render — that would fight
   * anyone who clicked a citation chip.
   */
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  /**
   * Follow the stream.
   *
   * The thread is the scroller in a panel of fixed height (it was the document
   * on the old `/ask` page), so nothing keeps the newest text in view unless
   * this does. Keyed on the last message's id and its length so it fires on
   * every chunk, and on `auto` rather than `smooth` because a smooth scroll
   * retriggered thirty times a second never arrives.
   *
   * ⚠️ It scrolls unconditionally rather than only-if-near-the-bottom. In a
   * 380px card there is no meaningful "reading back through history" state
   * while an answer is arriving, and the simpler rule has no way to strand a
   * reader at the top of a growing answer.
   *
   * ⚠️ …but **not** while the thread is empty. The empty state is a notice and
   * a list of starters that read top-down, and they are taller than the box on
   * this deployment (the unconfigured panel is 290px in a 396px scroller).
   * Scrolling to the bottom on mount opened the widget onto the last two
   * suggestions with the explanation of why it cannot answer pushed off the
   * top — which is the one thing the unconfigured state must not do.
   */
  useEffect(() => {
    const thread = threadRef.current;
    if (thread === null || messages.length === 0) return;
    thread.scrollTop = thread.scrollHeight;
  }, [messages.length, lastText.length, failure?.kind]);

  const ask = useCallback(
    (question: string) => {
      const trimmed = question.trim();
      // The bound is the route's, mirrored so a reader is stopped before the
      // round trip rather than after a 400. ⚠️ The server checks it again —
      // `ASK_LIMITS` is a courtesy here and the enforcement there.
      if (trimmed.length === 0 || trimmed.length > ASK_LIMITS.maxQuestionChars) {
        return;
      }
      // A previous failure is cleared by the act of asking again; leaving the
      // panel up next to a fresh question would describe the wrong turn.
      clearError();
      void sendMessage({ text: trimmed });
      setInput("");
    },
    [clearError, sendMessage],
  );

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSend) return;
    ask(input);
  };

  /**
   * Retry the last question.
   *
   * `regenerate()` truncates the thread back to the last user message and
   * re-requests it, so the question is not asked twice and no duplicate turn
   * appears. It throws when there is nothing to regenerate, hence the guard —
   * a "Try again" that can only appear after a failed request should still not
   * be able to blow up on an empty thread.
   */
  const retry = useCallback(() => {
    clearError();
    if (messages.length === 0) return;
    void regenerate();
  }, [clearError, messages.length, regenerate]);

  /**
   * Start over: drop the thread and the error together.
   *
   * Nothing is persisted — no history, no local storage, no server-side thread
   * — so "clear" is exactly what it says, and closing the widget does the same.
   */
  const clear = () => {
    clearError();
    setMessages([]);
    setInput("");
  };

  return (
    <>
      {/* ── The thread ───────────────────────────────────────────────── */}
      <div className="ask-w-thread" ref={threadRef}>
        {messages.map((message) =>
          message.role === "user" ? (
            <div className="ask-turn ask-turn-question" key={message.id}>
              <span className="hor-label ask-turn-key">You asked</span>
              <p className="ask-question">{textOf(message)}</p>
            </div>
          ) : (
            <AskAnswer
              key={message.id}
              message={message}
              streaming={busy && message.id === last?.id}
            />
          ),
        )}

        {awaitingFirstToken ? (
          <p className="ask-working" role="status">
            <span className="hor-live" aria-hidden="true" />
            <span className="hor-label">Searching the published corpus…</span>
          </p>
        ) : null}

        {/* Honest states. The route's answer wins over the server hint: once a
            failure exists it is the thing rendered, whatever the layout guessed
            at render time. */}
        {failure?.kind === "unconfigured" ? (
          <AskUnconfiguredPanel
            detail={failure.detail}
            missing={failure.missing}
          />
        ) : failure?.kind === "rate-limited" ? (
          <AskRateLimitPanel
            // Remount on a new refusal — that is how the countdown resets. See
            // the panel: it seeds its clock from this prop exactly once.
            key={`limit-${failure.retryAfterSeconds ?? "none"}`}
            retryAfterSeconds={failure.retryAfterSeconds}
            detail={failure.detail}
            onExpire={clearError}
          />
        ) : failure !== null ? (
          <AskErrorPanel
            offline={failure.kind === "offline"}
            detail={failure.detail}
            onRetry={retry}
          />
        ) : empty && !answeringConfigured ? (
          // The layout's own guess, made on the server. It carries no `missing`
          // list because only the route knows which variables it needs.
          <AskUnconfiguredPanel detail={null} missing={[]} />
        ) : null}

        {/* ── Starters ──────────────────────────────────────────────────
            Only while the thread is empty: once there is a conversation, the
            composer is the obvious next move and a wall of suggestions is
            noise. Every one of them is built on the server from content that
            is actually published — see the `(site)` layout. */}
        {empty ? (
          <div className="ask-starters">
            <span className="hor-label">Try</span>
            <ul className="ask-starter-list">
              {starters.map((starter) => (
                <li key={starter}>
                  <button
                    type="button"
                    className="ask-starter"
                    onClick={() => ask(starter)}
                    disabled={!canSend}
                  >
                    {starter}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {/* ── The composer ─────────────────────────────────────────────── */}
      <form className="ask-composer" onSubmit={onSubmit}>
        <label className="hor-label ask-composer-label" htmlFor={inputId}>
          Your question
        </label>

        <textarea
          id={inputId}
          ref={inputRef}
          className="ask-input"
          rows={2}
          value={input}
          placeholder="Ask about a project, a decision, or how something was built."
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter breaks the line — the convention every
            // chat uses. The form's submit button still works for anyone who
            // never presses Enter, and for anyone on a soft keyboard.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (canSend) ask(input);
            }
          }}
          disabled={heldUntilReset}
          maxLength={ASK_LIMITS.maxQuestionChars}
          aria-describedby={noteId}
        />

        <div className="ask-composer-row">
          {busy ? (
            <button
              type="button"
              className="hor-btn hor-btn-ghost"
              onClick={stop}
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              className="hor-btn"
              disabled={!canSend || input.trim().length === 0 || tooLong}
            >
              Ask
              <svg
                width="13"
                height="13"
                viewBox="0 0 13 13"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M2.6 6.5h7.8M7.2 3.3l3.2 3.2-3.2 3.2"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}

          <span className="hor-micro ask-composer-note" id={noteId}>
            Enter sends · {ASK_QUESTIONS_PER_HOUR} questions an hour
          </span>

          {!empty ? (
            <button type="button" className="ask-clear hor-link" onClick={clear}>
              Clear
            </button>
          ) : null}
        </div>
      </form>
    </>
  );
}
