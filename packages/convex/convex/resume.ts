/**
 * resume.ts — the Resume Document singleton (ADR 011, ADR 012), and the one
 * function that keeps it in step with `experienceEntries`.
 *
 * ── The two-table flow. READ THIS BEFORE TOUCHING EITHER TABLE ─────────────
 *
 * The resume's work history exists twice on purpose, and `@home/types` marks the
 * pair as a DIVERGENCE (see `packages/types/src/resume.ts`):
 *
 *   experienceEntries          the normalised, admin-editable source. Machine
 *                              dates (`YYYY-MM-DD`), `skills[]`, `sortOrder`,
 *                              `projectSlugs[]`. This is what CRUD writes.
 *   resumeDocument.experience  the render-ready *projection* embedded in the
 *                              singleton. Free-form period labels (`'2022'`,
 *                              `'Present'`), exactly the text both renderers
 *                              print. No ids — see schema.ts's header for why a
 *                              `v.id()` may not appear in this model.
 *
 * So the projection is **derived, never authored**:
 *
 *     admin edits ──▶ experienceEntries.create / update / setSortOrder / remove
 *                             │
 *                             │  each one ends with rebuildResumeExperience(ctx),
 *                             │  in the same transaction as its own write
 *                             ▼
 *                     resumeDocument.experience[]
 *                             │
 *                             ├──▶ /resume                (apps/web, phase 3)
 *                             └──▶ /api/resume.pdf        (ADR 011, phase 5)
 *
 * Two consequences worth stating, because they are the whole point of the design:
 *
 *   • `upsert` below has **no `experience` argument**. There is no way to write
 *     the projection directly, from the browser admin, from iOS, or by accident.
 *     Convex rejects arguments a validator does not name, so this is enforced at
 *     the boundary rather than by convention.
 *   • The page and the PDF cannot disagree, because they read one field that one
 *     function writes. `syncFromEntries` exists for the cases where that chain
 *     was never run at all — a restore, an import, a row written before the
 *     singleton existed — and as the admin's "rebuild the resume" button.
 *
 * ── Period labels ─────────────────────────────────────────────────────────
 *
 * `periodLabel` below is the *only* place a stored date becomes printed text. It
 * renders the year (`'2022-03-01'` → `'2022'`) and `'Present'` for a null
 * `endDate`, which is exactly what `/resume` renders today from the mock in
 * `apps/web/src/lib/snapshot.ts` — so switching that page from the mock to this
 * table is a data change and not a copy change. Month precision (`'Mar 2018'`,
 * which `ResumeRoleSchema` permits) is a one-function change here if two roles in
 * the same calendar year ever make the year-only form read badly.
 *
 * ── Singleton, by convention ───────────────────────────────────────────────
 *
 * Convex has no single-document table, so `resumeDocument` is a table with one
 * row: `upsert` patches the existing row and inserts only when there is none, and
 * `get` reads newest-first rather than `.unique()` so a stray second row serves
 * the fresher document instead of throwing on every request. Same reasoning, same
 * shape, as `snapshot.get` and `siteSettings.get`.
 */

import type { WithoutSystemFields } from 'convex/server';
import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { type MutationCtx, mutation, query } from './_generated/server';
import { requireAdmin } from './lib/auth';
import { assertText, invalid } from './lib/validate';

/* ------------------------------------------------------------------ *
 * Bounds
 *
 * `ResumeDocumentSchema` bounds these fields as non-empty and nothing
 * more, so — as in posts.ts — the maxima below are storage sanity
 * bounds rather than contract bounds. They are set well above anything a
 * resume holds; their job is to keep a stuck paste from writing a
 * document that approaches Convex's 1 MB limit, where the failure would
 * be an opaque write error rather than a field-level message.
 *
 * The list *counts* are different in kind: they are layout bounds. Both
 * renderers lay this document out on a page (ADR 011), and 200
 * capabilities is not a long resume, it is a broken one.
 * ------------------------------------------------------------------ */

