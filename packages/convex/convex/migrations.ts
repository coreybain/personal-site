/**
 * migrations.ts — one-shot backfills that make a schema change safe to finish,
 * and the hand-run repairs that finishing it turns out to need.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  Everything here is an `internalMutation`. None of it is in the public API.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A migration in this file is run by hand, once, from the CLI:
 *
 *     bunx convex run migrations:stampLegacyMachineLabels '{}'
 *
 * ┌─ what is here, in the order a multi-machine cutover uses it ──────────────┐
 * │ 1. `stampLegacyMachineLabels`  give pre-`machine` rows a label            │
 * │ 2. `adoptLegacyMachineRows`    hand them to the computer that wrote them, │
 * │                                so its next push revises rather than       │
 * │                                duplicates                                 │
 * │ 3. `deleteMachineRows`         remove one label's rows: a typo, or a      │
 * │                                simulated machine used to test the ingest  │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * (2) and (3) are not schema migrations — they are key maintenance, and they
 * live here because they exist for exactly the same reason (1) does: `machine`
 * became part of a key, and a key is a thing that can be wrong about rows that
 * already exist. They are hand-run, idempotent and report counts, which is the
 * standard everything in this file is held to.
 *
 * ── Why this file exists at all ────────────────────────────────────────────
 *
 * Because Convex validates *existing documents* when a schema is pushed. A new
 * required field therefore cannot simply be declared: the push fails on the rows
 * that predate it, and the deployment is stuck holding a schema that describes
 * the data it wants rather than the data it has. The way through is the standard
 * three-step, and the middle step is what lives here:
 *
 *   1. Declare the field `v.optional(...)` and push. Nothing breaks; new writes
 *      may start including it immediately.
 *   2. Run the backfill below. Every legacy row acquires a value.
 *   3. Drop the `v.optional()` and push again. Now the schema and the data agree
 *      and the compiler can enforce it on every future writer.
 *
 * Step 3 is the point of the exercise. An optional field that stays optional is
 * a field the type system cannot make anyone fill in — which, for a field that
 * is part of a *key*, is precisely the bug the migration is repairing.
 *
 * ── Rules for anything added here ─────────────────────────────────────────
 *
 *   • IDEMPOTENT. Running it twice must be indistinguishable from running it
 *     once. Every mutation below re-reads the current state and only writes
 *     rows that still need writing, so a half-finished run is resumed rather
 *     than compounded.
 *   • REPORTS WHAT IT DID. Each returns counts — `scanned`, `stamped`,
 *     `remaining` — because "did it finish?" must be answerable without opening
 *     the dashboard, and `remaining: 0` is the go-signal for step 3.
 *   • DELETE-ABLE. Once step 3 has shipped and the deployment has been
 *     re-pushed, a migration here is dead weight; it stays only as long as an
 *     un-migrated deployment might exist (dev, and prod until it is cut over).
 */

import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalMutation } from './_generated/server';
import { nextRevision } from './lib/revision';
import { invalid, nowIso } from './lib/validate';

/* ------------------------------------------------------------------ *
 * aiUsageDays.machine — multi-machine ingest
 * ------------------------------------------------------------------ */

/**
 * The label stamped on rows written before `machine` existed.
 *
 * Mirrors `LEGACY_MACHINE_LABEL` in `@home/types`/ingest.ts, re-declared rather
 * than imported because `packages/convex` cannot import that package — its
 * modules are bundled into Convex's own runtime (see the header of
 * `convex/lib/validate.ts`). If you change one, change the other.
 *
 * It is deliberately not a guess. Every legacy row was written by one computer
 * and which one is recorded nowhere, so inventing `'laptop'` would be a fiction
 * that later merges two histories the first time a machine actually calls itself
 * that. `'pre-multi-machine'` is true, is a valid `MachineLabelSchema` value
 * (lowercase, hyphens, under 32 characters — so backfilled rows satisfy the same
 * schema as new ones), and is a label no human would ever choose for a real
 * machine.
 */
const LEGACY_MACHINE_LABEL = 'pre-multi-machine';

