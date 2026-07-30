/**
 * contactMessages.ts — the public contact form, and the admin inbox it fills.
 *
 * This file straddles the only trust boundary in the package: `submit` is
 * callable by an anonymous stranger, `list` and `setStatus` are not. That split
 * is why `@home/types` models the two shapes separately (`ContactFormSchema` is
 * untrusted input, `ContactMessageSchema` is the row after the server has added
 * what the client must not control), and the same split is enforced here:
 *
 *   • `submit` accepts exactly `name`, `email`, `company`, `message`. `status`
 *     and `createdAt` are server-owned. Convex rejects an argument the validator
 *     does not name, so an injected `status: 'replied'` fails at the boundary
 *     rather than being quietly stripped — the `strictObject` behaviour
 *     `ContactFormSchema` asks for, for free.
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
 * ⚠️ RATE LIMITING IS NOT IMPLEMENTED HERE, AND THAT IS ON PURPOSE.
 *
 * It belongs to build phase 6 (hardening), alongside the honeypot/turnstile
 * decision, because doing it properly needs a store for counters keyed on
 * something the client cannot forge — and a Convex mutation cannot see the
 * caller's IP (the request never passes through a Next route). The two shapes
 * that can work are a Next.js Route Handler in front of this mutation, which can
 * read the IP header and rate limit there, or a proof-of-work / Turnstile token
 * validated in an action. Both are phase 6 decisions. What this function does
 * today is bound every field so that abuse costs a row, not a database:
 * `assertText` below is the standing mitigation, not a placeholder.
 *
 * Status starts at `'new'` and `createdAt` comes from the server — a submission
 * that could set either could hide itself from the inbox.
 *
 * @returns `null`. Nothing about stored state is echoed back to an anonymous
 *   caller: the mutation resolving IS the receipt, and returning an id or a count
 *   would tell a stranger something about the inbox they have no business
 *   knowing. The form renders its thank-you on resolve.
 */
export const submit = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    company: v.optional(v.string()),
    message: v.string(),
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
