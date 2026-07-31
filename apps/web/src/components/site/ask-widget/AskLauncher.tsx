"use client";

/**
 * AskLauncher.tsx — the tab in the corner, and the dialog shell it opens.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  THIS MODULE IS MOUNTED ON EVERY PUBLIC PAGE. IT MUST STAY TINY.
 *
 *  Ask Corey used to be a route (`/ask`), and a route is allowed to be
 *  expensive because you only pay for it if you go there. A launcher fixed to
 *  the bottom-right of the *whole site* has no such licence: whatever this
 *  file imports, every reader of every page downloads, parses and executes —
 *  including the ones who never click it.
 *
 *  So the import list below is the specification, not an accident:
 *
 *      react           two hooks and a ref
 *      next/dynamic    the trigger that fetches the chat
 *
 *  and nothing else. No `ai`, no `@ai-sdk/react`, no `@/lib/ask-contract`, no
 *  `next/link`. The chat — `AskPanel`, which is ~124 KB gzipped of AI SDK
 *  client runtime plus the thread — is behind `next/dynamic({ ssr: false })`
 *  and is fetched on the **first open**, once per session, never on load.
 *
 *  `tooling/perf/budget.ts` enforces this rather than trusting it: the AI SDK's
 *  markers (`UIMessageStream`, `ai-sdk`) are contraband on every public route
 *  with no exception list any more, and the check reads the `<script src>` tags
 *  of the prerendered HTML — which is exactly the set of bytes a cold visit
 *  executes. A regression that pulls the SDK back into the shared graph fails
 *  the gate by name.
 *
 *  Before adding an import here, ask whether it could live in `AskPanel`
 *  instead. It almost always can.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── Why the dialog *shell* is here and not in the panel ───────────────────
 *
 * The obvious split would be "launcher = button, panel = everything else". It
 * is wrong for one reason: the panel arrives over the network. Between the
 * click and the chunk landing there is a real interval, and during it the
 * reader must already have a labelled dialog with focus inside it and an
 * Escape that closes — otherwise the first thing a keyboard or screen-reader
 * user experiences is a button that appears to do nothing.
 *
 * So this file owns the frame, the accessibility contract and the open state;
 * `AskPanel` owns the conversation. The frame costs a few hundred bytes and
 * works before the chat exists.
 *
 * ── The accessibility contract, in full ───────────────────────────────────
 *
 *   launcher   a real `<button>` with `aria-expanded` and `aria-controls`
 *              naming the panel it toggles
 *   panel      `role="dialog"`, `aria-label`, `tabIndex={-1}` so focus can
 *              land on it before there is anything focusable inside
 *   open       focus moves to the panel; `AskPanel` moves it on to the
 *              composer once it has mounted
 *   close      focus returns to the launcher, always, whichever way it closed
 *   Escape     closes, from anywhere inside
 *   Tab        trapped inside the panel while it is open (hand-rolled below —
 *              no dependency, ~20 lines)
 *
 * ⚠️ It is deliberately **not** `aria-modal`. On desktop the panel is a card
 * beside a page that stays readable and usable; claiming modality there would
 * be a lie to assistive technology. On the mobile sheet the page really is
 * behind a scrim, which is where the scroll lock — and only there — applies.
 */

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

/**
 * The chat, fetched on first open.
 *
 * `ssr: false` because there is nothing to prerender: the panel does not exist
 * until a click, and rendering it on the server would put the SDK back into the
 * route's HTML — which is the whole thing this arrangement exists to prevent.
 * Per Next 16's lazy-loading guide, `ssr: false` is only valid inside a Client
 * Component, which is why the `dynamic()` call lives here and not in the
 * `(site)` layout that mounts this.
 *
 * `loading` renders inside the already-open, already-labelled shell, so the
 * gap between the click and the chunk reads as "coming" rather than as "dead".
 */
const AskPanel = dynamic(
  () => import("./AskPanel").then((module) => module.AskPanel),
  {
    ssr: false,
    loading: () => (
      <p className="ask-w-loading" role="status">
        <span className="hor-live" aria-hidden="true" />
        <span className="hor-label">Loading the chat…</span>
      </p>
    ),
  },
);

/**
 * Everything a `Tab` can land on, in DOM order.
 *
 * A query rather than a maintained list: the panel's focusable set changes with
 * its state (starters appear and disappear, the composer disables itself under
 * a rate limit, citation links arrive with an answer), so anything cached would
 * be wrong within one turn.
 */
const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Below this the panel is a bottom sheet — must match `ask-widget.css`. */
const SHEET_QUERY = "(max-width: 640px)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const PANEL_EXIT_MS = 170;

export type AskLauncherProps = {
  /**
   * Starter questions, built on the server from live content — see the
   * `(site)` layout. Passed through to the panel untouched.
   */
  starters: string[];
  /**
   * Whether the server could see an answering key when the shell rendered.
   *
   * ⚠️ Advisory, never authoritative: `/api/ask` decides, and its
   * `503 { configured: false }` overrides this. See `AskPanel`.
   */
  answeringConfigured: boolean;
};

