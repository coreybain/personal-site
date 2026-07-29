"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";

/**
 * The composer — the only interactive thing on the page, and deliberately the
 * most honest.
 *
 * There is no backend yet, so there is no send. Submitting builds a `mailto:`
 * from the three fields and hands it to the operating system; the wire strip
 * above the button shows exactly what will be handed over, and the status line
 * afterwards says the draft is in a mail client and nowhere else. Nothing here
 * ever claims a message was delivered or stored.
 *
 * The fields are controlled so the live preview can exist. Native `required`
 * plus `type="email"` do the validation, which means the browser's own error
 * messaging is what the reader sees — no invented error states either.
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

export function ContactForm({ email }: { email: string }) {
  const [name, setName] = useState("");
  const [from, setFrom] = useState("");
  const [message, setMessage] = useState("");
  const [handedOff, setHandedOff] = useState(false);

  const subject = buildSubject(name);

  /**
   * One change handler per field. Any edit clears the handoff notice — that
   * line must only ever describe the most recent thing that actually happened.
   */
  function edit(set: (value: string) => void) {
    return (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setHandedOff(false);
      set(event.target.value);
    };
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const href = `mailto:${email}?subject=${encodeURIComponent(
      subject,
    )}&body=${encodeURIComponent(buildBody(name, from, message))}`;
    setHandedOff(true);
    window.location.href = href;
  }

  return (
    <form className="contact-form" onSubmit={onSubmit}>
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
        />
      </div>

      <div className="contact-wire" aria-hidden="true">
        <span className="hor-label">SUBJ</span>
        <span className="hor-vrule hor-vrule-sm" />
        <span className="hor-mono hor-micro contact-wire-val">{subject}</span>
      </div>

      <div className="contact-actions mt-1">
        <button type="submit" className="hor-btn">
          Open in mail app
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
        <span className="hor-label">mailto · nothing leaves this page</span>
      </div>

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
    </form>
  );
}
