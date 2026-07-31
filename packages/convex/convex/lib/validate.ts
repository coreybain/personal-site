/**
 * lib/validate.ts — the checks Convex validators cannot express.
 *
 * ⚠️ READ THIS BEFORE ADDING A MUTATION.
 *
 * `@home/types` is the authoritative contract (see schema.ts's header) and it
 * enforces formats: kebab-case slugs, `owner/name` repo ids, a 64-char hex
 * digest, a rating of 1–5, an email address, a bounded message body. Convex
 * validators enforce *structure* only — `v.string()` accepts `''`, a 40 KB
 * essay, and `"Not A Slug"` alike. So a mutation that only declares `args` has
 * validated less than the contract promises.
 *
 * The gap cannot be closed by importing Zod. `packages/convex` deliberately
 * depends on nothing but `convex` itself: these modules are bundled and shipped
 * to Convex's own V8 runtime, and `@home/types` (plus Zod) in that bundle would
 * be a second copy of the contract crossing a deploy boundary where it cannot be
 * kept in step with the one apps/web and the iOS client compile against.
 *
 * ── The convention, therefore ──────────────────────────────────────────────
 *
 *   1. Argument *shape* is declared with Convex `args` validators, reusing the
 *      exported validators from schema.ts so the mutation and the table cannot
 *      drift apart. Convex rejects an argument the validator does not name, so
 *      an `args` object IS the `strictObject` half of the Zod schema.
 *   2. Argument *format* is asserted with the helpers below, which are
 *      hand-mirrored from `@home/types` and name the Zod schema they mirror.
 *      Change the Zod schema first, then mirror it here.
 *   3. Cross-row invariants (slug uniqueness, the ADR 009 publish gate) are
 *      asserted in the mutation, because only the database can answer them.
 *
 * Everything throws `ConvexError` with a `code`, so the admin UI can attach a
 * message to the right form field instead of showing "Server Error" — Convex
 * redacts plain `Error` messages in production, `ConvexError.data` survives.
 *
 * ── Timestamps ────────────────────────────────────────────────────────────
 *
 * Every instant written by any mutation comes from `nowIso()` below. Do not
 * write `Date.now()` into a document: the schema stores RFC 3339 strings, and
 * the reason is set out at length in schema.ts's header.
 */

import type { GenericDatabaseReader } from 'convex/server';
import { ConvexError } from 'convex/values';
import type { DataModel, Id } from '../_generated/dataModel';

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

/**
 * Shape of every validation failure thrown from this file.
 *
 * `field` is the document field at fault, so an admin form can highlight the
 * input rather than the form. It is absent for whole-row invariants.
 */
export type ValidationErrorData = {
  code:
    | 'invalid-format'
    | 'out-of-range'
    | 'duplicate-slug'
    | 'not-found'
    | 'precondition-failed'
    /**
     * The caller is over a rate limit (build phase 6 — `lib/rateLimit.ts`).
     *
     * The odd one out in this union: every other code describes something wrong
     * with the request, and this one describes something true about the caller.
     * It is here anyway because the transport is the same — a `ConvexError` the
     * contact form already knows how to render — and adding a second error
     * channel for one case would mean the form handling two shapes.
     *
     * ⚠️ `field` is absent on this code. There is no input to highlight, and
     * pinning the message to `message` would tell a reader their message was
     * malformed when it was fine.
     */
    | 'rate-limited';
  field?: string;
  message: string;
};

/** Throw a `ConvexError` carrying the payload above. Never returns. */
export function invalid(data: ValidationErrorData): never {
  throw new ConvexError<ValidationErrorData>(data);
}

/* ------------------------------------------------------------------ *
 * Time
 * ------------------------------------------------------------------ */

/**
 * Now, as the RFC 3339 UTC string every timestamp field in the schema holds.
 *
 * Three properties worth knowing, because indexes and `@home/types` both depend
 * on them:
 *
 *   • **Fixed width.** `toISOString()` always produces exactly
 *     `YYYY-MM-DDTHH:MM:SS.sssZ` (24 characters) for any year in 1000–9999, so
 *     these strings sort lexicographically in chronological order — which is
 *     what makes `by_status_createdAt`, `by_occurredAt` and friends real
 *     chronological indexes rather than approximations.
 *   • **Milliseconds included.** `IsoDateTimeSchema` (`z.iso.datetime()`)
 *     accepts sub-second precision, and `ISO8601DateFormatter` on iOS is
 *     configured for it. Do not trim the `.sss` to look tidier: that would
 *     break the fixed-width property above for no gain.
 *   • **Constant within one function execution.** Convex freezes `Date.now()`
 *     for the lifetime of a query or mutation to keep it deterministic, so two
 *     calls to `nowIso()` in the same mutation return the same instant. That is
 *     a feature: a row's `createdAt` and the `updatedAt` it triggers elsewhere
 *     agree exactly.
 */
export function nowIso(): string {
  return new Date(Date.now()).toISOString();
}

/* ------------------------------------------------------------------ *
 * Formats — hand-mirrored from @home/types/primitives
 * ------------------------------------------------------------------ */

