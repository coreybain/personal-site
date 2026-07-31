"use client";

/**
 * AskNotice.tsx — the four states that are not an answer, designed rather than
 * apologised for.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  THE RULE THESE PANELS EXIST TO KEEP
 *
 *  This deployment has no `ANTHROPIC_API_KEY` and no `OPENAI_API_KEY`. Ask
 *  Corey therefore **cannot answer anything today**, and the honest response
 *  to that is a panel that says so in plain words and points at the pages
 *  that do hold the content — not a canned reply, not a demo transcript, not
 *  a "sorry, something went wrong" that implies a bug where there is a
 *  missing key.
 *
 *  Nothing in this folder ever fabricates an answer. If the route cannot
 *  answer, the widget says what is missing and what to do instead.
 *
 *  ⚠️ This matters more now than it did when Ask Corey was a page. A reader
 *  had to navigate to `/ask` to meet the unconfigured state; the launcher
 *  invites them into it from every page on the site. It has to look like a
 *  designed answer, because for most visitors today it *is* the feature.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `"use client"` because of one hook: the rate-limit countdown ticks. The rest
 * would render happily on the server, but they are only ever mounted by
 * `AskPanel`, which is already behind a client-only dynamic import — splitting
 * them out would buy nothing and cost a file.
 */

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import {
  ASK_QUESTIONS_PER_HOUR,
  type AskRetrieval,
} from "@/lib/ask-contract";

/* ------------------------------------------------------------------ *
 * Shell
 * ------------------------------------------------------------------ */

/**
 * The frame every notice shares: a deck panel with a mono label, a heading,
 * and body copy. `tone` drives the accent — `wait` for the states that resolve
 * by themselves, `hold` for the ones a person has to fix.
 *
 * Named `NoticeShell` rather than the `AskPanel` it used to be: `AskPanel` is
 * now the chat itself, one directory over, and two things by that name in one
 * feature is how a grep stops being useful.
 */