/** The opening paragraph. Long enough for three, short enough to stay a summary. */
const MAX_SUMMARY = 4_000;
const MAX_CAPABILITY = 200;
const MAX_CAPABILITIES = 40;
const MAX_INSTITUTION = 160;
const MAX_CREDENTIAL = 200;
/** A free-form period label — `'2011'`, `'Mar 2011'`. Not a date. */
const MAX_PERIOD_LABEL = 40;
const MAX_EDUCATION = 10;

/* ------------------------------------------------------------------ *
 * Local validators
 * ------------------------------------------------------------------ */

/**
 * One education row, as `resumeDocument.education` stores it.
 *
 * Hand-mirrored from the `resumeEducation` const in schema.ts, which is
 * module-local there rather than exported (unlike `mediaAsset` or `identity`).
 * Duplication is uncomfortable, but the failure mode is loud rather than silent:
 * Convex validates every write against the table's own schema, so an argument
 * shape that drifts from the stored shape fails the write with a schema error on
 * the first save. Promoting this to an export from schema.ts is a mechanical
 * follow-up; schema.ts was owned by another change while this file was written.
 */
const educationEntry = v.object({
  institution: v.string(),
  credential: v.string(),
  start: v.string(),
  end: v.string(),
});

/* ------------------------------------------------------------------ *
 * The projection
 * ------------------------------------------------------------------ */

/**
 * One role as the document stores it, taken from the table's own type rather
 * than re-declared — so a projection this file builds that `resumeDocument`
 * would reject is a typecheck failure here, not a runtime write error.
 */
type ProjectedRole = Doc<'resumeDocument'>['experience'][number];

/**
 * A stored `YYYY-MM-DD` as the resume prints it: the year alone.
 *
 * `.slice(0, 4)` rather than a `Date` round-trip on purpose. The stored value is
 * already a calendar label in a fixed-width format (`assertCalendarDate` in
 * experienceEntries.ts is what guarantees that), and parsing it would introduce
 * a timezone into a value that deliberately has none — `new Date('2022-01-01')`
 * is midnight UTC, which is the previous year in every timezone west of London.
 */
function periodLabel(date: string): string {
  return date.slice(0, 4);
}

/**
 * Project one source entry into the render-ready role.
 *
 * `skills` is required on `experienceEntries` and optional on the projection
 * ("Absent on older projections" — schema.ts), so an empty list is written as an
 * absent key rather than an empty array: a renderer that checks
 * `role.skills?.length` and one that checks `'skills' in role` then agree.
 */
function projectRole(entry: Doc<'experienceEntries'>): ProjectedRole {
  return {
    company: entry.company,
    title: entry.title,
    start: periodLabel(entry.startDate),
    /** `null` endDate is the current role. This is where that becomes text. */
    end: entry.endDate === null ? 'Present' : periodLabel(entry.endDate),
    summary: entry.summary,
    highlights: entry.highlights,
    ...(entry.skills.length > 0 ? { skills: entry.skills } : {}),
  };
}

/**
 * Rebuild `resumeDocument.experience` from `experienceEntries`, in `sortOrder`.
 *
 * ⚠️ **This is the coherence mechanism for the two tables, and it is exported so
 * that experienceEntries.ts can call it as the last step of every write.** A
 * plain helper rather than `ctx.runMutation(api.resume.syncFromEntries)`: Convex's
 * own docs on `runMutation` say to extract shared logic into a function instead —
 * a sub-mutation costs an isolated JS context plus argument and return validation
 * to achieve exactly this, in the same transaction it already runs in. Calling
 * this from a mutation handler means an entry write and the projection it implies
 * commit together or not at all.
 *
 * Ordering is the index's, not this function's: `by_sortOrder` ascending is the
 * order the resume prints, which is newest role first (see experienceEntries.ts
 * for why the *lowest* sortOrder is the newest role). No in-memory sort, and no
 * re-derivation from `startDate` — the admin's chosen order wins, because a
 * resume sometimes leads with the role that argues best rather than the latest.
 *
 * `.collect()` is unbounded and that is safe here: this table holds a career, not
 * a feed. If it ever held hundreds of rows the resume would already be unusable.
 *
 * @returns `{ documentId, roles, synced }`. `synced: false` with a `null`
 *   `documentId` means **there is no resume document yet, and that is not an
 *   error** — entries may legitimately be authored before the singleton exists,
 *   and failing an entry write here would impose an ordering on the admin that
 *   nothing else in the model implies. `upsert` builds the projection itself when
 *   it creates the row, so nothing is lost by the no-op.
 */
