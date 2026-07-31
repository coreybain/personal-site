/**
 * experienceEntries.ts — CRUD for the normalised work history the resume is
 * built from.
 *
 * ⚠️ **Read the header of resume.ts first.** This table is one half of a pair:
 * the rows here are the editable source, and `resumeDocument.experience[]` is the
 * render-ready projection of them. Every write below ends with
 * `rebuildResumeExperience(ctx)` — imported from resume.ts, run in the same
 * transaction as the write it follows — so the source and the projection commit
 * together and `/resume`, `/api/resume.pdf` and `/about` can never print
 * different work histories. Nothing in this file writes `resumeDocument` any
 * other way, and nothing outside resume.ts writes the projection at all.
 *
 * ── Dates ─────────────────────────────────────────────────────────────────
 *
 * `startDate` and `endDate` are `YYYY-MM-DD` calendar labels, not instants (see
 * schema.ts's header for the three exceptions to "every timestamp is an RFC 3339
 * string", of which this is one). They are stored in the machine-comparable form
 * precisely because the resume prints the human form: sorting, duration maths and
 * "how many years shipping" all run on these, and `resume.ts`'s `periodLabel` is
 * the single place they become text.
 *
 * `endDate: null` is the current role, and the projection renders it as
 * `'Present'`. That is why the schema field is nullable rather than optional: a
 * stored `null` says "still there", an absent key would say "nobody filled it
 * in", and the resume needs to tell those apart. The same distinction is why
 * `create` requires the argument and `update` treats omission as "unchanged" —
 * see each function.
 *
 * ── sortOrder: lowest is newest ────────────────────────────────────────────
 *
 * `by_sortOrder` ascending is the order the resume prints, and a resume prints
 * the newest role first. So the *lowest* sortOrder is the top of the document,
 * and `create` therefore defaults a new entry to the front rather than the back
 * (unlike every other admin-sortable collection in this schema, which appends) —
 * the role you are adding is almost always the one you just started. An explicit
 * `sortOrder` always wins.
 *
 * The order is the admin's, not the dates': `rebuildResumeExperience` never
 * re-sorts by `startDate`, because a resume sometimes leads with the role that
 * argues best rather than the most recent one. Negative values are legal
 * (`SortOrderSchema` is `z.int()`), which is what makes "insert at the front"
 * possible without renumbering every other row.
 *
 * ── No public read ────────────────────────────────────────────────────────
 *
 * Unlike projects, labs and posts, every read in this file is admin-only. There
 * is no `published` flag to filter on and no public consumer: the public path to
 * this data is `resume.get`, which returns the projection in one document read.
 * Exposing the rows as well would create a second public shape of the same facts,
 * which is exactly how the page and the PDF start disagreeing.
 *
 * One known gap, and it is deliberate: `projectSlugs` — the link from a role to
 * the case studies covering it — exists only on these rows, not on the
 * projection, so the public resume cannot yet link a role to `/work/[slug]`.
 * Closing that means adding `projectSlugs` to `ResumeRoleSchema` in `@home/types`
 * and to `resumeRole` in schema.ts first, then carrying it through `projectRole`
 * in resume.ts. It is not a reason to make this table public.
 */

import type { WithoutSystemFields } from 'convex/server';
import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { type QueryCtx, mutation, query } from './_generated/server';
import { requireAdmin } from './lib/auth';
import {
  assertExpectedRevision,
  currentRevision,
  nextRevision,
} from './lib/revision';
import { assertSlug, assertText, invalid } from './lib/validate';
import { rebuildResumeExperience } from './resume';

/* ------------------------------------------------------------------ *
 * Bounds
 *
 * `ExperienceEntrySchema` bounds these as non-empty and nothing more, so
 * — as in posts.ts — the maxima are storage sanity bounds rather than
 * contract bounds, keeping a stuck paste well away from Convex's 1 MB
 * document limit where the failure would be opaque.
 *
 * The list counts are layout bounds instead: both renderers put this on
 * a page (ADR 011), and forty highlights on one role is a broken
 * document rather than a thorough one.
 * ------------------------------------------------------------------ */

