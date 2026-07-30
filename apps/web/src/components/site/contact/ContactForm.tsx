"use client";

import {
  useActionState,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";

import {
  CONTACT_IDLE,
  type ContactField,
  type ContactState,
  type ContactSubmitAction,
} from "./transport";

/**
 * The composer — the only interactive thing on the page, and deliberately the
 * most honest.
 *
 * ── Two transports, one form ───────────────────────────────────────────────
 *
 * With Convex configured, `action` is the Server Action in
 * `app/(site)/contact/actions.ts` and submitting *sends*: the message becomes a
 * row in the admin inbox and the status line says so. Without it, `action` is
 * `null` and the form keeps the behaviour it has always had — build a `mailto:`,
 * hand it to the operating system, and claim nothing beyond that. A zero-env
 * checkout renders exactly what it rendered before this file changed.
 *
 * The page decides which, on the server. This component never reads the
 * environment: `NEXT_PUBLIC_CONVEX_URL` is inlined into whatever bundle touches
 * it, and this one is public.
 *
 * ── What this adds to the public bundle ────────────────────────────────────
 *
 * Nothing but this file. `useActionState` is React's own, already in the
 * runtime; the Server Action arrives as a reference, not a body; and there is no
 * Convex client here — which is the whole reason the send goes through a Server
 * Action rather than `convex/react`.
 *
 * ── Controlled fields ──────────────────────────────────────────────────────
 *
 * All three stay controlled, as they were. The mailto path needs `name` for the
 * live subject preview; the Convex path needs somewhere to hold the text that
 * React's post-action form reset cannot reach. They are still `name`d inputs, so
 * the action reads them straight off `FormData`.
 */

const SUBJECT_SUFFIX = "via coreybaines.com";

function buildSubject(name: string): string {
  const who = name.trim();
  return who ? `${who} — ${SUBJECT_SUFFIX}` : `Enquiry ${SUBJECT_SUFFIX}`;
}

function buildBody(name: string, from: string, message: string): string {
  const signature = [name.trim(), from.trim()].filter(Boolean).join("\n");
  const parts = [message.trim()];
  if (signature) parts.push(`—\n${signature}`);
  return parts.filter(Boolean).join("\n\n");
}

export function ContactForm({
  email,
  action,
}: {
  email: string;
  /** The Server Action, or `null` on a deployment with no Convex. */
  action: ContactSubmitAction | null;
}) {
  const [name, setName] = useState("");
  const [from, setFrom] = useState("");
  const [message, setMessage] = useState("");

  /** mailto path only: the last submit opened a mail client. */
  const [handedOff, setHandedOff] = useState(false);

  /**
   * The Server Action, wrapped — and wrapped for exactly one reason.
   *
   * The fields are controlled, so React's automatic post-action form reset does
   * not reach them. Clearing them here, inside the action, is what makes the
   * reset conditional on the send having *worked*: React's own reset fires
   * whether the action succeeded or failed, which on a rejected message would
   * throw away what the reader had just written. On a failure the state is
   * untouched and every word is still on screen next to the reason.
   *
   * `setState` in an action callback is not `setState` in an effect: this runs
   * in response to a submit, after an await, not during a render pass.
   *
   * ⚠️ The price is progressive enhancement. Handed the Server Action *itself*,
   * React renders `<form>` with a real POST endpoint and the form works with
   * JavaScript off; wrapped in a client closure it renders the JS-guarded
   * placeholder instead. That is a considered trade — the reset has to be
   * conditional or a rejected message is destroyed, and the no-JS path on this
   * page is the `mailto:` address in the hero, which is the primary action
   * anyway. Unwind the wrapper before claiming otherwise.
   */
  const [state, formAction, pending] = useActionState<ContactState, FormData>(
    async (previous, form) => {
      if (action === null) return previous;
      const next = await action(previous, form);
      if (next.status === "sent") {
        setName("");
        setFrom("");
        setMessage("");
      }
      return next;
    },
    CONTACT_IDLE,
  );

  const subject = buildSubject(name);

  /** What the status line is describing right now. */
  const shown: ContactState["status"] | "sending" = pending
    ? "sending"
    : state.status;

  /**
   * The input the last refusal named, if any.
   *
   * It stays marked until the next submit rather than clearing on the first
   * keystroke: the message beside it is still the reason, and a marker that
   * vanishes as soon as you touch the field tells you nothing about whether you
   * have fixed it.
   */
  const invalidField: ContactField | null =
    state.status === "error" && !pending ? state.field : null;

  /**
   * One change handler per field. Any edit clears the mailto handoff notice —
   * that line describes a draft now sitting in a mail client, and the moment the
   * form says something different it is no longer true.
   */
  function edit(set: (value: string) => void) {
    return (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setHandedOff(false);
      set(event.target.value);
    };
  }

  function onMailtoSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const href = `mailto:${email}?subject=${encodeURIComponent(
      subject,
    )}&body=${encodeURIComponent(buildBody(name, from, message))}`;
    setHandedOff(true);
    window.location.href = href;
  }

  const direct = action !== null;

  return (
    <form
      className="contact-form"
      {...(direct ? { action: formAction } : { onSubmit: onMailtoSubmit })}
    >
      <div className="contact-pair">
        <div>
          <label className="hor-label contact-lbl" htmlFor="contact-name">
            Your name
          </label>
          <input
            id="contact-name"
            name="name"
            className="contact-in"
            type="text"
            autoComplete="name"
            required
            placeholder="Jane Okafor"
            value={name}
            onChange={edit(setName)}
            aria-invalid={invalidField === "name" || undefined}
          />
        </div>

        <div>
          <label className="hor-label contact-lbl" htmlFor="contact-email">
            Your email
          </label>
          <input
            id="contact-email"
            name="email"
            className="contact-in"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            placeholder="jane@company.com"
            value={from}
            onChange={edit(setFrom)}
            aria-invalid={invalidField === "email" || undefined}
          />
        </div>
      </div>

      <div>
        <label className="hor-label contact-lbl" htmlFor="contact-message">
          Message
        </label>
        <textarea
          id="contact-message"
          name="message"
          className="contact-in"
          rows={6}
          required
          placeholder="The role, the system, or the question."
          value={message}
          onChange={edit(setMessage)}
          aria-invalid={invalidField === "message" || undefined}
        />
      </div>

      {/* The wire: what the submit button will actually hand over, printed on
          the chrome. Two transports, two honest readouts. */}
      <div className="contact-wire" aria-hidden="true">
        <span className="hor-label">{direct ? "POST" : "SUBJ"}</span>
        <span className="hor-vrule hor-vrule-sm" />
        <span className="hor-mono hor-micro contact-wire-val">
          {direct ? `contactMessages.submit → ${email}` : subject}
        </span>
      </div>

      <div className="contact-actions mt-1">
        <button type="submit" className="hor-btn" disabled={pending}>
          {direct ? (pending ? "Sending…" : "Send message") : "Open in mail app"}
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
            <path
              d="M2.6 6.5h7.8M7.2 3.3l3.2 3.2-3.2 3.2"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <span className="hor-label">
          {direct
            ? "convex · stored, then read by one person"
            : "mailto · nothing leaves this page"}
        </span>
      </div>

      {direct ? (
        <p
          className="hor-micro contact-status"
          data-state={shown}
          role="status"
        >
          {shown === "sending" ? (
            <>
              <span className="contact-dot" aria-hidden="true" />
              Sending to the inbox behind {email}…
            </>
          ) : shown === "sent" ? (
            <>
              <span className="contact-dot" aria-hidden="true" />
              Sent. It is in the inbox behind {email}, read by one person — a
              reply comes from that address, not from this form.
            </>
          ) : shown === "error" && state.status === "error" ? (
            <>
              <span className="contact-dot" aria-hidden="true" />
              {state.message}
            </>
          ) : (
            <>
              Submitting stores the message and nothing else — no queue in front
              of it, no autoresponder, no list to be added to.
            </>
          )}
        </p>
      ) : (
        <p
          className="hor-micro contact-status"
          data-state={handedOff ? "handoff" : "idle"}
          role="status"
        >
          {handedOff ? (
            <>
              <span className="contact-dot" aria-hidden="true" />
              Handed a draft addressed to {email} to your mail app. Nothing was
              sent or stored here — if nothing opened, use the address at the top.
            </>
          ) : (
            <>
              Submitting opens your mail app with these fields prefilled. It is not
              a send: direct delivery arrives with the backend phase.
            </>
          )}
        </p>
      )}
    </form>
  );
}
