/**
 * repoMap.ts — the only code that reads or writes `gitRepoMap`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  EVERY FUNCTION IN THIS FILE IS INTERNAL. THAT IS THE WHOLE DESIGN.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `gitRepoMap` is the one table in the model that stores **private repository
 * names**. schema.ts states the rule in a box: no `query()` may read it, not a
 * filtered one, not a redacted one, not a count. This file is where that rule
 * either holds or does not, so it is worth being explicit about what makes it
 * hold rather than trusting the box:
 *
 *   • Nothing below is `query()` / `mutation()` / `action()`. They are all
 *     `internalQuery` / `internalMutation`, which Convex does not expose on the
 *     public function API at all — a browser holding the deployment URL cannot
 *     name them, and `tooling/privacy-check` cannot reach them even deliberately
 *     (see the header of `tooling/privacy-check/surface.ts`, which explains why
 *     it refuses to authenticate with an admin key).
 *   • **No return value contains a `repoFullName`.** Not on success, not in an
 *     error, not in a summary. `seed` reports counts; `entries` returns rows and
 *     is called by exactly one caller — `gitStats.rebuild`, an action, whose own
 *     return type is the ADR 008 audit surface documented in that file. The
 *     `bunx convex run repoMap:seed …` a human types prints the counts, so the
 *     seed script can say "12 rows, 4 projects" in a terminal without echoing
 *     the input back.
 *   • **No logging.** `console.log` output lands in the Convex dashboard, which
 *     is a durable, off-machine store. A repository name in a log line is a
 *     repository name that left this Mac, which is exactly what ADR 008
 *     forbids, so there is not one `console.*` call in this file.
 *
 * ── Where the rows come from ───────────────────────────────────────────────
 *
 * `tooling/git-repo-map`, which reads a **gitignored, machine-local** JSON file
 * and calls `seed` below through `bunx convex run` (the CLI authenticates with
 * the deployment's admin key, which is how an internal mutation is reachable
 * from a terminal and from nowhere else). That is the same pattern
 * `tooling/collector` uses for `collector.config.json`, for the same reason and
 * with the same committed `.example` alongside it.
 *
 *     bun run tooling/git-repo-map/seed.ts            # dry run, prints counts
 *     bun run tooling/git-repo-map/seed.ts --push     # writes
 */

import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';

/* ------------------------------------------------------------------ *
 * Mirrored validator
 * ------------------------------------------------------------------ */

/**
 * Mirrors the (unexported) `gitRepoMap` field block in schema.ts, which in turn
 * mirrors `GitRepoMapEntrySchema` in `@home/types`.
 *
 * Re-declared rather than imported for the reason the whole package re-declares
 * things — `packages/convex` is bundled into Convex's own runtime and cannot
 * depend on `@home/types` (see the header of `lib/validate.ts`) — and for the
 * reason `snapshotBuild.ts` re-declares `contributionDay`: schema.ts exports
 * none of its inline validators.
 */
const gitRepoMapEntry = v.object({
  repoFullName: v.string(),
  displayName: v.string(),
  kind: v.union(v.literal('project'), v.literal('lab'), v.literal('ignore')),
});

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

/**
 * One mapping row as the git action consumes it.
 *
 * Declared rather than inferred because `gitStats.ts` reaches this query through
 * the generated `internal` object, which is typed from every module including
 * this one — an inferred return type there is a circular reference and
 * TypeScript refuses it with TS7022. Same note as `snapshotBuild.ts`.
 */
export type GitRepoMapEntry = {
  /** `owner/name`, lowercased. MAY BE A PRIVATE REPOSITORY NAME. */
  repoFullName: string;
  /** The public label. Safe to render; that is the entire point of the row. */
  displayName: string;
  kind: 'project' | 'lab' | 'ignore';
};

/** What `seed` reports. Counts only — see the file header. */
export type GitRepoMapSeedSummary = {
  /** Rows in the payload after the caller's own de-duplication. */
  submitted: number;
  inserted: number;
  /** Rows that existed and whose `displayName`/`kind` changed. */
  updated: number;
  /** Rows that existed and already matched exactly. No write was spent. */
  unchanged: number;
  /** Rows deleted because `prune` was set and they were absent from the payload. */
  pruned: number;
  /** Rows in the table afterwards, by kind. */
  totals: { project: number; lab: number; ignore: number };
};

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/**
 * Every mapping row, for the git action's attribution pass.
 *
 * An action has no `ctx.db`, so this is how `gitStats.rebuild` learns the
 * mapping — the same shape of dependency as `snapshotBuild.curatedLabRepos`, and
 * deliberately the same shape of answer: the *whole* small table, read once per
 * hourly tick, rather than a lookup per repository. A hand-maintained mapping is
 * tens of rows, and one read that the action can index in memory beats N
 * round-trips through the query boundary.
 *
 * ⚠️ THE RETURN VALUE CARRIES PRIVATE REPOSITORY NAMES. It is safe only because
 * its single caller consumes `repoFullName` as a lookup key and emits
 * `displayName`; `gitStats.ts` documents that boundary and asserts it before
 * writing (see `assertNoRepoIdentifiers` there). Do not add a second caller
 * without reading both files.
 */
