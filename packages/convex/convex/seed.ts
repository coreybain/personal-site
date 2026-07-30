/**
 * seed.ts — the one-shot, insert-only backfill that puts the mock Snapshot into
 * the database.
 *
 * ⚠️ THIS FILE IS A LADDER, NOT A FLOOR. It exists so that the moment apps/web
 * stops reading `apps/web/src/lib/snapshot.ts` and starts reading Convex, the
 * public site renders the *same* pages instead of a set of empty ones. Once real
 * content has been authored through the admin, nothing here should ever run
 * again — and everything below is written so that running it again is harmless
 * rather than destructive.
 *
 * ── Why an internalMutation and not `npx convex import` ────────────────────
 *
 * Both respect the schema: `convex import` validates the file against
 * schema.ts, and `ctx.db.insert` validates every document it writes. The
 * difference is what happens when the table is *not* empty.
 *
 *   • `convex import` fails the whole import on a non-empty table, and its two
 *     escape hatches — `--append` and `--replace` — are exactly the two things
 *     this must never do: append duplicates a slug (and slugs are the join key
 *     for the entire system), replace deletes rows the admin now owns.
 *   • It is also one table per invocation with no shared transaction, so a
 *     six-table seed is six independent chances to end up half-applied.
 *
 * The mutation below is one transaction over all six tables, and its rule is
 * per-table: **write only into a table that is currently empty.** A table with
 * even one row is skipped and reported, never touched. There is no update path,
 * no delete path, and no `force` argument — adding one would make this file a
 * standing risk to authored content rather than a one-time convenience.
 *
 * ── Why `internalMutation` ─────────────────────────────────────────────────
 *
 * `internalMutation` is not registered in the public API and cannot be called
 * from a browser, the iOS client, or any `ConvexHttpClient` — the only callers
 * are other Convex functions and the CLI (`convex run`, which authenticates with
 * the deploy credentials). That is the entire access control story here, and it
 * is why this file does not call `requireAdmin`: there is no user identity on a
 * CLI invocation to require, and a public mutation guarded by an admin check
 * would still be a bulk-insert endpoint sitting on the public surface.
 *
 * ── Why the payload is `v.any()` ───────────────────────────────────────────
 *
 * The rest of the package declares argument validators field by field, reusing
 * the exported validators from schema.ts so a mutation and its table cannot
 * drift. That works because those mutations take a handful of fields. This one
 * takes six whole documents — including the 52×7 contribution calendar — and
 * re-typing the entire schema as an argument validator would create precisely
 * the second copy of the contract that schema.ts's header warns about.
 *
 * So the boundary check is delegated to the two mechanisms that cannot drift:
 *
 *   1. **TypeScript.** Every row below is annotated
 *      `WithoutSystemFields<Doc<'table'>>`, derived from the generated data
 *      model. A field the schema does not have — or a required field the
 *      payload omits — is a `tsc --noEmit` failure in this package.
 *   2. **Convex itself.** `ctx.db.insert` validates every document against
 *      schema.ts at write time and rejects the whole transaction otherwise. A
 *      malformed payload cannot land a partial seed.
 *
 * The caller that builds the payload is `tooling/seed/seed.ts`, which imports
 * the mock directly and does the mapping; the mapping decisions (what is
 * synthesised, and what is deliberately left unseeded) are documented there.
 */

import type { WithoutSystemFields } from 'convex/server';
import { v } from 'convex/values';
import type { Doc, TableNames } from './_generated/dataModel';
import { type MutationCtx, internalMutation } from './_generated/server';
import { rebuildResumeExperience } from './resume';

/* ------------------------------------------------------------------ *
 * Payload
 * ------------------------------------------------------------------ */

/**
 * The six documents (well: four singleton-ish rows and two lists) the seed
 * writes, as they are stored.
 *
 * Named tables only, and named in the order they are written, because the order
 * is load-bearing exactly once: `resumeDocument` is written after
 * `experienceEntries` so that the projection rebuild at the end of the handler
 * has entries to project from.
 *
 * `funEntries` and `posts` are absent on purpose — see the handler's return
 * value and `tooling/seed/seed.ts` for why.
 */
type SeedPayload = {
  siteSettings: WithoutSystemFields<Doc<'siteSettings'>>;
  snapshot: WithoutSystemFields<Doc<'snapshot'>>;
  projects: WithoutSystemFields<Doc<'projects'>>[];
  labs: WithoutSystemFields<Doc<'labs'>>[];
  experienceEntries: WithoutSystemFields<Doc<'experienceEntries'>>[];
  resumeDocument: WithoutSystemFields<Doc<'resumeDocument'>>;
};

/** What happened to one table. `existing` is why, when nothing was written. */
type TableResult = {
  /** `true` when the table was empty and this run wrote into it. */
  seeded: boolean;
  /** Rows inserted. `0` on a skip. */
  rows: number;
  /**
   * Whether the table already held data. The only reason a skip ever happens,
   * kept separate from `seeded` so the summary reads as a fact rather than an
   * inference.
   */
  alreadyPopulated: boolean;
};

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/**
 * Is this table empty right now?
 *
 * `.first()` on the default (`by_creation_time`) index, so this is a single
 * B-tree probe rather than a `collect()` of a table that could be large by the
 * time anybody runs this against a populated deployment.
 */
