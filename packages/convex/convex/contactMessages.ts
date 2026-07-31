/**
 * contactMessages.ts — the public contact form, and the admin inbox it fills.
 *
 * This file straddles the only trust boundary in the package: `submit` is
 * callable by an anonymous stranger, `list` and `setStatus` are not. That split
 * is why `@home/types` models the two shapes separately (`ContactFormSchema` is
 * untrusted input, `ContactMessageSchema` is the row after the server has added
 * what the client must not control), and the same split is enforced here:
 *
 *   • `submit` accepts exactly `name`, `email`, `company`, `message` and (since
 *     build phase 6) `identifierHash`. `status` and `createdAt` are
 *     server-owned. Convex rejects an argument the validator does not name, so
 *     an injected `status: 'replied'` fails at the boundary rather than being
 *     quietly stripped — the `strictObject` behaviour `ContactFormSchema` asks
 *     for, for free.
 *   • `identifierHash` is the rate-limit key: a **salted digest** of the caller,
 *     computed in the Next.js Server Action because that is the only layer that
 *     can see an IP address. It is caller-supplied and therefore forgeable by
 *     design — the salt is what stops it being forgeable *as somebody else* —
 *     and it is stored only in `rateLimits`, never on the message.
 *   • Everything else calls `requireAdmin`.
 *
 * The email notification is a side effect that does not live here. A mutation
 * cannot `fetch`, so sending mail belongs in an action scheduled by `submit`
 * (`ctx.scheduler.runAfter`) once a mail provider is chosen — not in this
 * transaction, where a provider outage would mean the message is lost rather
 * than merely un-notified. The row is the durable record; the email is a
 * convenience.
 */

import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireAdmin } from './lib/auth';
import { RATE_LIMITS, consumeRateLimit } from './lib/rateLimit';
import { assertEmail, assertText, invalid, nowIso } from './lib/validate';
import { contactStatus } from './schema';

/* ------------------------------------------------------------------ *
 * Bounds — mirrored from `ContactFormSchema` in @home/types
 *
 * Convex validators cannot express `.max()`, so these are hand-mirrored
 * and must be changed there first. They are not arbitrary: the form is
 * unauthenticated, and a bounded body is what stops a public endpoint
 * being used as free storage for arbitrary payloads.
 * ------------------------------------------------------------------ */

const MAX_NAME = 120;
const MAX_COMPANY = 160;
const MAX_MESSAGE = 5000;

/* ------------------------------------------------------------------ *
 * Public
 * ------------------------------------------------------------------ */

/**
 * Store a contact form submission. **The one deliberately public mutation in
 * this package.**
 *
 * ── RATE LIMITED as of build phase 6 ──────────────────────────────────────
 *
 * This docblock used to say rate limiting was deferred, because "doing it
 * properly needs a store for counters keyed on something the client cannot
 * forge — and a Convex mutation cannot see the caller's IP". Both halves are
 * still true and both are now answered:
 *
 *   • the store is the `rateLimits` table (`lib/rateLimit.ts`);
 *   • the key is `identifierHash`, a **salted SHA-256 computed in the Next.js
 *     Server Action**, where the IP does exist. Convex still never sees an
 *     address, which is why the argument is a required digest and not an
 *     optional convenience — an optional one would silently degrade to no
 *     limiting the moment a caller omitted it, which is the version of this
 *     feature that is worse than none.
 *
 * The limit is **three an hour** per identifier. A real sender writes once; a
 * second and third are the corrections a real sender sometimes needs. Refusal
 * is a `ConvexError` with `code: 'rate-limited'` and a sentence naming the
 * wait, so the form can print it under the composer rather than showing a
 * generic failure — and the message never implies the submission was malformed.
 *
 * The field bounds below remain the standing mitigation they always were: the
 * limiter caps how often abuse can happen, `assertText` caps how much it costs
 * when it does.
 *
 * ⚠️ The counter is consumed **after** validation and **before** the insert. A
 * malformed submission therefore does not burn a slot (it never reached the
 * inbox), and a well-formed one burns exactly one whether or not the insert
 * then succeeds. Convex mutations are transactional, so a later failure rolls
 * the counter back with everything else.
 *
 * Status starts at `'new'` and `createdAt` comes from the server — a submission
 * that could set either could hide itself from the inbox.
 *
 * @param identifierHash - lowercase hex SHA-256 of `salt + caller identity`,
 *   from `apps/web/src/lib/requestIdentity.ts`. ⛔ Never a raw IP address.
 *
 * @returns `null`. Nothing about stored state is echoed back to an anonymous
 *   caller: the mutation resolving IS the receipt, and returning an id or a count
 *   would tell a stranger something about the inbox they have no business
 *   knowing. The form renders its thank-you on resolve. Note that the rate-limit
 *   decision is deliberately *not* returned either — a caller who is inside the
 *   limit learns nothing about how close they are, because the only use for that
 *   number is pacing an abuser.
 */