/** `SlugSchema`: lowercase kebab-case, 1–96 chars, no leading/trailing/double dashes. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Assert a slug matches `SlugSchema`.
 *
 * Slugs are the join key across the whole system — `knowledgeDocs.sourceSlug`,
 * `siteSettings.featured.*`, the AI-usage collector's repo→project mapping and
 * every public URL all point at one — so a malformed slug is not a cosmetic
 * problem. They are also never reused: changing one orphans inbound links and
 * every knowledge doc that cites it.
 */
export function assertSlug(value: string, field = 'slug'): void {
  if (value.length < 1 || value.length > 96 || !SLUG_PATTERN.test(value)) {
    invalid({
      code: 'invalid-format',
      field,
      message: `Expected a lowercase kebab-case slug of 1–96 characters, got ${JSON.stringify(value)}.`,
    });
  }
}

/**
 * Assert a string is non-empty after trimming, and within `max` characters.
 *
 * Mirrors `NonEmptyStringSchema` and the `.max()` bounds the Zod schemas attach
 * to it. The trim check matters more than it looks: a required field holding
 * `'   '` passes `v.string()`, renders as blank on the public site, and is
 * indistinguishable from a bug in the page.
 */
export function assertText(value: string, field: string, max: number): void {
  if (value.trim().length === 0) {
    invalid({ code: 'invalid-format', field, message: `${field} cannot be empty.` });
  }
  if (value.length > max) {
    invalid({
      code: 'out-of-range',
      field,
      message: `${field} must be ${max} characters or fewer (got ${value.length}).`,
    });
  }
}

/**
 * Assert something looks like an email address. Mirrors `EmailSchema` (`z.email()`).
 *
 * Deliberately permissive — one `@`, a dot-bearing domain, no whitespace. This
 * is a typo catcher, not an RFC 5322 parser: the only way to know an address is
 * real is to send to it, and rejecting an unusual-but-valid address on a contact
 * form costs more than accepting an undeliverable one.
 */
export function assertEmail(value: string, field = 'email'): void {
  if (value.length > 254 || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(value)) {
    invalid({
      code: 'invalid-format',
      field,
      message: `${field} does not look like an email address.`,
    });
  }
}

/**
 * Assert a string is an absolute `http(s)` URL. Mirrors `UrlSchema` (`z.url()`).
 *
 * Every URL in this model is either a CDN asset (UploadThing, ADR 010) or an
 * outbound link rendered as an anchor, so the scheme allowlist is doing real
 * work: it is what stops a `javascript:` payload reaching an `href` on the
 * public site. `URL` is available in the Convex runtime.
 *
 * On-site paths (`knowledgeDocs.url`, e.g. `/work/quotecloud`) are deliberately
 * NOT URLs and must not be checked with this — see that field's note in
 * schema.ts for why a path survives the ADR 017 domain cutover and a URL does not.
 */
export function assertUrl(value: string, field = 'url'): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    invalid({
      code: 'invalid-format',
      field,
      message: `${field} must be an absolute URL (got ${JSON.stringify(value)}).`,
    });
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    invalid({
      code: 'invalid-format',
      field,
      message: `${field} must be an http(s) URL, not ${parsed.protocol}.`,
    });
  }
}

/** Assert a number is within an inclusive range. For ratings, hues, percentages. */
export function assertRange(
  value: number,
  field: string,
  min: number,
  max: number,
): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    invalid({
      code: 'out-of-range',
      field,
      message: `${field} must be between ${min} and ${max} (got ${value}).`,
    });
  }
}

/* ------------------------------------------------------------------ *
 * Cross-row invariants
 * ------------------------------------------------------------------ */

/**
 * The tables whose `slug` is unique and indexed by `by_slug`.
 *
 * Enumerated rather than inferred from the data model so that adding a slugged
 * table is a compile error here — the uniqueness rule is a property of the
 * table's index, and a table without `by_slug` cannot be checked cheaply.
 */
export type SluggedTable = 'projects' | 'labs' | 'posts';

/**
 * Assert no other row in `table` already holds `slug`.
 *
 * Convex has no unique constraint, so this is the only thing standing between
 * `/work/[slug]` and two rows answering to the same URL. It is an indexed
 * lookup (`by_slug`), not a scan, and it must be called on every insert and on
 * every patch that touches `slug`.
 *
 * @param ignoreId - the row being edited. Without it, renaming a project to its
 *   own existing slug would report a conflict with itself.
 *
 * Note the residual race: two concurrent inserts could both pass this check.
 * Convex's transactional serialisation (OCC — one of the two mutations is
 * retried against fresh data, where this check then fails) closes it, which is
 * the reason this is safe as a read-then-write in the first place.
 */
export async function assertSlugUnique(
  db: GenericDatabaseReader<DataModel>,
  table: SluggedTable,
  slug: string,
  ignoreId?: Id<SluggedTable>,
): Promise<void> {
  assertSlug(slug);

  const existing = await db
    .query(table)
    .withIndex('by_slug', (q) => q.eq('slug', slug))
    .first();

  if (existing !== null && existing._id !== ignoreId) {
    invalid({
      code: 'duplicate-slug',
      field: 'slug',
      message: `Another ${table} row already uses the slug "${slug}".`,
    });
  }
}