const MAX_COMPANY = 160;
const MAX_TITLE = 160;
/** The role's paragraph. Two or three sentences in practice. */
const MAX_SUMMARY = 2_000;
/** One achievement line. Longer than this is a paragraph in a bullet. */
const MAX_HIGHLIGHT = 400;
const MAX_HIGHLIGHTS = 20;
const MAX_SKILL = 60;
const MAX_SKILLS = 40;
const MAX_PROJECT_SLUGS = 12;

/**
 * Sanity bound on `sortOrder`. `SortOrderSchema` is an unbounded `z.int()`, and
 * the range is symmetric because negatives are how a row is inserted at the front
 * of the resume (see the file header). This exists to catch a pasted timestamp,
 * which would otherwise sort a role to one end of the document forever.
 */
const SORT_ORDER_LIMIT = 100_000;

/* ------------------------------------------------------------------ *
 * Local validation
 * ------------------------------------------------------------------ */

/**
 * Assert a `YYYY-MM-DD` calendar date. Mirrors `IsoDateSchema` (`z.iso.date()`).
 *
 * ⚠️ This belongs in lib/validate.ts, next to `assertSlug` and friends, and it
 * lives here for now because the phase-2 backend files were written in parallel
 * and lib/ was owned by another change. Promoting it is a mechanical follow-up —
 * funEntries.ts needs the instant-shaped sibling of it.
 *
 * Two checks, and the second is the one that matters: the pattern accepts
 * `2026-02-31`, so the value is round-tripped through `Date` and compared back to
 * catch a day that does not exist in that month. `new Date('2026-02-31')` is
 * `Invalid Date` per the ECMAScript date-time-string grammar, and the re-render
 * comparison also rejects a value the parser silently normalises.
 *
 * Note the fixed width is load-bearing beyond validity: `resume.ts`'s
 * `periodLabel` takes the year by slicing the first four characters, and
 * `startDate` is compared to `endDate` below with a plain string `<=`.
 */
function assertCalendarDate(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    invalid({
      code: 'invalid-format',
      field,
      message: `${field} must be a calendar date in YYYY-MM-DD form (got ${JSON.stringify(value)}).`,
    });
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    invalid({
      code: 'invalid-format',
      field,
      message: `${field} is not a real date (got ${JSON.stringify(value)}).`,
    });
  }
}

/**
 * Assert the role did not end before it started.
 *
 * A plain string comparison, which is exact for fixed-width `YYYY-MM-DD` values
 * — the same lexicographic-equals-chronological property the ISO timestamps rely
 * on (schema.ts's header). `null` is the current role and has no end to check.
 *
 * Both values are always passed, even when `update` is changing only one of them:
 * a patch that moves `startDate` past an existing `endDate` is the reversal this
 * check exists to catch, and validating the argument alone would miss it.
 */
function assertPeriod(startDate: string, endDate: string | null): void {
  if (endDate !== null && endDate < startDate) {
    invalid({
      code: 'precondition-failed',
      field: 'endDate',
      message: `endDate (${endDate}) cannot be before startDate (${startDate}). Leave it null for the current role.`,
    });
  }
}

/**
 * Assert an integer within the sanity range above.
 *
 * `v.number()` accepts `1.5`, `NaN` and `1e309` alike, and a fractional
 * `sortOrder` would sort correctly while making "the row after this one" an
 * unanswerable question for the admin UI.
 */
function assertSortOrder(value: number, field = 'sortOrder'): void {
  if (!Number.isInteger(value) || Math.abs(value) > SORT_ORDER_LIMIT) {
    invalid({
      code: 'out-of-range',
      field,
      message: `${field} must be a whole number between -${SORT_ORDER_LIMIT} and ${SORT_ORDER_LIMIT} (got ${value}).`,
    });
  }
}

/**
 * Trim, drop blanks, cap the count, and reject anything over-long.
 *
 * Shared by `highlights`, `skills` and `projectSlugs`, which all arrive from the
 * same kind of admin control (a textarea or a token input) and all share the same
 * two failure modes: a trailing blank line, which is a typing artefact and is
 * dropped, and a paragraph pasted into a list field, which is rejected rather
 * than silently truncated. Order is preserved — the first highlight is the one
 * the reader sees first, so this is not a set.
 *
 * @param dedupe - case-insensitive. On for `skills` and `projectSlugs`, where a
 *   repeat is noise; off for `highlights`, where two similar lines may both be
 *   deliberate.
 */