/**
 * Give every `aiUsageDays` row a `machine`, so the field can become required.
 *
 * ── What it does ──────────────────────────────────────────────────────────
 *
 * Reads the whole table (a full scan is correct here: ~750 rows per agent-year,
 * and this runs once), patches rows whose `machine` is absent, and leaves rows
 * that already have one completely alone. Nothing else on the row is touched —
 * not `sessions`, not `hours`, not `projects`, and explicitly not `ingestedAt`,
 * which records when the *collector* last spoke about that day and would become
 * a lie if a migration moved it.
 *
 * ── Why it cannot double-count ────────────────────────────────────────────
 *
 * It never inserts and never sums; it stamps a label on rows that already exist.
 * A second run finds `stamped: 0` because the first run's rows now have a
 * `machine` and fail the `=== undefined` test. The upsert key changes shape
 * (`(day, agent)` → `(day, agent, machine)`) but the rows do not move: each
 * legacy row becomes the unique row for `(day, agent, 'pre-multi-machine')`, and
 * a real machine posting that same day now creates its *own* row beside it
 * instead of overwriting this one. The fold sums across machines, so history is
 * preserved and the new machine's numbers are added rather than substituted.
 *
 * ── After it returns `remaining: 0` ───────────────────────────────────────
 *
 * Drop the `v.optional()` from `aiUsageDays.machine` in schema.ts and push. Do
 * that only once every writer sends the field, or the next push after the next
 * ingest will fail on a row the endpoint wrote without one.
 *
 * No arguments, on purpose. There is nothing to parameterise that would not also
 * be a way to stamp the wrong label on the wrong rows.
 */
export const stampLegacyMachineLabels = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('aiUsageDays').collect();

    let stamped = 0;

    for (const row of rows) {
      // `undefined` is the only pre-migration state: the field did not exist, so
      // there is no empty string or null to consider. A row that already carries
      // a label — from this migration or from a collector that has already been
      // updated — is left exactly as it is.
      if (row.machine !== undefined) continue;

      await ctx.db.patch(row._id, { machine: LEGACY_MACHINE_LABEL });
      stamped += 1;
    }

    // Re-read rather than assume. A mutation sees its own writes, so this is the
    // post-state, and computing `remaining` instead of hardcoding `0` means the
    // go-signal for making the field required is measured rather than asserted —
    // which matters the day someone adds a `continue` to the loop above.
    const after = await ctx.db.query('aiUsageDays').collect();
    const remaining = after.filter((row) => row.machine === undefined).length;

    return {
      /** Rows examined. The whole table. */
      scanned: rows.length,
      /** Rows that acquired a label on this run. `0` on every run after the first. */
      stamped,
      /** Rows still missing one. Must be `0` before `machine` is made required. */
      remaining,
      /** Echoed so the operator can see what was written without reading this file. */
      label: LEGACY_MACHINE_LABEL,
    };
  },
});

/**
 * Hand the legacy rows to the machine that actually wrote them.
 *
 * ── The problem this exists for ───────────────────────────────────────────
 *
 * `stampLegacyMachineLabels` above is honest but incomplete. Every row it
 * stamps was written by one computer, and that computer is still running: the
 * moment it pushes again — under a label a human chose, `'laptop'` — its
 * lookback window arrives as a *second* set of rows describing the *same*
 * sessions. Both sets are then summed by both folds, and the site reports
 * roughly double for every day in the overlap. Nothing errors; the numbers are
 * just wrong, and they stay wrong for as long as those days sit inside the
 * 52-week snapshot window.
 *
 * That is the "renaming a machine splits its history" hazard documented on
 * `machineId` in tooling/collector/config.ts, and `'pre-multi-machine'` → the
 * real label IS such a rename. It is a rename that had to happen, so this is
 * the other half of it.
 *
 * ── What it does ──────────────────────────────────────────────────────────
 *
 * For each row still labelled `'pre-multi-machine'`, with `machine` set to the
 * label that computer now uses:
 *
 *   • **No row exists for (day, agent, machine)** → relabel it. The row is that
 *     machine's history and now says so. Nothing else on it is touched.
 *   • **A row already exists** → delete the legacy one. The live row is a
 *     complete recomputation of the same day by the same computer, which is the
 *     collector's stated contract for every day it sends; keeping both would be
 *     counting one afternoon twice. The newer claim wins, exactly as it does on
 *     any other re-push.
 *
 * Idempotent: a second run finds no `'pre-multi-machine'` rows and reports
 * zeroes. Safe to run before the machine's first labelled push (everything
 * relabels), after it (the overlap is deleted, the rest relabels), or twice.
 *
 * ⚠️ Run this **once, for one machine** — the one whose sessions those rows
 * describe. If two computers had been pushing before the change there would be
 * no way to tell whose rows these are, and this function would be the wrong
 * tool; that case is unrecoverable by construction and is exactly why the label
 * became part of the key.
 *
 * ```sh
 * bunx convex run migrations:adoptLegacyMachineRows '{"machine":"laptop"}'
 * ```
 *
 * @param machine - the adopting machine's label. Must be a real one: refusing
 *   `'pre-multi-machine'` here stops a no-op that reads as a success.
 * @returns `{ scanned, relabelled, superseded, remaining }` — `superseded` is
 *   the number deleted because the machine had already re-sent that day.
 */
