"use server";

/**
 * actions.ts — the contact form's submission path.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  SERVER ONLY, by directive. `"use server"` marks every export below as a
 *  Server Function: the client bundle receives a reference, never the body,
 *  so `convex/nextjs` and the deployment URL stay on the server.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This replaces a `mailto:` handoff. The old composer opened the reader's mail
 * client and said so; it stored nothing, and on a phone with no mail account
 * configured it did nothing at all. `contactMessages.submit` — the one
 * deliberately public mutation in `packages/convex` — makes the message a row in
 * the admin inbox, which is what the inbox was built for.
 *
 * ── Why a Server Action and not `convex/react` ─────────────────────────────
 *
 * A `useMutation` on a public route would pull the Convex browser client into
 * the public JS bundle — the budget `ConvexClientProvider` exists to protect
 * (it measured the authenticated provider at +76 KB gzip and confined it to
 * `/admin`). A Server Action adds no client runtime at all: React already ships
 * the machinery for `<form action={…}>`, and what crosses the wire is a POST to
 * this route with the form's own `FormData`. Measured on the built output:
 * `/contact`'s client JS grew ~1.1 KB uncompressed, all of it the composer's own
 * markup, and no Convex module or deployment URL reaches the browser.
 *
 * ⚠️ NOT progressively enhanced, and deliberately so — see the note on the
 * wrapper in `ContactForm`. The no-JavaScript path on this page is the `mailto:`
 * address in the hero, set in display type as the page's primary action.
 *
 * ── `fetchMutation`, not `ConvexHttpClient` ────────────────────────────────
 *
 * `@/lib/data` builds its own `ConvexHttpClient` because it needs one client
 * per request for six reads. One fire-and-forget mutation does not: Convex's own
 * Next.js helper does exactly this — construct, call, discard — and reads the
 * deployment URL from `NEXT_PUBLIC_CONVEX_URL` itself. Using the helper here
 * keeps the "which URL?" question answered in one place upstream of us.
 *
 * ── Authentication ─────────────────────────────────────────────────────────
 *
 * Deliberately none. The Next.js forms guide is emphatic that every Server
 * Action must verify authorisation — the point being that a Server Action is a
 * public HTTP endpoint whether or not the page rendering it was private. It is
 * verified here by inspection: `contactMessages.submit` is the *only* function
 * in the package that does not call `requireAdmin`, it writes exactly four
 * caller-supplied strings into one table, and `status` / `createdAt` are
 * server-owned so a submission cannot hide itself from the inbox. An anonymous
 * caller reaching this action can do precisely what an anonymous caller reaching
 * the form can do.
 *
 * ⚠️ NO RATE LIMITING, and it is not this file's to add. `contactMessages.ts`
 * sets out why: doing it properly needs the caller's IP, which a Convex mutation
 * cannot see, so the shape is either a Route Handler in front of the mutation or
 * a Turnstile token validated in an action. Both are phase 6. A Server Action
 * *can* read headers, so this file is where that will eventually live — the
 * bounds below are the standing mitigation until it does.
 */

import { fetchMutation } from "convex/nextjs";
import { ConvexError } from "convex/values";

import { api } from "@home/convex/api";

import type { ContactField, ContactState } from "@/components/site/contact/transport";

/* ------------------------------------------------------------------ *
 * Bounds — mirrored from `contactMessages.ts`, which mirrors
 * `ContactFormSchema` in @home/types.
 *
 * Checked here as well as there so a too-long message comes back
 * attached to the field that is too long, rather than as a thrown
 * `ConvexError` after a round trip. The mutation remains authoritative:
 * these are a courtesy to the reader, never the enforcement.
 * ------------------------------------------------------------------ */

const MAX_NAME = 120;
const MAX_EMAIL = 254;
const MAX_MESSAGE = 5000;