function normaliseList(
  values: readonly string[],
  field: string,
  maxEach: number,
  maxCount: number,
  dedupe: boolean,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of values) {
    const value = raw.trim();
    if (value.length === 0) continue;
    if (value.length > maxEach) {
      invalid({
        code: 'out-of-range',
        field,
        message: `Each ${field} entry must be ${maxEach} characters or fewer (got ${value.length}).`,
      });
    }
    if (dedupe) {
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(value);
  }

  if (out.length > maxCount) {
    invalid({
      code: 'out-of-range',
      field,
      message: `${field} may hold at most ${maxCount} entries (got ${out.length}).`,
    });
  }

  return out;
}

/**
 * Normalise the case-study links, and check each is a well-formed slug.
 *
 * Format only — existence is NOT checked, for the same reason
 * `siteSettings.upsert` does not check `featured.*`: a role can reference a case
 * study that has not been written yet, and the resume renderer already treats a
 * slug that resolves to nothing as "no link". An existence check here would make
 * a perfectly reasonable intermediate state unsaveable.
 */
function normaliseProjectSlugs(values: readonly string[]): string[] {
  const slugs = normaliseList(
    values,
    'projectSlugs',
    // A slug is bounded at 96 by `SlugSchema`; `assertSlug` enforces that
    // precisely, so this bound only exists to give the count check something
    // sane to work with.
    96,
    MAX_PROJECT_SLUGS,
    true,
  );

  for (const slug of slugs) {
    assertSlug(slug, 'projectSlugs');
  }

  return slugs;
}

/* ------------------------------------------------------------------ *
 * Read — admin only, see the file header
 * ------------------------------------------------------------------ */

/**
 * Every entry, in resume order. Admin-only.
 *
 * `by_sortOrder` ascending, which is the order the projection is built in and the
 * order the document prints — so the admin list is the resume's own running
 * order, not a separate view of it. Newest role at the top (see the file header).
 *
 * No `limit`: `.collect()` is unbounded and safe here because this table holds a
 * career rather than a feed. A resume with enough rows to need pagination has a
 * bigger problem than this query.
 *
 * @returns `Array<Doc<'experienceEntries'>>` — whole documents, unshaped, per the
 *   package convention (see snapshot.ts).
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    return await ctx.db
      .query('experienceEntries')
      .withIndex('by_sortOrder')
      .order('asc')
      .collect();
  },
});

/**
 * One entry by id, or `null`. Admin-only.
 *
 * For the admin edit form, which is reached from `list` and holds only the id.
 * `null` rather than an error on an unknown id: the likely cause is a stale tab
 * pointing at a row that has since been deleted, and that should render "this
 * entry is gone" rather than a 500. The write mutations below are stricter,
 * because a write to a missing row is a genuine failure.
 *
 * @returns `Doc<'experienceEntries'> | null`
 */
export const get = query({
  args: { entryId: v.id('experienceEntries') },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    return await ctx.db.get(args.entryId);
  },
});

/* ------------------------------------------------------------------ *
 * Write — every one rebuilds the projection, see the file header
 * ------------------------------------------------------------------ */

/**
 * Add a role. Admin-only.
 *
 * `endDate` is required, and nullable: passing `null` is how you say "this is my
 * current role", and there is no way to leave the question unanswered. The
 * distinction is the whole reason the stored field is nullable rather than
 * optional (see the file header) and it is worth one required argument.
 *
 * `sortOrder` is optional and defaults to **one below the current lowest**, i.e.
 * the top of the resume, because a role being added is nearly always the one just
 * started. No other row is renumbered, which is why the default goes negative
 * over time rather than shuffling the table on every insert.
 *
 * @returns `{ entryId, sortOrder, revision, created, resume }` — `sortOrder` is the value as stored,
 *   which the caller needs when it did not supply one. `resume.synced` is false
 *   when there is no resume document to project into yet; that is a successful
 *   state, not a failure (see `rebuildResumeExperience`).
 */