function NoticeShell({
  tone,
  label,
  title,
  children,
}: {
  tone: "hold" | "wait" | "fault";
  label: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="hor-panel ask-notice" data-tone={tone} role="status">
      <div className="hor-panel-head">
        <span className="hor-label">{label}</span>
        <span className="ask-notice-dot" aria-hidden="true" />
      </div>
      <div className="hor-panel-body">
        <p className="ask-notice-title">{title}</p>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Unconfigured — the state this deployment is actually in
 * ------------------------------------------------------------------ */

/**
 * What each variable the route can name as missing actually costs.
 *
 * The route sends `missing: AskRequiredEnvVar[]`; this turns each into a
 * sentence. Anything unrecognised is still listed, without a gloss — a new
 * requirement appearing on the server should show up here as a name rather than
 * disappear because this map had not been updated.
 */
const MISSING_EXPLAINS: Record<string, string> = {
  ANTHROPIC_API_KEY:
    "The answer itself. Unset, so no completion is requested and none is invented.",
  NEXT_PUBLIC_CONVEX_URL:
    "The deployment holding the indexed corpus. Unset, so there is nothing to retrieve from.",
};

/**
 * The route answered `503 { configured: false }`, or the layout already knew it
 * would.
 *
 * The copy names the variables because they do different jobs and can be set
 * independently — and because this is a portfolio read mostly by engineers, for
 * whom "which key is missing" is the interesting part. A reader who is not
 * learns the thing that matters more: nothing is broken, and here is where the
 * content actually lives.
 *
 * ⚠️ `OPENAI_API_KEY` is deliberately **not** treated as required. Without it
 * the route still answers — on the lexical path, and it says so. A missing
 * embedding key is a downgrade, not an outage, and the two are not conflated
 * anywhere in this feature.
 */
export function AskUnconfiguredPanel({
  detail,
  missing,
}: {
  detail: string | null;
  /** Variables the route named. Empty when the layout guessed this state itself. */
  missing: string[];
}) {
  return (
    <NoticeShell
      tone="hold"
      label="Not wired up"
      title="Ask Corey has no model key on this deployment."
    >
      <p className="hor-body ask-notice-body">
        {detail ??
          "The retrieval, the citations and the rate limiting are all built and live — but the key that answers is not set on this deployment, so there is nothing to answer with. Rather than improvise a reply, it stops."}
      </p>

      {/* The mechanism, printed on the chrome — the same habit as the contact
          form's `POST contactMessages.submit` readout. */}
      {missing.length > 0 ? (
        <dl className="ask-keys" aria-label="What Ask Corey is waiting for">
          {missing.map((name) => (
            <div className="ask-key" key={name}>
              <dt className="hor-label">{name}</dt>
              {MISSING_EXPLAINS[name] === undefined ? null : (
                <dd className="hor-micro">{MISSING_EXPLAINS[name]}</dd>
              )}
            </div>
          ))}
        </dl>
      ) : null}

      <p className="hor-body ask-notice-body">
        Everything Ask Corey would quote is already on the site, written out in
        full:
      </p>
      <div className="ask-notice-actions">
        <Link className="hor-btn hor-btn-ghost" href="/work">
          Case studies
        </Link>
        <Link className="hor-btn hor-btn-ghost" href="/labs">
          Labs
        </Link>
        <Link className="hor-btn hor-btn-ghost" href="/resume">
          Resume
        </Link>
      </div>
    </NoticeShell>
  );
}

/* ------------------------------------------------------------------ *
 * Rate limited — with a countdown that is real
 * ------------------------------------------------------------------ */

/** `95` → `1:35`. Seconds only below a minute, so short waits read as short. */
function clock(total: number): string {
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Ten questions an hour, per `packages/convex/convex/lib/rateLimit.ts`.
 *
 * The countdown is driven from `Retry-After` when the route sent one and from
 * the body's `retryAfterSeconds` otherwise; when neither arrived there is no
 * clock, because a made-up one would be a promise the widget cannot keep — the
 * window is a fixed window on the server and only the server knows where it
 * ends.
 *
 * `onExpire` lets the panel clear the error and re-enable the composer the
 * moment the wait is over, so the reader never has to guess whether the widget
 * has noticed.
 */
export function AskRateLimitPanel({
  retryAfterSeconds,
  detail,
  onExpire,
}: {
  retryAfterSeconds: number | null;
  detail: string | null;
  onExpire: () => void;
}) {
  /**
   * Seeded from the prop and never synchronised back to it.
   *
   * A fresh refusal must reset this clock, and the way to reset state from a
   * prop is to **remount** — the caller passes a `key` derived from
   * `retryAfterSeconds`. Copying the prop into state from an effect would be
   * the cascading-render pattern React's own lint rules reject, and it would
   * make the clock jump a second late.
   */
  const [remaining, setRemaining] = useState(retryAfterSeconds);

  useEffect(() => {
    if (retryAfterSeconds === null || retryAfterSeconds <= 0) return;

    // Two external timers, both writing from a *callback* rather than from the
    // effect body: the interval moves the display, and one timeout fires the
    // handover at the end. Counting to zero and calling `onExpire` from inside
    // the state updater would make the updater impure.
    const tick = window.setInterval(() => {
      setRemaining((value) => (value === null ? null : Math.max(0, value - 1)));
    }, 1000);
    const done = window.setTimeout(onExpire, retryAfterSeconds * 1000);

    return () => {
      window.clearInterval(tick);
      window.clearTimeout(done);
    };
  }, [retryAfterSeconds, onExpire]);

  const done = remaining !== null && remaining <= 0;

  return (
    <NoticeShell
      tone="wait"
      label="Rate limited"
      title={done ? "The window has reset." : "That is enough questions for now."}
    >
      <p className="hor-body ask-notice-body">
        {detail ??
          `${ASK_QUESTIONS_PER_HOUR} questions an hour, counted per visitor. Each one costs an embedding and a completion, and the limit is what keeps this page from being a bill.`}
      </p>

      {remaining !== null && !done ? (
        <p className="ask-countdown">
          <span className="hor-label">Resets in</span>
          <span className="hor-readout-sm ask-countdown-value">
            {clock(remaining)}
          </span>
        </p>
      ) : null}

      <p className="hor-micro ask-notice-body">
        The inbox is not limited —{" "}
        <Link className="hor-link" href="/contact">
          write instead
        </Link>
        , and a person answers.
      </p>
    </NoticeShell>
  );
}

/* ------------------------------------------------------------------ *
 * Faults
 * ------------------------------------------------------------------ */

/**
 * Something else went wrong: a model provider error, a timeout, a route that
 * threw, or — for `offline` — a request that never reached anything.
 *
 * The copy stays generic on purpose. `detail` is only ever the route's own
 * message (see `describeAskFailure`, which refuses to surface a body it could
 * not parse as JSON), so a stack trace or a framework error page cannot get
 * this far.
 */
export function AskErrorPanel({
  offline,
  detail,
  onRetry,
}: {
  offline: boolean;
  detail: string | null;
  onRetry: () => void;
}) {
  return (
    <NoticeShell
      tone="fault"
      label={offline ? "No response" : "Fault"}
      title={
        offline
          ? "That question never left the page."
          : "The answer did not come back."
      }
    >
      <p className="hor-body ask-notice-body">
        {detail ??
          (offline
            ? "The request could not reach the server. Check the connection and ask again — nothing was sent, and nothing was counted against the hourly limit."
            : "The route accepted the question and then failed while answering it. Asking again is usually enough; if it is not, the fault is on this side.")}
      </p>
      <div className="ask-notice-actions">
        <button type="button" className="hor-btn hor-btn-ghost" onClick={onRetry}>
          Try again
        </button>
        <Link className="hor-btn hor-btn-ghost" href="/contact">
          Ask a person
        </Link>
      </div>
    </NoticeShell>
  );
}

/* ------------------------------------------------------------------ *
 * The retrieval readout — ADR 015's honesty requirement, rendered
 * ------------------------------------------------------------------ */

/**
 * A one-line strip under every answer saying how its context was found.
 *
 * ⚠️ **Do not make this quieter than the answer.** ADR 015 kept Ask Corey on
 * the condition that it becomes real retrieval over embeddings; while the
 * embeddings key is unset it is Convex text search — a lexical matcher, which
 * is the exact thing the ADR replaced. An answer built on that path is still
 * useful and is still cited, but it must not be able to pass for the other one.
 *
 * The vector path prints what it actually used (model, corpus coverage). The
 * lexical path prints why it fell back.
 */
export function AskRetrievalStrip({ retrieval }: { retrieval: AskRetrieval }) {
  const lexical = retrieval.mode === "lexical";
  const corpus = retrieval.corpus;

  /**
   * Why it fell back, in the reader's terms.
   *
   * Every branch is a *different fact about the deployment*, and collapsing
   * them into one "search is degraded" would throw away the only interesting
   * part — `no-key` is a variable nobody set, `empty-vector-index` is a
   * backfill that has not run, `embed-failed` is a provider that just failed.
   */
  const why = (() => {
    switch (retrieval.reason) {
      case "no-key":
        return "no embedding key is set on this deployment, so the vector index is empty";
      case "empty-vector-index":
        return corpus === null
          ? "the corpus has not been embedded yet"
          : `only ${corpus.embedded} of ${corpus.published} published documents are embedded`;
      case "embed-failed":
        return "embedding this question failed, so it could not be matched by meaning";
      case "vector-no-match":
        return "vector search returned nothing close enough, so words were used instead";
      default:
        return "the vector index was unavailable for this question";
    }
  })();

  return (
    <p className="ask-mode" data-degraded={retrieval.degraded ? "true" : undefined}>
      <span className="hor-label ask-mode-key">
        {lexical ? "Keyword search" : "Vector retrieval"}
      </span>
      <span className="hor-vrule hor-vrule-sm" aria-hidden="true" />
      <span className="hor-micro">
        {lexical ? (
          <>
            Matched on words, not meaning — {why}. The sources above are real
            and the answer is drawn from them; the ranking is weaker than it
            will be once embeddings are on.
          </>
        ) : (
          <>
            Ranked by cosine similarity
            {retrieval.embeddingModel === null
              ? ""
              : ` over ${retrieval.embeddingModel}`}
            {corpus === null
              ? ""
              : `, across ${corpus.embedded} of ${corpus.published} published documents`}
            .
          </>
        )}
      </span>
    </p>
  );
}
