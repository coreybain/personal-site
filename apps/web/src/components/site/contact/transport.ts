/**
 * transport.ts — the vocabulary the composer and its Server Action share.
 *
 * It is a module of its own for one boring reason: a `"use server"` file may
 * only export async functions, so the action in
 * `app/(site)/contact/actions.ts` cannot also export the state type it returns
 * or the initial value the form starts from. Both live here, and both the
 * client component and the action import them.
 *
 * Nothing here reads the environment. `NEXT_PUBLIC_CONVEX_URL` is inlined into
 * whatever bundle touches it, and this module is imported by a `"use client"`
 * component — so the deployment URL would be inlined into the *public* JS. The
 * page decides the transport on the server and passes the answer down.
 */

/**
 * How the composer delivers.
 *
 *   `convex`  the Server Action calls `contactMessages.submit` and the message
 *             is stored. This is the real send.
 *   `mailto`  no Convex on this deployment. The form falls back to the
 *             behaviour it has always had: build a `mailto:` and hand it to the
 *             operating system. Nothing is stored and nothing claims to be.
 */
export type ContactTransport = "convex" | "mailto";

/** The three fields the form owns, and the only ones an error can point at. */
export type ContactField = "name" | "email" | "message";

/**
 * What the action hands back, and the only thing the status line renders.
 *
 * `sent` carries nothing. `contactMessages.submit` returns `null` on purpose —
 * "the mutation resolving IS the receipt", and echoing an id or a count back to
 * an anonymous caller would tell a stranger something about the inbox. This
 * type keeps that property rather than inventing a receipt on the client.
 */
export type ContactState =
  | { status: "idle" }
  | { status: "sent" }
  | {
      status: "error";
      /** The input at fault, so the form can mark it — or `null` for the form. */
      field: ContactField | null;
      /** Already reader-facing. Never a raw exception message. */
      message: string;
    };

/** `useActionState`'s initial value. Frozen shape, shared so the two agree. */
export const CONTACT_IDLE: ContactState = { status: "idle" };

/** The shape of the Server Action, as `useActionState` wants it. */
export type ContactSubmitAction = (
  previous: ContactState,
  form: FormData,
) => Promise<ContactState>;