export const create = mutation({
  args: {
    company: v.string(),
    title: v.string(),
    startDate: v.string(),
    endDate: v.union(v.string(), v.null()),
    summary: v.string(),
    highlights: v.array(v.string()),
    skills: v.array(v.string()),
    sortOrder: v.optional(v.number()),
    projectSlugs: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    assertText(args.company, 'company', MAX_COMPANY);
    assertText(args.title, 'title', MAX_TITLE);
    assertText(args.summary, 'summary', MAX_SUMMARY);

    assertCalendarDate(args.startDate, 'startDate');
    if (args.endDate !== null) {
      assertCalendarDate(args.endDate, 'endDate');
    }
    assertPeriod(args.startDate, args.endDate);

    const sortOrder = args.sortOrder ?? (await frontSortOrder(ctx));
    assertSortOrder(sortOrder);

    // Annotated with the table's own document type, so a field this file writes
    // that the schema does not describe — or vice versa — is a typecheck failure
    // here rather than a rejected write at runtime.
    const row: WithoutSystemFields<Doc<'experienceEntries'>> = {
      revision: 1,
      company: args.company.trim(),
      title: args.title.trim(),
      startDate: args.startDate,
      endDate: args.endDate,
      summary: args.summary.trim(),
      highlights: normaliseList(
        args.highlights,
        'highlights',
        MAX_HIGHLIGHT,
        MAX_HIGHLIGHTS,
        false,
      ),
      skills: normaliseList(args.skills, 'skills', MAX_SKILL, MAX_SKILLS, true),
      sortOrder,
      // Optional on the table, so an omitted argument writes no key at all rather
      // than an empty array — "never asked" and "asked, and there are none" stay
      // distinguishable. `projectSlugs: []` is how the admin clears the links.
      ...(args.projectSlugs !== undefined
        ? { projectSlugs: normaliseProjectSlugs(args.projectSlugs) }
        : {}),
    };

    const entryId = await ctx.db.insert('experienceEntries', row);
    const resume = await rebuildResumeExperience(ctx);

    return {
      entryId,
      sortOrder,
      revision: 1 as const,
      created: true,
      resume: {
        synced: resume.synced,
        roles: resume.roles,
        changed: resume.changed,
        revision: resume.revision,
      },
    };
  },
});

/**
 * Patch a role. Admin-only. Absent argument ⇒ field unchanged.
 *
 * The one argument that needs reading twice is `endDate`, which is *optional and
 * nullable*, and the two are not the same thing:
 *
 *   • omitted     — leave it as it is.
 *   • `null`      — this is now the current role; the projection prints 'Present'.
 *   • a date      — the role ended on that day.
 *
 * `sortOrder` is deliberately absent from this argument list. Reordering is
 * `setSortOrder`, for the same reason publishing is its own mutation in posts.ts:
 * a form that saves prose should not be able to move a row up the resume as a
 * side effect of a stale field value.
 *
 * `projectSlugs: []` clears the links. There is no way to remove the key entirely
 * once written, and nothing reads the difference — an empty array and an absent
 * one both mean "no case studies".
 *
 * @returns `{ entryId, changed, revision, resume }` — `changed` is false when the call
 *   passed no fields, which is a successful no-op rather than an error. The
 *   projection is rebuilt either way, so a no-op save doubles as a repair.
 */
