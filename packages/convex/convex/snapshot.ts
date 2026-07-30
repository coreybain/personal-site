/**
 * snapshot.ts — reads of the Snapshot row (ADR 004).
 *
 * This is the pattern-setting function for the package, so it is worth stating
 * what the pattern is:
 *
 *   • Public reads are `query`, take explicit `args`, and return documents as
 *     they are stored. No shaping, no formatting — the web app and the iOS app
 *     want different presentations of the same row and neither should be
 *     privileged here.
 *   • One export per operation, named for the operation (`get`), so the call
 *     site reads `api.snapshot.get`.
 *   • Everything a page needs comes from as few documents as possible. This one
 *     is the extreme case: the homepage's entire data requirement is the single
 *     row returned below, which is the whole point of denormalising it.
 *
 * The row is written by the hourly cron, never on request. See ADR 005.
 */

import { query } from './_generated/server';

/**
 * The current Snapshot, or `null` if the cron has never run.
 *
 * `null` is a real state, not an edge case: a fresh deployment has no snapshot
 * until the first cron tick, and preview deployments may never get one. Callers
 * render the static fallback rather than throwing.
 *
 * There should only ever be one row (`snapshot` is a singleton — see schema.ts),
 * but the read is ordered newest-first rather than using `.unique()`: if a
 * rebuild ever leaves two rows behind, serving the fresher one is a much better
 * failure mode than a homepage that throws.
 */
export const get = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query('snapshot').order('desc').first();
  },
});