export async function rebuildResumeExperience(ctx: MutationCtx): Promise<{
  documentId: Doc<'resumeDocument'>['_id'] | null;
  roles: number;
  synced: boolean;
}> {
  const experience = await projectExperience(ctx);
  const document = await ctx.db.query('resumeDocument').order('desc').first();

  if (document === null) {
    return { documentId: null, roles: experience.length, synced: false };
  }

  await ctx.db.patch(document._id, { experience });
  return { documentId: document._id, roles: experience.length, synced: true };
}

/** The projection as an array, without writing it. Used by `upsert`'s insert path. */
async function projectExperience(ctx: MutationCtx): Promise<ProjectedRole[]> {
  const entries = await ctx.db
    .query('experienceEntries')
    .withIndex('by_sortOrder')
    .order('asc')
    .collect();

  return entries.map(projectRole);
}

/* ------------------------------------------------------------------ *
 * Read
 * ------------------------------------------------------------------ */

/**
 * The Resume Document, or `null` if it has never been written.
 *
 * **Public.** Every field on this row is printed on `/resume`, which is a page
 * whose entire purpose is being read by strangers, so there is nothing here to
 * withhold. Public also means the page and the phase-5 PDF route
 * (`/api/resume.pdf`, ADR 011) can both read it from an anonymous Convex client —
 * no authenticated provider on a public route, which is the JS budget
 * `ConvexClientProvider`'s docblock in apps/web is protecting.
 *
 * `null` is a real state, not an edge case: a fresh deployment has no resume
 * until the first `upsert`. Callers render their static fallback rather than
 * throwing — the same contract as `snapshot.get` and `siteSettings.get`. The PDF
 * route in particular must 404 rather than emit an empty document.
 *
 * @returns `Doc<'resumeDocument'> | null`
 */
export const get = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query('resumeDocument').order('desc').first();
  },
});

/* ------------------------------------------------------------------ *
 * Write
 * ------------------------------------------------------------------ */

/**
 * Create or replace the Resume Document. Admin-only.
 *
 * A whole-record write rather than a field-by-field patch, for the same reason as
 * `siteSettings.upsert`: the admin resume form renders every field on one screen
 * and submits all of them, and with optional fields "the caller omitted
 * `capabilities`" and "the caller wants `capabilities` unchanged" would be the
 * same request.
 *
 * **`experience` is not an argument.** It is rebuilt from `experienceEntries`
 * as part of this write — see the file header. That means saving the resume form
 * also repairs a projection that had drifted, and that a caller cannot write a
 * work history the source table does not agree with.
 *
 * @returns `{ documentId, created, roles }` — `roles` is how many entries the
 *   projection was built from, so the admin UI can say "3 roles" without a second
 *   read, and can notice a zero.
 */