export const update = mutation({
  args: {
    entryId: v.id('experienceEntries'),
    expectedRevision: v.optional(v.number()),
    company: v.optional(v.string()),
    title: v.optional(v.string()),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.union(v.string(), v.null())),
    summary: v.optional(v.string()),
    highlights: v.optional(v.array(v.string())),
    skills: v.optional(v.array(v.string())),
    projectSlugs: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const row = await ctx.db.get(args.entryId);
    if (row === null) {
      invalid({
        code: 'not-found',
        field: 'entryId',
        message: 'That experience entry no longer exists.',
      });
    }

    assertExpectedRevision(row.revision, args.expectedRevision);

    const patch: Partial<WithoutSystemFields<Doc<'experienceEntries'>>> = {};

    if (args.company !== undefined) {
      assertText(args.company, 'company', MAX_COMPANY);
      patch.company = args.company.trim();
    }

    if (args.title !== undefined) {
      assertText(args.title, 'title', MAX_TITLE);
      patch.title = args.title.trim();
    }

    if (args.summary !== undefined) {
      assertText(args.summary, 'summary', MAX_SUMMARY);
      patch.summary = args.summary.trim();
    }

    if (args.startDate !== undefined) {
      assertCalendarDate(args.startDate, 'startDate');
      patch.startDate = args.startDate;
    }

    if (args.endDate !== undefined) {
      if (args.endDate !== null) {
        assertCalendarDate(args.endDate, 'endDate');
      }
      patch.endDate = args.endDate;
    }

    // Checked against the merged result rather than the arguments: moving only
    // `startDate` can invert a period whose `endDate` is not part of this call.
    //
    // Note the explicit `undefined` comparison on `endDate` rather than `??`.
    // `null` is a meaningful value here — "current role" — and `patch.endDate ??
    // row.endDate` would quietly fall back to the stored end date on exactly the
    // call that clears it, so re-opening a closed role while also moving its start
    // date would be rejected against a date the row no longer has.
    assertPeriod(
      args.startDate !== undefined ? args.startDate : row.startDate,
      args.endDate !== undefined ? args.endDate : row.endDate,
    );

    if (args.highlights !== undefined) {
      patch.highlights = normaliseList(
        args.highlights,
        'highlights',
        MAX_HIGHLIGHT,
        MAX_HIGHLIGHTS,
        false,
      );
    }

    if (args.skills !== undefined) {
      patch.skills = normaliseList(args.skills, 'skills', MAX_SKILL, MAX_SKILLS, true);
    }

    if (args.projectSlugs !== undefined) {
      patch.projectSlugs = normaliseProjectSlugs(args.projectSlugs);
    }

    const changed = Object.keys(patch).length > 0;
    if (changed) {
      patch.revision = nextRevision(row.revision);
      await ctx.db.patch(row._id, patch);
    }

    const resume = await rebuildResumeExperience(ctx);

    return {
      entryId: row._id,
      changed,
      revision: changed ? nextRevision(row.revision) : currentRevision(row.revision),
      resume: {
        synced: resume.synced,
        roles: resume.roles,
        changed: resume.changed,
        revision: resume.revision,
      },
    };
  },
});

/**
 * Move a role up or down the resume. Admin-only.
 *
 * Absolute, not relative: the caller states the weight it wants, and no other row
 * is touched. That keeps a reorder from being a table-wide write, and it is why
 * the value may be negative — inserting at the front is `min - 1`, not a
 * renumbering of everything below it (see the file header).
 *
 * One row per call. A drag-and-drop admin list therefore issues one call per
 * moved row, each of which rebuilds the projection; that is a small indexed read
 * plus one patch, and this table holds a career, so a batch variant is not worth
 * the extra shape. If the admin UI ever reorders the whole list in one gesture,
 * add `setOrder({ entryIds: [...] })` beside this rather than widening it.
 *
 * Setting the value a row already has is a no-op that succeeds.
 *
 * @returns `{ entryId, sortOrder, changed, revision, resume }`
 */
export const setSortOrder = mutation({
  args: {
    entryId: v.id('experienceEntries'),
    sortOrder: v.number(),
    expectedRevision: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    assertSortOrder(args.sortOrder);

    const row = await ctx.db.get(args.entryId);
    if (row === null) {
      invalid({
        code: 'not-found',
        field: 'entryId',
        message: 'That experience entry no longer exists.',
      });
    }

    assertExpectedRevision(row.revision, args.expectedRevision);
    const changed = row.sortOrder !== args.sortOrder;
    const revision = changed ? nextRevision(row.revision) : currentRevision(row.revision);
    if (changed) {
      await ctx.db.patch(row._id, {
        sortOrder: args.sortOrder,
        revision,
      });
    }

    // The projection's order comes from this field, so a reorder changes the
    // document even though no role's text did.
    const resume = await rebuildResumeExperience(ctx);

    return {
      entryId: row._id,
      sortOrder: args.sortOrder,
      changed,
      revision,
      resume: {
        synced: resume.synced,
        roles: resume.roles,
        changed: resume.changed,
        revision: resume.revision,
      },
    };
  },
});

/**
 * Swap two roles in one transaction and rebuild the résumé projection once.
 *
 * Mobile reorder controls operate a row at a time. Two independent
 * `setSortOrder` calls leave duplicate weights if the second request fails;
 * keeping the exchange here makes that partial state impossible.
 *
 * @returns `{ firstEntryId, secondEntryId, changed, firstRevision,
 * secondRevision, resume }`
 */