/** The pattern `assertEmail` in `packages/convex/convex/lib/validate.ts` uses. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

/**
 * One field, trimmed. A missing or non-string entry reads as empty.
 *
 * `form` is typed `FormData` and React always passes one — but a Server Action
 * is a public HTTP endpoint, and a hand-crafted POST that encodes the second
 * argument as anything else lands here with `form.get` undefined. Guarded, so
 * that request gets the same "the message is empty" refusal as a blank form
 * rather than an uncaught `TypeError` and an opaque error digest. Observed, not
 * imagined: a mis-encoded probe against the built route produced exactly that.
 */
function field(form: FormData, key: string): string {
  const value = typeof form?.get === "function" ? form.get(key) : null;
  return typeof value === "string" ? value.trim() : "";
}

/** A refusal the status line can render, optionally pinned to one input. */
function refuse(at: ContactField | null, message: string): ContactState {
  return { status: "error", field: at, message };
}

/**
 * Narrow whatever `ConvexError.data.field` holds to an input this form owns.
 *
 * The mutation can blame `company`, which this form does not render — that
 * becomes a form-level message rather than a highlight on nothing.
 */
function asContactField(value: unknown): ContactField | null {
  return value === "name" || value === "email" || value === "message"
    ? value
    : null;
}

/**
 * Store one contact message.
 *
 * Shaped for `useActionState`, so the first argument is the previous state —
 * unused, because a submission's outcome never depends on the last one.
 *
 * Never throws. An uncaught error in a Server Action reaches the client as an
 * opaque digest in production, which on this form would mean a reader watching a
 * spinner stop with nothing to read. Every path returns a `ContactState` the
 * status line can render, and every failure names the email address as the way
 * through.
 */
export async function submitContactMessage(
  _previous: ContactState,
  form: FormData,
): Promise<ContactState> {
  const name = field(form, "name");
  const email = field(form, "email");
  const message = field(form, "message");

  if (name.length === 0) {
    return refuse("name", "A name, so a reply knows who it is addressed to.");
  }
  if (name.length > MAX_NAME) {
    return refuse("name", `Names are capped at ${MAX_NAME} characters.`);
  }
  if (email.length > MAX_EMAIL || !EMAIL_PATTERN.test(email)) {
    return refuse("email", "That does not look like an email address.");
  }
  if (message.length === 0) {
    return refuse("message", "The message is empty.");
  }
  if (message.length > MAX_MESSAGE) {
    return refuse(
      "message",
      `Messages are capped at ${MAX_MESSAGE.toLocaleString("en-US")} characters — this one is ${message.length.toLocaleString("en-US")}.`,
    );
  }

  /* Zero-env. The page renders the mailto composer in this case and never wires
     this action up, so reaching here means someone POSTed to it directly. Say
     so plainly rather than letting `fetchMutation` throw on a missing URL. */
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return refuse(
      null,
      "This deployment has no message store. Use the address above — it reaches the same inbox.",
    );
  }

  try {
    // `company` is omitted, not sent empty: the mutation normalises a blank
    // company away, and this form does not ask for one.
    await fetchMutation(api.contactMessages.submit, { name, email, message });
    return { status: "sent" };
  } catch (error) {
    // Loud on the server. The reader gets a sentence; the operator gets the
    // stack, because a silently failing contact form is the worst version of
    // this page.
    console.error("[contact] contactMessages.submit failed.", error);

    /* The convention across packages/convex: `ConvexError` carrying
       `{ code, field, message }`. Read defensively — `ConvexError` accepts any
       JSON value — and prefer the server's own wording, which is written for a
       person (`"email does not look like an email address."`). */
    if (error instanceof ConvexError) {
      const data: unknown = error.data;
      if (typeof data === "object" && data !== null) {
        const record = data as Record<string, unknown>;
        if (typeof record.message === "string" && record.message.length > 0) {
          return refuse(asContactField(record.field), record.message);
        }
      }
    }

    return refuse(
      null,
      "The message did not get through. Nothing was stored — the address above always works.",
    );
  }
}
