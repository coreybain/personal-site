"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { usePendingAction, type PendingAction } from "./usePendingAction";

/**
 * Buttons that call the backend.
 *
 * All three share one rule: **a button that starts a network call must show that
 * it did, must refuse to start a second one, and must say what happened.** A
 * mutation in this admin is a write to the live site, so "did that work?" is
 * never a question the UI should leave open.
 *
 * The pending state comes from `usePendingAction`, and every button here accepts
 * an optional `action` so several controls can share one — a form footer with
 * Save and Publish should disable both while either is running, because the
 * second write would race the first. Pass no `action` and the button owns a
 * private one, which is right for a lone control in a table row.
 */

/* ------------------------------------------------------------------ *
 * ActionButton — the general case
 * ------------------------------------------------------------------ */

export type ActionButtonProps = {
  /** Resting label. */
  children: ReactNode;
  /** The call. Anything async; failures are caught and shown. */
  onAction: () => Promise<unknown>;
  /**
   * Share a pending state with sibling buttons. Omit for a private one.
   * When shared, *every* participating button disables while any is running.
   */
  action?: PendingAction;
  /** Label while the call is outstanding. Defaults to the resting label. */
  pendingLabel?: ReactNode;
  variant?: "default" | "primary" | "ghost" | "danger";
  size?: "md" | "sm";
  disabled?: boolean;
  /** Hide the inline failure text — for a caller showing it somewhere better. */
  quiet?: boolean;
  title?: string;
};

export function ActionButton({
  children,
  onAction,
  action,
  pendingLabel,
  variant = "default",
  size = "md",
  disabled,
  quiet,
  title,
}: ActionButtonProps) {
  const own = usePendingAction();
  const state = action ?? own;

  return (
    <span className="adm-btn-row">
      <button
        type="button"
        className="adm-btn"
        data-variant={variant === "default" ? undefined : variant}
        data-size={size === "md" ? undefined : size}
        disabled={disabled || state.pending}
        onClick={() => {
          void state.run(onAction);
        }}
        title={title}
        /* Announced to assistive tech while the call is in flight; the visible
           spinner is aria-hidden, so this is the only signal a screen reader
           gets. */
        aria-busy={state.pending || undefined}
      >
        {state.pending ? (
          <span className="adm-spinner" aria-hidden="true" />
        ) : null}
        {state.pending ? (pendingLabel ?? children) : children}
      </button>

      {!quiet && state.failure ? (
        <span className="adm-btn-note" data-tone="error" role="alert">
          {state.failure.message}
        </span>
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * SaveButton
 * ------------------------------------------------------------------ */

export type SaveButtonProps = Omit<
  ActionButtonProps,
  "children" | "variant" | "pendingLabel"
> & {
  /** Defaults to "Save". Use "Create" on a new-document form. */
  label?: string;
  /**
   * `false` when nothing has changed. Renders the button disabled rather than
   * hidden, so the footer does not reflow the moment you touch a field.
   */
  dirty?: boolean;
};

/**
 * The primary write on a form.
 *
 * Shows "Saved" for a couple of seconds after success. That confirmation is not
 * decoration: without it, a form whose fields are unchanged after a save is
 * indistinguishable from a form that did not save, and the natural response is to
 * click again.
 */
export function SaveButton({
  label = "Save",
  dirty,
  action,
  onAction,
  disabled,
  quiet,
  size,
  title,
}: SaveButtonProps) {
  const own = usePendingAction();
  const state = action ?? own;

  return (
    <span className="adm-btn-row">
      <button
        type="button"
        className="adm-btn"
        data-variant="primary"
        data-size={size === "sm" ? "sm" : undefined}
        disabled={disabled || state.pending || dirty === false}
        onClick={() => {
          void state.run(onAction);
        }}
        title={
          title ?? (dirty === false ? "No unsaved changes." : undefined)
        }
        aria-busy={state.pending || undefined}
      >
        {state.pending ? (
          <span className="adm-spinner" aria-hidden="true" />
        ) : null}
        {state.pending ? "Saving…" : label}
      </button>

      {state.succeeded ? (
        <span className="adm-btn-note" data-tone="ok" role="status">
          Saved
        </span>
      ) : null}

      {!quiet && state.failure ? (
        <span className="adm-btn-note" data-tone="error" role="alert">
          {state.failure.message}
        </span>
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * DeleteButton
 * ------------------------------------------------------------------ */

export type DeleteButtonProps = {
  onAction: () => Promise<unknown>;
  action?: PendingAction;
  /** Resting label. Defaults to "Delete". */
  label?: string;
  /**
   * What is being deleted, for the armed label: `Delete "QuoteCloud"?`. Keep it
   * short — it replaces the label in a table row.
   */
  name?: string;
  size?: "md" | "sm";
  disabled?: boolean;
};

/** How long the armed state lasts before disarming itself. */
const ARM_MS = 4000;

/**
 * Delete, behind one extra click.
 *
 * ── Why not a modal ────────────────────────────────────────────────────────
 *
 * Every `remove` mutation in `packages/convex` is irreversible and there is no
 * undo, so a confirmation is not optional. A modal dialog is the usual answer and
 * is the wrong one here: it needs focus trapping, an escape handler, a scroll
 * lock and a portal to be accessible, and the thing it protects is a single click
 * in a table row. Arming the button in place costs one component, keeps focus
 * where it was, and is dismissed by doing nothing.
 *
 * The armed state disarms itself after four seconds. A button that stays armed is
 * a button that is armed the next time you look at the page, which is exactly the
 * accident being prevented.
 *
 * Note what this does *not* protect: the CDN copy of any uploaded image. Convex
 * mutations cannot make network calls, so deleting a document leaves its
 * UploadThing files behind (see `app/api/uploadthing/core.ts`). That is a
 * documented orphan, not a leak — the row is gone and the URL was only ever
 * reachable through it.
 */
export function DeleteButton({
  onAction,
  action,
  label = "Delete",
  name,
  size = "sm",
  disabled,
}: DeleteButtonProps) {
  const own = usePendingAction();
  const state = action ?? own;
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!armed) {
      return;
    }

    timer.current = setTimeout(() => setArmed(false), ARM_MS);

    return () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [armed]);

  return (
    <span className="adm-btn-row">
      <button
        type="button"
        className="adm-btn"
        data-variant="danger"
        data-size={size === "sm" ? "sm" : undefined}
        data-armed={armed ? "true" : undefined}
        disabled={disabled || state.pending}
        onClick={() => {
          if (!armed) {
            setArmed(true);
            return;
          }

          setArmed(false);
          void state.run(onAction);
        }}
        aria-busy={state.pending || undefined}
      >
        {state.pending ? (
          <span className="adm-spinner" aria-hidden="true" />
        ) : null}
        {state.pending
          ? "Deleting…"
          : armed
            ? name
              ? `Delete “${name}” — sure?`
              : "Click again to confirm"
            : label}
      </button>

      {state.failure ? (
        <span className="adm-btn-note" data-tone="error" role="alert">
          {state.failure.message}
        </span>
      ) : null}
    </span>
  );
}