export const swapSortOrder = mutation({
  args: {
    firstEntryId: v.id('experienceEntries'),
    secondEntryId: v.id('experienceEntries'),
    firstExpectedRevision: v.optional(v.number()),
    secondExpectedRevision: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    if (args.firstEntryId === args.secondEntryId) {
      const row = await ctx.db.get(args.firstEntryId);
      if (row === null) {
        invalid({
          code: 'not-found',
          field: 'firstEntryId',
          message: 'That experience entry no longer exists.',
        });
      }
      assertExpectedRevision(row.revision, args.firstExpectedRevision);
      assertExpectedRevision(row.revision, args.secondExpectedRevision);
      const resume = await rebuildResumeExperience(ctx);
      return {
        firstEntryId: row._id,
        secondEntryId: row._id,
        changed: false,
        firstRevision: currentRevision(row.revision),
        secondRevision: currentRevision(row.revision),
        resume: {
          synced: resume.synced,
          roles: resume.roles,
          changed: resume.changed,
          revision: resume.revision,
        },
      };
    }

    const [first, second] = await Promise.all([
      ctx.db.get(args.firstEntryId),
      ctx.db.get(args.secondEntryId),
    ]);
    if (first === null) {
      invalid({
        code: 'not-found',
        field: 'firstEntryId',
        message: 'The first experience entry no longer exists.',
      });
    }
    if (second === null) {
      invalid({
        code: 'not-found',
        field: 'secondEntryId',
        message: 'The second experience entry no longer exists.',
      });
    }

    assertExpectedRevision(first.revision, args.firstExpectedRevision);
    assertExpectedRevision(second.revision, args.secondExpectedRevision);
    const changed = first.sortOrder !== second.sortOrder;
    if (changed) {
      await ctx.db.patch(first._id, {
        sortOrder: second.sortOrder,
        revision: nextRevision(first.revision),
      });
      await ctx.db.patch(second._id, {
        sortOrder: first.sortOrder,
        revision: nextRevision(second.revision),
      });
    }

    const resume = await rebuildResumeExperience(ctx);
    return {
      firstEntryId: first._id,
      secondEntryId: second._id,
      changed,
      firstRevision: changed
        ? nextRevision(first.revision)
        : currentRevision(first.revision),
      secondRevision: changed
        ? nextRevision(second.revision)
        : currentRevision(second.revision),
      resume: {
        synced: resume.synced,
        roles: resume.roles,
        changed: resume.changed,
        revision: resume.revision,
      },
    };
  },
});

/**
 * Delete a role for good. Admin-only.
 *
 * Idempotent: deleting a row that is already gone reports `deleted: false` and
 * succeeds, because the likely cause is a double-click or a stale tab and both
 * mean the caller got what it wanted. Same contract as `posts.remove` and
 * `contactMessages.remove`.
 *
 * There is no soft delete and no `published` flag on this table — a role is
 * either part of the resume or it is not — so this is the only way to take a role
 * off the document, and it is irreversible. The admin UI must confirm.
 *
 * The projection is rebuilt even when nothing was deleted: it costs one indexed
 * read and one patch, and it means a repeated delete from a stale tab leaves the
 * resume correct rather than merely unchanged.
 *
 * @returns `{ entryId, deleted, revision, resume }` — `revision` is the last
 *   stored entry revision, or `null` when it was already absent.
 */
export const remove = mutation({
  args: {
    entryId: v.id('experienceEntries'),
    expectedRevision: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const row = await ctx.db.get(args.entryId);
    if (row !== null) {
      assertExpectedRevision(row.revision, args.expectedRevision);
      await ctx.db.delete(row._id);
    }

    const resume = await rebuildResumeExperience(ctx);

    return {
      entryId: args.entryId,
      deleted: row !== null,
      revision: row === null ? null : currentRevision(row.revision),
      resume: {
        synced: resume.synced,
        roles: resume.roles,
        changed: resume.changed,
        revision: resume.revision,
      },
    };
  },
});

/* ------------------------------------------------------------------ *
 * Local helpers
 * ------------------------------------------------------------------ */

/**
 * The `sortOrder` that puts a new row at the top of the resume.
 *
 * One indexed read of the lowest existing value, minus one; `0` when the table is
 * empty. See the file header for why the front rather than the back.
 */
async function frontSortOrder(ctx: QueryCtx): Promise<number> {
  const lowest = await ctx.db
    .query('experienceEntries')
    .withIndex('by_sortOrder')
    .order('asc')
    .first();

  return lowest === null ? 0 : lowest.sortOrder - 1;
}