export const submit = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    company: v.optional(v.string()),
    message: v.string(),
    identifierHash: v.string(),
  },
  handler: async (ctx, args) => {
    assertText(args.name, 'name', MAX_NAME);
    assertEmail(args.email);
    assertText(args.message, 'message', MAX_MESSAGE);

    // Optional, but a present-and-blank `company` is a form bug rather than a
    // submission worth storing, so it is normalised away instead of stored.
    const company = args.company?.trim();
    if (company !== undefined && company.length > MAX_COMPANY) {
      invalid({
        code: 'out-of-range',
        field: 'company',
        message: `company must be ${MAX_COMPANY} characters or fewer.`,
      });
    }

    const decision = await consumeRateLimit(ctx, 'contact', args.identifierHash);
    if (!decision.allowed) {
      // Minutes, not seconds: "try again in 43 minutes" is a sentence, "in 2,580
      // seconds" is a number the reader has to do arithmetic on. Rounded up so
      // the advice is never early.
      const minutes = Math.max(1, Math.ceil(decision.retryAfterSeconds / 60));
      invalid({
        code: 'rate-limited',
        message:
          `That is ${RATE_LIMITS.contact.limit} messages in an hour, which is the limit. ` +
          `Try again in ${minutes} minute${minutes === 1 ? '' : 's'} — or email direct, which is not limited.`,
      });
    }

    await ctx.db.insert('contactMessages', {
      name: args.name.trim(),
      // Lower-cased so the inbox does not show the same sender twice, and
      // trimmed because a trailing space in a mail client's autofill is common.
      email: args.email.trim().toLowerCase(),
      ...(company !== undefined && company.length > 0 ? { company } : {}),
      message: args.message.trim(),
      status: 'new',
      createdAt: nowIso(),
    });

    return null;
  },
});

/* ------------------------------------------------------------------ *
 * Admin
 * ------------------------------------------------------------------ */

/**
 * The inbox. Admin-only — these are other people's email addresses.
 *
 * @param status - optional triage filter. Omitted, the read is every message
 *   newest-first via `by_createdAt`; passed, it is one state newest-first via
 *   `by_status_createdAt`. Two indexes rather than one because a Convex index is
 *   only usable from its leading field — see the note at those indexes in
 *   schema.ts, which this function is the reason for.
 * @param limit - page size. Defaults to 100, which is more messages than this
 *   site will plausibly receive in a month; the inbox is not designed for
 *   volume, and if it ever needs to be, this becomes `paginate()`.
 *
 * @returns `Array<Doc<'contactMessages'>>` — whole documents, unshaped, per the
 *   package convention (see snapshot.ts).
 */
export const list = query({
  args: {
    status: v.optional(contactStatus),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);

    if (args.status !== undefined) {
      const status = args.status;
      return await ctx.db
        .query('contactMessages')
        .withIndex('by_status_createdAt', (q) => q.eq('status', status))
        .order('desc')
        .take(limit);
    }

    return await ctx.db
      .query('contactMessages')
      .withIndex('by_createdAt')
      .order('desc')
      .take(limit);
  },
});

/**
 * Count messages per triage state, for the admin nav badge.
 *
 * Admin-only, and separate from `list` so the badge does not have to fetch
 * message bodies to render a number. Each state is counted through
 * `by_status_createdAt`, so this is five indexed reads rather than a table scan.
 *
 * @returns `{ new, read, replied, archived, spam }`
 */
export const counts = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const states = ['new', 'read', 'replied', 'archived', 'spam'] as const;
    const tallies = await Promise.all(
      states.map(async (status) =>
        (
          await ctx.db
            .query('contactMessages')
            .withIndex('by_status_createdAt', (q) => q.eq('status', status))
            .collect()
        ).length,
      ),
    );

    return {
      new: tallies[0],
      read: tallies[1],
      replied: tallies[2],
      archived: tallies[3],
      spam: tallies[4],
    };
  },
});

/**
 * Move a message to another triage state.
 *
 * All five states of `ContactStatusSchema` are accepted, including `spam`: the
 * schema is authoritative about what the column holds, and the inbox needs
 * somewhere to put what a public form on a site aimed at recruiters will
 * certainly attract. `archived` is the "dealt with, keep it" state and is
 * deliberately not the same thing.
 *
 * Setting a message to the state it is already in is a no-op that succeeds — the
 * admin UI marks a message `read` on open, and that fires again on every revisit.
 *
 * @returns `{ messageId, status }` — the state as stored, for optimistic-update
 *   reconciliation in the client.
 */
export const setStatus = mutation({
  args: {
    messageId: v.id('contactMessages'),
    status: contactStatus,
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const row = await ctx.db.get(args.messageId);
    if (row === null) {
      invalid({
        code: 'not-found',
        field: 'messageId',
        message: 'That message no longer exists.',
      });
    }

    if (row.status !== args.status) {
      await ctx.db.patch(row._id, { status: args.status });
    }

    return { messageId: row._id, status: args.status };
  },
});

/**
 * Delete a message for good.
 *
 * Present because `spam` accumulates and an inbox with no delete is an inbox
 * that fills with things nobody will ever read. Genuine correspondence should be
 * `archived` instead — this is irreversible, and the admin UI must confirm.
 */
export const remove = mutation({
  args: { messageId: v.id('contactMessages') },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const row = await ctx.db.get(args.messageId);
    if (row === null) {
      // Already gone. Idempotent rather than an error: the likely cause is a
      // double-click or a stale tab, and both mean the caller got what it wanted.
      return { messageId: args.messageId, deleted: false };
    }

    await ctx.db.delete(row._id);
    return { messageId: args.messageId, deleted: true };
  },
});
