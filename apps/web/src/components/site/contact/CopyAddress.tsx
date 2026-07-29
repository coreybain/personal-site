"use client";

import { useEffect, useRef, useState } from "react";

type CopyState = "idle" | "copied" | "failed";

const LABEL: Record<CopyState, string> = {
  idle: "Copy address",
  copied: "Copied",
  failed: "Copy failed",
};

/**
 * The one non-mailto affordance on the page: put the address on the clipboard.
 *
 * It reports what actually happened. `navigator.clipboard` is missing outside a
 * secure context and can be refused by permission, and in both cases the button
 * says so rather than claiming a copy. The box is a fixed width (`.contact-copy`)
 * so the label swap cannot move the row beside it.
 */
export function CopyAddress({ value }: { value: string }) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function copy() {
    let next: CopyState = "copied";
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      next = "failed";
    }
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2400);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="hor-btn hor-btn-ghost contact-copy"
      aria-label={`Copy ${value} to the clipboard`}
    >
      {state === "copied" ? (
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
          <path
            d="M2.6 6.9l2.6 2.6 5.2-6"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
          <rect
            x="4.4"
            y="4.4"
            width="7.2"
            height="7.2"
            rx="1.6"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <path
            d="M8.9 4.4V3a1.6 1.6 0 00-1.6-1.6H3a1.6 1.6 0 00-1.6 1.6v4.3A1.6 1.6 0 003 8.9h1.4"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      <span aria-live="polite">{LABEL[state]}</span>
    </button>
  );
}
