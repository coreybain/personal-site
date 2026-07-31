/**
 * contact.ts — `contactMessages`, and the public form body that creates one.
 *
 * /contact posts to Convex, which stores the row and sends an email notification.
 * The two schemas are separated because the trust boundary is: `ContactFormSchema`
 * is untrusted input from an anonymous visitor, `ContactMessageSchema` is the row
 * after the server has added the fields the client must not control.
 */

import * as z from "zod";
import {
  EmailSchema,
  IsoDateTimeSchema,
  NonEmptyStringSchema,
} from "./primitives";

/**
 * Triage state.
 *
 * ASSUMPTION — the plan lists `status` without values. These are the states the
 * admin UI needs to be useful: an unread queue, an archive, and somewhere to put
 * the spam that a public form on a site aimed at recruiters will certainly attract.
 */
export const ContactStatusSchema = z.enum([
  "new",
  "read",
  "replied",
  "archived",
  "spam",
]);
export type ContactStatus = z.infer<typeof ContactStatusSchema>;

/**
 * What the public form submits. Untrusted.
 *
 * `strictObject` so an injected `status: 'replied'` or `createdAt` is rejected
 * outright rather than stripped — the endpoint is unauthenticated and rate
 * limited, and it should be boring.
 */
export const ContactFormSchema = z.strictObject({
  name: NonEmptyStringSchema.max(120),
  email: EmailSchema,
  /** Optional — a hiring manager writing from a personal address still counts. */
  company: z.string().max(160).optional(),
  /** Bounded so a single submission cannot be used to store arbitrary payloads. */
  message: NonEmptyStringSchema.max(5000),
});
export type ContactForm = z.infer<typeof ContactFormSchema>;

/** One file stored alongside a contact message. */
export const ContactAttachmentSchema = z.strictObject({
  name: NonEmptyStringSchema.max(180),
  url: z.url(),
  storageKey: NonEmptyStringSchema.max(500),
  size: z
    .number()
    .int()
    .positive()
    .max(4 * 1024 * 1024),
  contentType: NonEmptyStringSchema.max(120),
});
export type ContactAttachment = z.infer<typeof ContactAttachmentSchema>;

/** The stored row: the submitted fields plus server-owned triage state. */
export const ContactMessageSchema = ContactFormSchema.extend({
  attachments: z.array(ContactAttachmentSchema).max(3).optional(),
  status: ContactStatusSchema,
  createdAt: IsoDateTimeSchema,
});
export type ContactMessage = z.infer<typeof ContactMessageSchema>;
