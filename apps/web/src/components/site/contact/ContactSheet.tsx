"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { ContactForm } from "./ContactForm";
import type { ContactSubmitAction } from "./transport";

type ContactSheetContextValue = {
  openSheet: (trigger: HTMLElement) => void;
};

const ContactSheetContext = createContext<ContactSheetContextValue | null>(
  null,
);

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

const MIN_SHEET_WIDTH = 380;
const MAX_SHEET_WIDTH = 820;
const DEFAULT_SHEET_WIDTH = 460;

function maximumSheetWidth(): number {
  if (typeof window === "undefined") return MAX_SHEET_WIDTH;
  return Math.max(
    MIN_SHEET_WIDTH,
    Math.min(MAX_SHEET_WIDTH, window.innerWidth - 48),
  );
}

function clampSheetWidth(width: number): number {
  return Math.min(maximumSheetWidth(), Math.max(MIN_SHEET_WIDTH, width));
}

export function ContactSheetProvider({
  children,
  email,
  action,
}: {
  children: ReactNode;
  email: string;
  action: ContactSubmitAction | null;
}) {
  const [open, setOpen] = useState(false);
  const [sheetWidth, setSheetWidth] = useState(DEFAULT_SHEET_WIDTH);
  const [resizing, setResizing] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  const openSheet = useCallback((trigger: HTMLElement) => {
    returnFocusRef.current = trigger;
    setOpen(true);
  }, []);

  const closeSheet = useCallback(() => {
    setOpen(false);
    window.setTimeout(() => returnFocusRef.current?.focus(), 240);
  }, []);

  useEffect(() => {
    if (!open) return;

    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusTimer = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>("input")?.focus();
    }, 40);

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSheet();
        return;
      }
      if (event.key !== "Tab" || panelRef.current === null) return;

      const items = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((element) => element.offsetParent !== null);
      if (items.length === 0) return;

      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = priorOverflow;
    };
  }, [closeSheet, open]);

  useEffect(
    () => () => {
      resizeCleanupRef.current?.();
    },
    [],
  );

  function onLayerMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) closeSheet();
  }

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    resizeCleanupRef.current?.();

    const startX = event.clientX;
    const startWidth = sheetWidth;
    const pointerId = event.pointerId;
    setResizing(true);

    function move(pointerEvent: PointerEvent) {
      if (pointerEvent.pointerId !== pointerId) return;
      setSheetWidth(
        clampSheetWidth(startWidth + startX - pointerEvent.clientX),
      );
    }

    function finish(pointerEvent: PointerEvent) {
      if (pointerEvent.pointerId !== pointerId) return;
      cleanup();
    }

    function cleanup() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      resizeCleanupRef.current = null;
      setResizing(false);
    }

    resizeCleanupRef.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }

  function resizeWithKeyboard(event: ReactKeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 64 : 24;
    let next: number | null = null;

    if (event.key === "ArrowLeft") next = sheetWidth + step;
    if (event.key === "ArrowRight") next = sheetWidth - step;
    if (event.key === "Home") next = MIN_SHEET_WIDTH;
    if (event.key === "End") next = maximumSheetWidth();
    if (next === null) return;

    event.preventDefault();
    setSheetWidth(clampSheetWidth(next));
  }

  return (
    <ContactSheetContext.Provider value={{ openSheet }}>
      <div className="contact-sheet-page" inert={open ? true : undefined}>
        {children}
      </div>
      <div
        className="contact-sheet-layer"
        data-open={open}
        aria-hidden={!open}
        onMouseDown={onLayerMouseDown}
      >
        <div
          className="contact-sheet-scrim"
          aria-hidden="true"
          onMouseDown={closeSheet}
        />
        <aside
          ref={panelRef}
          className="contact-sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="contact-sheet-title"
          style={
            { "--contact-sheet-width": `${sheetWidth}px` } as CSSProperties
          }
        >
          <div
            className="contact-sheet-resize"
            role="separator"
            tabIndex={0}
            aria-label="Resize contact form"
            aria-orientation="vertical"
            aria-valuemin={MIN_SHEET_WIDTH}
            aria-valuemax={MAX_SHEET_WIDTH}
            aria-valuenow={Math.round(sheetWidth)}
            aria-valuetext={`${Math.round(sheetWidth)} pixels wide`}
            data-dragging={resizing}
            onPointerDown={startResize}
            onKeyDown={resizeWithKeyboard}
          />
          <header className="contact-sheet-head">
            <div>
              <span className="hor-eyebrow">Direct line</span>
              <h2 id="contact-sheet-title">Start a conversation.</h2>
              <p>
                Send a note to {email}. Add a brief, job specification, or other
                context if it helps.
              </p>
            </div>
            <button
              type="button"
              className="contact-sheet-close"
              aria-label="Close contact form"
              onClick={closeSheet}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 20 20"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M5 5l10 10M15 5L5 15"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </header>

          <div className="contact-sheet-body">
            <ContactForm
              email={email}
              action={action}
              idPrefix="contact-sheet"
              context="sheet"
            />
          </div>
        </aside>
      </div>
    </ContactSheetContext.Provider>
  );
}

export function ContactSheetTrigger({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const context = useContext(ContactSheetContext);
  if (context === null) {
    throw new Error("ContactSheetTrigger must be inside ContactSheetProvider.");
  }

  return (
    <button
      type="button"
      className={className}
      onClick={(event) => context.openSheet(event.currentTarget)}
    >
      {children}
    </button>
  );
}
