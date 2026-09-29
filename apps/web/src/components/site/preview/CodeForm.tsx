"use client";

import { useActionState } from "react";

import { redeemCode, type ActionState } from "@/app/(site)/preview/actions";

/** One field, one button. The code is case-insensitive and ignores spaces and dashes. */
export function CodeForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(redeemCode, null);
  return (
    <form action={action} className="pv-code mt-8">
      <label className="hor-eyebrow" htmlFor="pv-code">Code</label>
      <div className="pv-code-row">
        <input
          id="pv-code"
          name="code"
          className="pv-input pv-code-input hor-mono"
          placeholder="XXXX-XXXX"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={16}
          required
        />
        <button type="submit" className="hor-btn" disabled={pending}>
          {pending ? "Checking…" : "Open preview"}
        </button>
      </div>
      {state && !state.ok ? <p className="pv-error" role="alert">{state.message}</p> : null}
    </form>
  );
}