export const upsert = mutation({
  args: {
    summary: v.string(),
    capabilities: v.array(v.string()),
    education: v.array(educationEntry),
    embedGitStats: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    /* ---- formats @home/types enforces and Convex cannot -------------- */

    assertText(args.summary, 'summary', MAX_SUMMARY);

    const capabilities = normaliseCapabilities(args.capabilities);

    if (args.education.length > MAX_EDUCATION) {
      invalid({
        code: 'out-of-range',
        field: 'education',
        message: `A resume may list at most ${MAX_EDUCATION} education entries (got ${args.education.length}).`,
      });
    }

    const education = args.education.map((row, index) => {
      const field = `education[${index}]`;
      assertText(row.institution, `${field}.institution`, MAX_INSTITUTION);
      assertText(row.credential, `${field}.credential`, MAX_CREDENTIAL);
      // Free-form labels, printed verbatim — `'2011'`, `'Mar 2011'`, `'Present'`.
      // Deliberately NOT calendar dates: education periods on a resume are
      // written the way a human writes them, and some of them predate records
      // precise enough to be a date at all.
      assertText(row.start, `${field}.start`, MAX_PERIOD_LABEL);
      assertText(row.end, `${field}.end`, MAX_PERIOD_LABEL);

      return {
        institution: row.institution.trim(),
        credential: row.credential.trim(),
        start: row.start.trim(),
        end: row.end.trim(),
      };
    });

    /* ---- write ------------------------------------------------------- */

    const experience = await projectExperience(ctx);
    const existing = await ctx.db.query('resumeDocument').order('desc').first();

    // Annotated with the table's own document type, so a field this file writes
    // that the schema does not describe — or vice versa — is a typecheck failure
    // here rather than a rejected write at runtime.
    const row: WithoutSystemFields<Doc<'resumeDocument'>> = {
      summary: args.summary.trim(),
      experience,
      capabilities,
      education,
      embedGitStats: args.embedGitStats,
    };

    // PHASE 4 — knowledge indexing (ADR 015). The resume is one of the four
    // `knowledgeDocs.sourceType` values, and the only singleton among them
    // (`sourceSlug: null` — schema.ts says why). Editing it changes text Ask
    // Corey may already have embedded, so this is the hook, scheduled rather than
    // inline because embedding needs `fetch` and a mutation cannot:
    //   await ctx.scheduler.runAfter(0, internal.knowledge.indexResume, {});
    // The upsert key is (`sourceType: 'resume'`, `sourceSlug: null`) via the
    // `by_source` index.

    if (existing !== null) {
      await ctx.db.patch(existing._id, row);
      return { documentId: existing._id, created: false, roles: experience.length };
    }

    const documentId = await ctx.db.insert('resumeDocument', row);
    return { documentId, created: true, roles: experience.length };
  },
});

/**
 * Rebuild the experience projection from `experienceEntries`. Admin-only.
 *
 * The admin's "rebuild the resume" button, and the repair path for the cases the
 * automatic rebuild cannot cover: rows imported straight into the table, a
 * restored backup, entries authored before the singleton existed, or a projection
 * edited by hand in the Convex dashboard. In normal operation this mutation
 * should never change anything, because every write in experienceEntries.ts has
 * already called the same helper — see the file header.
 *
 * It writes nothing but `experience`; `summary`, `capabilities`, `education` and
 * `embedGitStats` are authored content and are untouched.
 *
 * @returns `{ documentId, roles, synced }` — `synced: false` means there is no
 *   resume document to sync into, which is a successful no-op rather than an
 *   error (see `rebuildResumeExperience`). The admin UI should read that as "save
 *   the resume first", not as a failure.
 */
export const syncFromEntries = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    // PHASE 4 — knowledge indexing (ADR 015). Same hook as `upsert`: the
    // projection is the resume's work-history prose, so a rebuild that changes it
    // invalidates the embedded copy.
    //   if (result.synced) {
    //     await ctx.scheduler.runAfter(0, internal.knowledge.indexResume, {});
    //   }

    return await rebuildResumeExperience(ctx);
  },
});

/* ------------------------------------------------------------------ *
 * Local helpers
 * ------------------------------------------------------------------ */

/**
 * Trim, drop blanks, de-duplicate case-insensitively, preserve order.
 *
 * A blank entry is dropped rather than rejected because the admin form submits a
 * line-per-capability textarea and a trailing newline is a typing artefact, not
 * something worth failing a save over. An over-long one IS rejected: that is
 * someone putting a paragraph in a list field, and silently truncating a printed
 * document would be worse than refusing it. Same reasoning, same shape, as
 * `normaliseTags` in posts.ts.
 */
function normaliseCapabilities(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of values) {
    const value = raw.trim();
    if (value.length === 0) continue;
    if (value.length > MAX_CAPABILITY) {
      invalid({
        code: 'out-of-range',
        field: 'capabilities',
        message: `Each capability must be ${MAX_CAPABILITY} characters or fewer (got ${value.length}).`,
      });
    }
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }

  if (out.length > MAX_CAPABILITIES) {
    invalid({
      code: 'out-of-range',
      field: 'capabilities',
      message: `A resume may list at most ${MAX_CAPABILITIES} capabilities (got ${out.length}).`,
    });
  }

  return out;
}