export const adoptLegacyMachineRows = internalMutation({
  args: { machine: v.string() },
  handler: async (ctx, args) => {
    // The same shape `MachineLabelSchema` and `parseMachineLabel` enforce. A bad
    // label written here would be a row nothing can ever find again, so it is
    // checked at every door rather than trusted from the CLI.
    if (!/^[a-z0-9][a-z0-9-]*$/.test(args.machine) || args.machine.length > 32) {
      invalid({
        code: 'invalid-format',
        field: 'machine',
        message:
          'Expected a short lowercase machine label, e.g. "laptop" or "work-desktop".',
      });
    }
    if (args.machine === LEGACY_MACHINE_LABEL) {
      invalid({
        code: 'invalid-format',
        field: 'machine',
        message: `Adopting the rows into ${LEGACY_MACHINE_LABEL} is a no-op. Pass the label the machine actually uses.`,
      });
    }

    const legacy = (await ctx.db.query('aiUsageDays').collect()).filter(
      (row) => row.machine === LEGACY_MACHINE_LABEL,
    );

    let relabelled = 0;
    let superseded = 0;

    for (const row of legacy) {
      // The full triple, off the upsert index — the same probe the ingest
      // route makes, so "would this collide?" is answered the same way it will
      // be answered on the next push.
      const existing = await ctx.db
        .query('aiUsageDays')
        .withIndex('by_day_agent_machine', (q) =>
          q.eq('day', row.day).eq('agent', row.agent).eq('machine', args.machine),
        )
        .first();

      if (existing === null) {
        await ctx.db.patch(row._id, { machine: args.machine });
        relabelled += 1;
      } else {
        await ctx.db.delete(row._id);
        superseded += 1;
      }
    }

    const after = (await ctx.db.query('aiUsageDays').collect()).filter(
      (row) => row.machine === LEGACY_MACHINE_LABEL,
    ).length;

    return {
      /** Rows carrying the legacy label when this run started. */
      scanned: legacy.length,
      /** Rows handed to `machine`, contents untouched. */
      relabelled,
      /** Rows dropped because `machine` had already re-sent that day. */
      superseded,
      /** Legacy rows left. `0` after any successful run. */
      remaining: after,
    };
  },
});