async function isEmpty(ctx: MutationCtx, table: TableNames): Promise<boolean> {
  return (await ctx.db.query(table).first()) === null;
}

/**
 * Insert `rows` into `table` if and only if `table` is empty.
 *
 * The emptiness check and the inserts are in the same Convex transaction, so
 * there is no window in which a concurrent write could slip a row in between the
 * two — Convex's OCC retries this whole function against fresh data, where the
 * check then reports the table as populated and nothing is written.
 */
async function seedTable<T extends TableNames>(
  ctx: MutationCtx,
  table: T,
  rows: WithoutSystemFields<Doc<T>>[],
): Promise<TableResult> {
  if (!(await isEmpty(ctx, table))) {
    return { seeded: false, rows: 0, alreadyPopulated: true };
  }

  for (const row of rows) {
    await ctx.db.insert(table, row);
  }

  return { seeded: true, rows: rows.length, alreadyPopulated: false };
}

/* ------------------------------------------------------------------ *
 * The seed
 * ------------------------------------------------------------------ */

/**
 * Backfill every empty table from the mock Snapshot. Insert-only, idempotent.
 *
 * Running this twice writes nothing the second time. Running it after the admin
 * has authored one project writes nothing into `projects` and still backfills
 * whatever else is empty — the skip is per table, matching the per-domain mock
 * fallback in `apps/web/src/lib/data.ts`, so a half-seeded deployment renders
 * half live data and half mock rather than half a page.
 *
 * The one write that is not a plain insert is the resume projection rebuild at
 * the end, and it is fenced: it only runs when *this* call inserted the
 * `resumeDocument` row, because `rebuildResumeExperience` patches
 * `resumeDocument.experience` and patching a document the admin owns is exactly
 * what the rest of this file refuses to do. When the document already existed and
 * entries were seeded beneath it, the return value says so and the fix is the
 * admin's own `resume.syncFromEntries` button.
 *
 * @param payload - see `SeedPayload`. Built by `tooling/seed/seed.ts`.
 * @returns a per-table summary plus `notes`, both intended to be printed
 *   verbatim by the caller.
 */
export const seedAll = internalMutation({
  // See the file header for why this is `v.any()` and where the real checking
  // happens (tsc against `Doc<…>`, and `ctx.db.insert` against schema.ts).
  args: { payload: v.any() },
  handler: async (ctx, { payload }: { payload: SeedPayload }) => {
    const notes: string[] = [];

    /* ---- chrome and the dashboard row -------------------------------- */

    const siteSettings = await seedTable(ctx, 'siteSettings', [payload.siteSettings]);
    const snapshot = await seedTable(ctx, 'snapshot', [payload.snapshot]);

    /* ---- content ------------------------------------------------------ */

    const projects = await seedTable(ctx, 'projects', payload.projects);
    const labs = await seedTable(ctx, 'labs', payload.labs);

    /* ---- resume: entries first, then the document over the top -------- */

    const experienceEntries = await seedTable(
      ctx,
      'experienceEntries',
      payload.experienceEntries,
    );
    const resumeDocument = await seedTable(ctx, 'resumeDocument', [
      payload.resumeDocument,
    ]);

    // The projection is derived data (see resume.ts's header): the payload's
    // copy is a best effort by the caller, and this replaces it with the value
    // the same function the admin uses would produce. Only ever on a row we just
    // created — see the docblock above.
    if (resumeDocument.seeded) {
      const rebuilt = await rebuildResumeExperience(ctx);
      notes.push(
        `resumeDocument.experience rebuilt from experienceEntries (${rebuilt.roles} role${rebuilt.roles === 1 ? '' : 's'}).`,
      );
    } else if (experienceEntries.seeded) {
      notes.push(
        'experienceEntries were seeded beneath an existing resumeDocument. Its ' +
          '`experience` projection was NOT rebuilt — that row belongs to the admin. ' +
          'Run resume.syncFromEntries to reconcile it.',
      );
    }

    /* ---- what this seed deliberately does not write ------------------- */

    // Stated in the return value rather than only in a comment, because the
    // person running this needs to know that /fun rendering from the mock is the
    // designed outcome and not a failed write.
    notes.push(
      'funEntries: not seeded. `funEntryFields.photo` is a required MediaAsset ' +
        'and the mock has no imagery — a seeded photo would be an invented URL ' +
        'with invented alt text. /fun keeps rendering from the mock fallback.',
    );
    notes.push(
      'posts: not seeded. The mock has no blog, and ADR 018 ships `nav.blog: false`.',
    );
    notes.push(
      'snapshot.latestFunEntry and snapshot.healthStats are null — the first for ' +
        'the reason above, the second because no phone has ever posted (phase 7).',
    );

    return {
      tables: {
        siteSettings,
        snapshot,
        projects,
        labs,
        experienceEntries,
        resumeDocument,
      },
      notes,
    };
  },
});