export function AskLauncher({ starters, answeringConfigured }: AskLauncherProps) {
  const [open, setOpen] = useState(false);
  const [present, setPresent] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const restoreFocusRef = useRef(false);

  const clearCloseTimer = () => {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };

  const openPanel = () => {
    clearCloseTimer();
    setPresent(true);
    setOpen(true);
  };

  const closePanel = () => {
    clearCloseTimer();
    setOpen(false);

    if (window.matchMedia(REDUCED_MOTION_QUERY).matches) {
      setPresent(false);
      return;
    }

    closeTimerRef.current = window.setTimeout(() => {
      setPresent(false);
      closeTimerRef.current = null;
    }, PANEL_EXIT_MS);
  };

  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    },
    [],
  );

  /**
   * Focus in on open, back on close.
   *
   * The exit animation keeps the panel mounted briefly after `open` becomes
   * false. Focus therefore returns only once `present` becomes false and the
   * launcher is visible again on the mobile sheet.
   *
   * `focus()` on the panel rather than on the composer because at this instant
   * the composer may not exist yet: the chat chunk is still in flight. The
   * panel carries `tabIndex={-1}` so it is a legal target, and `AskPanel`
   * hands focus on to the textarea when it mounts.
   */
  useEffect(() => {
    if (open) {
      restoreFocusRef.current = true;
      panelRef.current?.focus();
      return;
    }

    if (!present && restoreFocusRef.current) {
      restoreFocusRef.current = false;
      launcherRef.current?.focus();
    }
  }, [open, present]);

  /**
   * Scroll lock — the mobile sheet only.
   *
   * The sheet covers the viewport behind a scrim, and a page that scrolls under
   * a sheet is the single most common way a bottom sheet feels broken. The
   * desktop card is a different object: it sits beside a page that is still
   * being read, and locking that page would be taking the site hostage for a
   * widget nobody asked to be modal.
   *
   * `matchMedia` is watched rather than sampled so a rotation or a resize
   * across the breakpoint while the panel is open resolves correctly.
   */
  useEffect(() => {
    if (!present) return;

    const query = window.matchMedia(SHEET_QUERY);
    const previous = document.body.style.overflow;

    const apply = () => {
      document.body.style.overflow = query.matches ? "hidden" : previous;
    };

    apply();
    query.addEventListener("change", apply);

    return () => {
      query.removeEventListener("change", apply);
      document.body.style.overflow = previous;
    };
  }, [present]);

  /**
   * Escape closes; Tab wraps.
   *
   * Handled on the panel rather than on `document` so the listener exists
   * exactly as long as the panel does, and so a keystroke aimed at the page
   * behind the desktop card is never intercepted.
   */
  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      closePanel();
      return;
    }

    if (event.key !== "Tab") return;

    const panel = panelRef.current;
    if (panel === null) return;

    const targets = panel.querySelectorAll<HTMLElement>(FOCUSABLE);
    const first = targets[0];
    const last = targets[targets.length - 1];

    // Nothing focusable inside yet (the chunk is still loading): keep the ring
    // on the panel itself rather than letting Tab escape to the page behind.
    if (first === undefined || last === undefined) {
      event.preventDefault();
      panel.focus();
      return;
    }

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      {/* The mobile scrim. Rendered only when open; hidden above 640px by the
          stylesheet, so the desktop card never dims the page. A click on it
          closes, which is the gesture every sheet on a phone already has. */}
      {present ? (
        <div
          className="ask-w-scrim"
          data-state={open ? "open" : "closing"}
          onClick={closePanel}
          aria-hidden="true"
        />
      ) : null}

      <div className="ask-w-dock" data-open={present ? "true" : "false"}>
        {present ? (
          <div
            className="ask-w-panel"
            id="ask-widget-panel"
            ref={panelRef}
            data-state={open ? "open" : "closing"}
            role="dialog"
            aria-label="Ask Corey"
            tabIndex={-1}
            onKeyDown={onPanelKeyDown}
          >
            <header className="ask-w-head">
              <div className="ask-w-head-copy">
                <p className="ask-w-title">
                  <span className="hor-live" aria-hidden="true" />
                  Ask Corey
                </p>
              </div>
              <button
                type="button"
                className="ask-w-close"
                onClick={closePanel}
                aria-label="Close Ask Corey"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 13 13"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M3.2 3.2l6.6 6.6M9.8 3.2l-6.6 6.6"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </header>

            <div className="ask-w-body">
              <AskPanel
                starters={starters}
                answeringConfigured={answeringConfigured}
              />
            </div>
          </div>
        ) : null}

        {/* The glyph is the one the nav pill used to carry for `/ask` — a
            speech bubble with a spark. The key moved; the sign for it did
            not. */}
        <button
          type="button"
          className="ask-w-launcher"
          ref={launcherRef}
          onClick={open ? closePanel : openPanel}
          aria-expanded={open}
          aria-controls="ask-widget-panel"
        >
          <span className="ask-w-launcher-glyph">
            <svg
              width="17"
              height="17"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M16.6 10.4a6.3 6.3 0 01-8.7 5.8L3.6 17.2l1.1-4.1a6.3 6.3 0 015.6-9.1 6.3 6.3 0 016.3 6.4z" />
              <path d="M12.6 7.1l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5z" />
            </svg>
          </span>
          Ask
        </button>
      </div>
    </>
  );
}