/**
 * Delete every `aiUsageDays` row belonging to one machine label.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  DESTRUCTIVE AND UNRECOVERABLE. THE ROWS ARE THE ONLY COPY.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `aiUsageDays` is raw ingest: the Snapshot is derived from it, and the source
 * it was derived from — `~/.claude` and `~/.codex` on some machine — may have
 * been pruned since. A deleted row comes back only if that machine still has the
 * session files and the day is still inside its lookback window.
 *
 * It exists because a label that is part of a key is a label that can be wrong,
 * and there are exactly two ways to be wrong about one, both of which leave rows
 * nothing will ever update again:
 *
 *   • A typo. `mabook` pushed for a week; the correct rows now live under
 *     `macbook` and the typo's rows sit there being summed forever.
 *   • A test. A simulated second machine used to prove multi-machine ingest
 *     works — as `'workflow-sim'` was — must not be left inflating the site's
 *     figures once it has proved it.
 *
 * A retired *real* machine is neither of those and must NOT be deleted. Its rows
 * are history: the work happened, and the computer being gone does not unhappen
 * it. Leave them.
 *
 * This does not re-fold the Snapshot. Run `gitStats:rebuild` (or wait for the
 * hourly cron) afterwards, or the derived figures keep including what was just
 * deleted.
 *
 * ```sh
 * bunx convex run migrations:deleteMachineRows '{"machine":"workflow-sim"}'
 * ```
 *
 * @param machine - the label to remove. No wildcards, no ranges, no "all rows
 *   before X": one exact label, so a slip of the finger deletes one machine's
 *   rows rather than the table.
 * @returns `{ deleted, remainingRows, machines }` — `machines` is the labels
 *   still present afterwards, which is how an operator confirms they removed the
 *   one they meant and not the one beside it.
 */
export const deleteMachineRows = internalMutation({
  args: { machine: v.string() },
  handler: async (ctx, args) => {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(args.machine) || args.machine.length > 32) {
      invalid({
        code: 'invalid-format',
        field: 'machine',
        message: 'Expected a short lowercase machine label.',
      });
    }

    const rows = await ctx.db.query('aiUsageDays').collect();
    const doomed = rows.filter((row) => row.machine === args.machine);

    if (doomed.length === 0) {
      // Not an error — this is how a second run behaves, and a re-run must be
      // safe. Reported as a zero rather than a throw so the caller can tell
      // "already gone" from "wrong label" by reading `machines` below.
      return {
        deleted: 0,
        remainingRows: rows.length,
        machines: [...new Set(rows.map((row) => row.machine ?? '(unlabelled)'))].sort(),
      };
    }

    for (const row of doomed) {
      await ctx.db.delete(row._id);
    }

    const after = await ctx.db.query('aiUsageDays').collect();

    return {
      deleted: doomed.length,
      remainingRows: after.length,
      machines: [...new Set(after.map((row) => row.machine ?? '(unlabelled)'))].sort(),
    };
  },
});

/* ------------------------------------------------------------------ *
 * siteSettings.favoriteLabSlug — Off the Clock lead project
 * ------------------------------------------------------------------ */

const INITIAL_FAVORITE_LAB_SLUG = 'partybooth';

/**
 * Select PartyBooth for Off the Clock on deployments with legacy settings.
 *
 * This is intentionally narrower than a general settings editor: it writes only
 * when the singleton has no selection and the target Lab already exists as a
 * published row. A deliberate current or future selection is never overwritten,
 * and a missing/draft Lab is reported rather than creating a dangling reference.
 * The revision and edit timestamp move together, matching authenticated settings
 * writes so an already-open editor receives an ordinary optimistic-concurrency
 * conflict instead of silently replacing the migration.
 *
 * Idempotent: after the first successful run, every later run reports
 * `already-set` and writes nothing.
 *
 * ```sh
 * bunx convex run migrations:backfillFavoriteLab '{}'
 * ```
 */
export const backfillFavoriteLab = internalMutation({
  args: {},
  handler: async (ctx) => {
    const settings = await ctx.db.query('siteSettings').order('desc').first();
    if (settings === null) {
      return {
        changed: false,
        reason: 'settings-missing' as const,
        favoriteLabSlug: null,
        revision: null,
      };
    }

    if (settings.favoriteLabSlug !== undefined) {
      return {
        changed: false,
        reason: 'already-set' as const,
        favoriteLabSlug: settings.favoriteLabSlug,
        revision: settings.revision ?? 0,
      };
    }

    const lab = await ctx.db
      .query('labs')
      .withIndex('by_slug', (q) => q.eq('slug', INITIAL_FAVORITE_LAB_SLUG))
      .first();

    if (lab === null) {
      return {
        changed: false,
        reason: 'lab-missing' as const,
        favoriteLabSlug: null,
        revision: settings.revision ?? 0,
      };
    }

    if (!lab.published) {
      return {
        changed: false,
        reason: 'lab-unpublished' as const,
        favoriteLabSlug: null,
        revision: settings.revision ?? 0,
      };
    }

    const revision = nextRevision(settings.revision);
    const updatedAt = nowIso();
    await ctx.db.patch(settings._id, {
      favoriteLabSlug: INITIAL_FAVORITE_LAB_SLUG,
      revision,
      updatedAt,
    });

    return {
      changed: true,
      reason: 'backfilled' as const,
      favoriteLabSlug: INITIAL_FAVORITE_LAB_SLUG,
      revision,
    };
  },
});

