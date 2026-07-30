"use client";

import { ConvexError } from "convex/values";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The one thing every admin write needs: a pending flag, an error string, and a
 * moment of "saved" afterwards.
 *
 * ── Why not just `useMutation` ──────────────────────────────────────────────
 *
 * Convex's `useMutation` returns a function that returns a promise. It does not
 * track whether that promise is outstanding, and it does not catch. Every button
 * in this admin therefore needs the same four lines — set pending, await, catch,
 * clear — and every one of them would get the catch subtly wrong, because a
 * failed Convex mutation does not reject with an `Error` whose `.message` is
 * useful. It rejects with a `ConvexError` carrying a structured `.data` payload,
 * and reading that correctly is the entire value of this hook.
 *
 * ── Reading a Convex failure ────────────────────────────────────────────────
 *
 * The backend throws `ConvexError({ code, message, field })` — `'unauthenticated'`
 * for a missing identity, `'precondition-failed'` for the ADR-009 media gate
 * naming each unsanitised asset, `'conflict'` for a duplicate slug. Those
 * messages are written to be shown to the person who caused them, so `message`
 * is surfaced verbatim. `code` and `field` are kept on the returned `failure`
 * object so a caller can react structurally — highlight the offending field,
 * offer a "sign in again" link — without parsing prose.
 *
 * Anything that is not a `ConvexError` is a bug rather than a refusal: a network
 * drop, a validator rejection, a thrown `TypeError` in a handler. Those get a
 * generic message plus the raw text, because a stack-trace fragment in the UI is
 * ugly but a silent failure is worse.
 *
 * ── Lifecycle ──────────────────────────────────────────────────────────────
 *
 * `run()` never throws. It returns the action's value on success and `undefined`
 * on failure, which makes the common caller a one-liner:
 *
 * ```tsx
 * const save = usePendingAction();
 * const update = useMutation(api.projects.update);
 *
 * <SaveButton action={save} onAction={() => update({ projectId, title })} />
 * ```
 *
 * Concurrent calls are dropped rather than queued: the second click of a
 * double-click is discarded, which is the correct behaviour for "save" and for
 * every idempotent mutation in this admin. A guard ref rather than the `pending`
 * state, because state updates are batched and two clicks in one tick would both
 * see `pending === false`.
 */

export type ActionFailure = {
  /** The backend's error code when there is one, e.g. `'precondition-failed'`. */
  code: string | null;
  /** The field the failure is about, when the backend named one. */
  field: string | null;
  /** Shown to the user. Always non-empty. */
  message: string;
};

export type PendingAction = {
  /** `true` between the call and its settlement. Disable the control. */
  pending: boolean;
  /** The last failure, or `null`. Cleared when a new run starts. */
  failure: ActionFailure | null;
  /** `true` for a few seconds after a success, for a "Saved" affordance. */
  succeeded: boolean;
  /** Run an async action, catching everything. Returns `undefined` on failure. */
  run: <T>(action: () => Promise<T>) => Promise<T | undefined>;
  /** Clear the failure and the success flag without running anything. */
  reset: () => void;
};

/** How long `succeeded` stays true. Long enough to read, short enough to trust. */
const SUCCESS_MS = 2200;

/**
 * Turn whatever a rejected mutation threw into something showable.
 *
 * Exported because pages occasionally call a mutation outside a button (an
 * effect, a keyboard shortcut) and should report failures the same way.
 */
export function describeFailure(error: unknown): ActionFailure {
  if (error instanceof ConvexError) {
    const data: unknown = error.data;

    /* The convention across packages/convex: an object with `code` and
       `message`, sometimes `field`. Read defensively — `ConvexError` accepts any
       JSON value, and a handler written later might throw a bare string. */
    if (typeof data === "object" && data !== null) {
      const record = data as Record<string, unknown>;
      const message =
        typeof record.message === "string" && record.message.length > 0
          ? record.message
          : "The server refused this change.";

      return {
        code: typeof record.code === "string" ? record.code : null,
        field: typeof record.field === "string" ? record.field : null,
        message,
      };
    }

    if (typeof data === "string" && data.length > 0) {
      return { code: null, field: null, message: data };
    }

    return {
      code: null,
      field: null,
      message: "The server refused this change.",
    };
  }

  if (error instanceof Error && error.message.length > 0) {
    return {
      code: null,
      field: null,
      /* Not a refusal — something broke. Say so, and include the text, because
         the person reading it is the person who can fix it. */
      message: `Something went wrong: ${error.message}`,
    };
  }

  return {
    code: null,
    field: null,
    message: "Something went wrong, and the error carried no message.",
  };
}

export function usePendingAction(): PendingAction {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [succeeded, setSucceeded] = useState(false);

  /* Synchronous re-entry guard. `pending` is state and therefore one render
     behind; two clicks inside one tick would both pass a state check. */
  const running = useRef(false);

  /* So a success that resolves after the component unmounts does not schedule
     state, and so a fast second save cancels the first one's "Saved". */
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Cancel the pending "Saved" on unmount. Setting state after unmount is a
     silent no-op in React 19, so this is hygiene rather than a bug fix — but a
     timer that outlives its component is the sort of thing that becomes a bug
     the moment someone adds a second effect to this hook. */
  useEffect(
    () => () => {
      if (successTimer.current !== null) {
        clearTimeout(successTimer.current);
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setFailure(null);
    setSucceeded(false);

    if (successTimer.current !== null) {
      clearTimeout(successTimer.current);
      successTimer.current = null;
    }
  }, []);

  const run = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
      if (running.current) {
        return undefined;
      }

      running.current = true;
      setPending(true);
      setFailure(null);
      setSucceeded(false);

      if (successTimer.current !== null) {
        clearTimeout(successTimer.current);
        successTimer.current = null;
      }

      try {
        const result = await action();

        setSucceeded(true);
        successTimer.current = setTimeout(() => {
          setSucceeded(false);
          successTimer.current = null;
        }, SUCCESS_MS);

        return result;
      } catch (error) {
        setFailure(describeFailure(error));
        return undefined;
      } finally {
        running.current = false;
        setPending(false);
      }
    },
    [],
  );

  return { pending, failure, succeeded, run, reset };
}