export const entries = internalQuery({
  args: {},
  handler: async (ctx): Promise<GitRepoMapEntry[]> => {
    const rows = await ctx.db.query('gitRepoMap').withIndex('by_repoFullName').collect();

    return rows.map((row) => ({
      repoFullName: row.repoFullName,
      displayName: row.displayName,
      kind: row.kind,
    }));
  },
});

/**
 * Counts by kind, for an operator who wants to know the table is populated
 * without being shown what is in it.
 *
 * This is the *only* thing a human should ever need to read out of this table
 * interactively, and it exists so that "is the seed applied?" has an answer that
 * is not `bunx convex run repoMap:entries`, which would print private names into
 * a terminal, a scrollback buffer, and quite possibly a screenshot.
 */
export const counts = internalQuery({
  args: {},
  handler: async (ctx): Promise<GitRepoMapSeedSummary['totals'] & { total: number }> => {
    const rows = await ctx.db.query('gitRepoMap').withIndex('by_repoFullName').collect();
    return {
      total: rows.length,
      project: rows.filter((row) => row.kind === 'project').length,
      lab: rows.filter((row) => row.kind === 'lab').length,
      ignore: rows.filter((row) => row.kind === 'ignore').length,
    };
  },
});

/* ------------------------------------------------------------------ *
 * Write
 * ------------------------------------------------------------------ */

/**
 * Upsert the mapping from a machine-local file. Idempotent.
 *
 *     bunx convex run repoMap:seed '{"entries":[…]}'
 *
 * Keyed on `repoFullName`, **lowercased here** rather than trusting the caller:
 * GitHub is case-insensitive about repository names, the seed file is
 * hand-written, and a mapping that silently fails to match because someone typed
 * `CoreyBain/Boca` is a bug whose only symptom is a tooltip quietly saying
 * "Other work". Lowercasing at the one write path means the index only ever
 * holds one spelling and the action's lookup can lowercase too and be sure.
 *
 * ── `prune` ────────────────────────────────────────────────────────────────
 *
 * Off by default. On, it deletes every row absent from the payload, which makes
 * the local file the whole truth rather than a set of additions — the right
 * behaviour when an entry has been *removed* from the file because a repo should
 * stop being attributed. It is opt-in because the payload comes from one
 * machine's file and a second machine seeding a partial list would otherwise
 * silently unmap the first machine's work. (The collector has the same
 * multi-machine hazard and solves it the same way: additive by default.)
 *
 * @returns counts only. Never a `repoFullName`, never a `displayName` — see the
 *   file header for why a summary is a leak surface too.
 */
export const seed = internalMutation({
  args: {
    entries: v.array(gitRepoMapEntry),
    prune: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<GitRepoMapSeedSummary> => {
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;

    // De-duplicated by key, last entry winning, so a file with the same repo
    // listed twice is an operator's typo rather than two writes racing inside
    // one transaction (`insert` then `patch` on a row this handler has not
    // re-read would be the subtle version of that bug).
    const wanted = new Map<string, { displayName: string; kind: GitRepoMapEntry['kind'] }>();
    for (const entry of args.entries) {
      wanted.set(entry.repoFullName.trim().toLowerCase(), {
        displayName: entry.displayName.trim(),
        kind: entry.kind,
      });
    }

    for (const [repoFullName, value] of wanted) {
      const existing = await ctx.db
        .query('gitRepoMap')
        .withIndex('by_repoFullName', (q) => q.eq('repoFullName', repoFullName))
        .first();

      if (existing === null) {
        await ctx.db.insert('gitRepoMap', { repoFullName, ...value });
        inserted += 1;
        continue;
      }

      if (existing.displayName === value.displayName && existing.kind === value.kind) {
        // Re-running the seed unchanged must not spend a write, so that "run it
        // again to be sure" is free and therefore actually gets done.
        unchanged += 1;
        continue;
      }

      await ctx.db.patch(existing._id, value);
      updated += 1;
    }

    let pruned = 0;
    if (args.prune === true) {
      const all = await ctx.db.query('gitRepoMap').withIndex('by_repoFullName').collect();
      for (const row of all) {
        if (wanted.has(row.repoFullName)) continue;
        await ctx.db.delete(row._id);
        pruned += 1;
      }
    }

    const after = await ctx.db.query('gitRepoMap').withIndex('by_repoFullName').collect();

    return {
      submitted: wanted.size,
      inserted,
      updated,
      unchanged,
      pruned,
      totals: {
        project: after.filter((row) => row.kind === 'project').length,
        lab: after.filter((row) => row.kind === 'lab').length,
        ignore: after.filter((row) => row.kind === 'ignore').length,
      },
    };
  },
});