/**
 * Flip one key of `siteSettings.nav` from the CLI.
 *
 * Not a schema migration — operational maintenance, here for the same reason
 * `deleteMachineRows` is: the value lives behind `requireAdmin`, and a CLI
 * invocation has no user identity to satisfy it. The gate on this function is
 * "can you deploy to this backend" (the `issueForMachine` argument, at length
 * in ingestTokens.ts) — anyone who can run it could push a mutation that does
 * the same thing.
 *
 *     bunx convex run migrations:setNavVisibility '{"key":"blog","value":true}'
 *
 * The admin UI's Site settings screen is the everyday way to do this; the CLI
 * path exists for bootstrap and for fixing a setting when the browser session
 * is not to hand. No-ops (already the requested value) report `changed: false`.
 */
export const setNavVisibility = internalMutation({
  args: {
    key: v.union(
      v.literal('work'),
      v.literal('labs'),
      v.literal('blog'),
      v.literal('fun'),
      v.literal('resume'),
      v.literal('contact'),
      v.literal('ask'),
    ),
    value: v.boolean(),
  },
  handler: async (ctx, args) => {
    const settings = await ctx.db.query('siteSettings').order('desc').first();
    if (settings === null) {
      invalid({
        code: 'invalid-format',
        field: 'siteSettings',
        message: 'No siteSettings row exists yet — seed the site first.',
      });
      return; // unreachable; invalid() throws
    }

    const current = settings.nav[args.key];
    if (current === args.value) {
      return { key: args.key, value: args.value, changed: false };
    }

    await ctx.db.patch(settings._id, {
      nav: { ...settings.nav, [args.key]: args.value },
    });
    return { key: args.key, value: args.value, changed: true };
  },
});

/**
 * Add the Visual Editor case study approved for the public build ledger.
 *
 * The everyday content path is the authenticated projects editor. This
 * idempotent migration exists because the local collector can only attribute a
 * repository to a slug that already exists in `projects`, while CLI deployment
 * work has no Clerk identity with which to use that editor. It inserts exactly
 * one factual, non-featured row and schedules the same knowledge indexing that
 * the normal publish mutation does. Re-running reports the existing row and
 * changes nothing.
 *
 *     bunx convex run migrations:addVisualEditorProject '{}'
 */
export const addVisualEditorProject = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query('projects')
      .withIndex('by_slug', (q) => q.eq('slug', 'visual-editor'))
      .first();

    if (existing !== null) {
      return {
        projectId: existing._id,
        slug: existing.slug,
        created: false,
        published: existing.published,
      };
    }

    const last = await ctx.db
      .query('projects')
      .withIndex('by_sortOrder')
      .order('desc')
      .first();

    const projectId = await ctx.db.insert('projects', {
      revision: 1,
      published: true,
      featured: false,
      sortOrder: last === null ? 0 : last.sortOrder + 1,
      slug: 'visual-editor',
      title: 'Visual Editor',
      client: 'Corporate Interactive',
      attribution: 'Built at Corporate Interactive',
      role: 'Principal Engineer',
      summary:
        'A multi-tenant visual site builder and content management platform that powers authenticated editing, project-specific page composition and public rendering from one Next.js application.',
      stack: ['Next.js', 'React', 'TypeScript', 'tRPC', 'Drizzle', 'MySQL', 'Zustand'],
      media: [],
      links: {},
      accent: 'hsl(252 84% 62%)',
      accentHue: 252,
    });

    await ctx.scheduler.runAfter(0, internal.knowledge.indexSource, {
      sourceType: 'project',
      sourceSlug: 'visual-editor',
    });

    return {
      projectId,
      slug: 'visual-editor',
      created: true,
      published: true,
    };
  },
});
