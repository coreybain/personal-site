/**
 * projects.ts — the Case Study table: read, write, order, publish.
 *
 * A **Case Study** (glossary) is client/employer work: always attributed, always
 * sanitised, never repo-linked (ADR 008 — which is why `links` below has no
 * `repo` key and never will). These are the rows `/work`, `/work/[slug]` and the
 * dashboard's featured tiles render, and they are the most persuasive thing on
 * the site, so the write path here is deliberately stricter than the schema.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  ADR 009 PUBLISH GATE — `publish` REFUSES A ROW WITH UNSANITISED MEDIA.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Case-study imagery is real screenshots of client software. Sanitisation —
 * scrubbing customer data and identifiers — is manual per-image work (ADR 009,
 * build phase 8), and `mediaAsset.sanitised` is the flag that records it having
 * been done. That flag exists *for this gate*: without an assertion somewhere,
 * it is a boolean nobody reads, and the failure mode it guards against is
 * publishing a client's customer records to a public URL.
 *
 * So the gate is enforced in exactly two places, and both are in this file:
 *
 *   1. `publish` — asserts every entry in `media` has `sanitised === true`
 *      before `published` flips on, and the error names the offending assets so
 *      the admin UI can point at the right thumbnail.
 *   2. `update` — asserts the same thing when `media` is replaced on a row that
 *      is *already* published. Gating only `publish` would leave the obvious
 *      bypass wide open: publish a clean row, then edit unsanitised screenshots
 *      into it.
 *
 * `published` is therefore NOT a writable field on `create` or `update`. There
 * is one way for it to become `true` — the `publish` mutation — and that is what
 * makes the gate a gate rather than a convention.
 *
 * ── What is NOT here ──────────────────────────────────────────────────────
 *
 *   • Knowledge re-indexing. Publishing a case study should re-index it for Ask
 *     Corey (ADR 015); that is phase 6, and the hook is a
 *     `ctx.scheduler.runAfter(0, internal.knowledge.reindexProject, …)` in
 *     `publish`/`unpublish`/`remove`. Deliberately absent rather than stubbed —
 *     `knowledgeDocs` rows are derived and always safe to rebuild, so a project
 *     published before that code exists needs no migration.
 *   • UploadThing deletion. `remove` drops the row and orphans the CDN copies
 *     its `media[].storageKey`s point at (ADR 010). A mutation cannot `fetch`,
 *     so reaching UploadThing has to be a scheduled action; until it exists,
 *     orphaned files cost storage and leak nothing.
 */

import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import { requireAdmin } from './lib/auth';
import {
  assertRange,
  assertSlugUnique,
  assertText,
  assertUrl,
  invalid,
} from './lib/validate';
import { aiBuildStats, mediaAsset } from './schema';

/* ------------------------------------------------------------------ *
 * Validators the schema does not export
 *
 * `projects.links` is declared inline in schema.ts and has no exported
 * name, and this file may not edit schema.ts. It is therefore mirrored
 * here, field for field: a link kind added there must be added here or
 * it becomes a field the admin form cannot write.
 * ------------------------------------------------------------------ */

/** Mirrors `projects.links` in schema.ts / `ProjectLinksSchema`. No `repo` — ADR 008. */
const projectLinks = v.object({
  live: v.optional(v.string()),
  press: v.optional(v.string()),
});

/* ------------------------------------------------------------------ *
 * Bounds — hand-mirrored from `ProjectSchema` in @home/types
 *
 * Zod's `.max()` has no Convex equivalent (see lib/validate.ts's
 * header), so these are the mirror. Where `ProjectSchema` states only
 * `NonEmptyStringSchema`, the ceiling below is this file's own: an
 * admin-only form does not need protecting from a hostile caller, but a
 * 40 KB `title` pasted by accident is a broken page rather than a long
 * one, and the number tells the admin UI what to set `maxLength` to.
 * ------------------------------------------------------------------ */

const MAX_TITLE = 160;
const MAX_CLIENT = 160;
const MAX_ATTRIBUTION = 200;
const MAX_ROLE = 120;
const MAX_PERIOD = 60;
/** Card copy and the meta description. Google truncates long past this anyway. */
const MAX_SUMMARY = 400;
/** `problem` / `approach` — "2–3 sentences" per the schema, generously. */
const MAX_NARRATIVE = 4_000;
const MAX_OUTCOME = 280;
const MAX_OUTCOMES = 12;
/** Markdown overflow. Long-form is expected; a book is not. */
const MAX_BODY = 40_000;
const MAX_STACK_ITEM = 60;
const MAX_STACK = 40;
/** A CSS colour, e.g. `'hsl(212 88% 58%)'`. */
const MAX_ACCENT = 64;
const MAX_MEDIA = 24;
const MAX_ALT = 300;
const MAX_CAPTION = 300;
const MAX_STORAGE_KEY = 256;
/** Intrinsic pixel dimension ceiling — a sanity bound, not a format rule. */
const MAX_PIXELS = 20_000;
/** Sanity ceilings on `aiBuildStats`, which catch a units mistake (ms for hours). */
const MAX_AI_SESSIONS = 100_000;
const MAX_AI_HOURS = 100_000;

/* ------------------------------------------------------------------ *
 * Field types
 * ------------------------------------------------------------------ */

/**
 * The document body — every field a mutation may write, derived from the
 * generated data model rather than re-typed, so a schema change that this file
 * has not caught up with is a typecheck failure here.
 */
type ProjectFields = Omit<Doc<'projects'>, '_id' | '_creationTime'>;

/** One media asset as stored. Same shape as `mediaAsset` in schema.ts. */
type ProjectMedia = ProjectFields['media'][number];

/**
 * A patch: every writable field, all optional, minus `published`.
 *
 * `published` is excluded at the type level so that a future edit to `update`
 * cannot quietly start writing it and route around the ADR 009 gate — see the
 * file header. `publish` and `unpublish` are the only writers of that field.
 */
type ProjectPatch = Partial<Omit<ProjectFields, 'published'>>;

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

/**
 * Assert one media asset is well-formed.
 *
 * Note what is NOT checked: `sanitised`. It is a workflow flag, valid in all
 * three of its states (`true`, `false`, absent) on an unpublished row, and it is
 * asserted by the publish gate instead. A draft is exactly where an unsanitised
 * screenshot is supposed to live.
 *
 * @param field - dotted path for the error payload, e.g. `'media[2]'`, so the
 *   admin form can highlight the offending thumbnail rather than the whole
 *   uploader.
 */
function assertMediaAsset(asset: ProjectMedia, field: string): void {
  // The scheme allowlist inside `assertUrl` is what stops a `javascript:` URL
  // reaching an `<img src>` on the public site.
  assertUrl(asset.url, `${field}.url`);
  // Required by `MediaAssetSchema`: an unlabelled image is an accessibility
  // defect, and every image on this site is described.
  assertText(asset.alt, `${field}.alt`, MAX_ALT);

  if (asset.caption !== undefined && asset.caption.length > MAX_CAPTION) {
    invalid({
      code: 'out-of-range',
      field: `${field}.caption`,
      message: `caption must be ${MAX_CAPTION} characters or fewer.`,
    });
  }
  // Dimensions are what let the grid reserve space and hold the CLS budget, so
  // a zero is worse than an absent value: it renders as a collapsed box.
  if (asset.width !== undefined) {
    assertRange(asset.width, `${field}.width`, 1, MAX_PIXELS);
  }
  if (asset.height !== undefined) {
    assertRange(asset.height, `${field}.height`, 1, MAX_PIXELS);
  }
  if (asset.storageKey !== undefined) {
    assertText(asset.storageKey, `${field}.storageKey`, MAX_STORAGE_KEY);
  }
}

/**
 * Assert every field present in `fields` satisfies `ProjectSchema`'s formats.
 *
 * Takes a partial on purpose: `create` passes the whole document and `update`
 * passes only the keys it was given, and both want identical rules. A field
 * absent from the object is a field this call says nothing about.
 *
 * `slug` is not checked here — it is validated by `assertSlugUnique`, which
 * needs the database, and doing it in one place keeps "is it a slug" and "is it
 * taken" from being asked separately.
 */
function assertProjectFields(fields: Partial<ProjectFields>): void {
  if (fields.title !== undefined) assertText(fields.title, 'title', MAX_TITLE);
  if (fields.client !== undefined) assertText(fields.client, 'client', MAX_CLIENT);
  if (fields.attribution !== undefined) {
    // Required by the glossary rule, not just by the schema: attribution is the
    // credit line, and a Case Study without one misrepresents ownership.
    assertText(fields.attribution, 'attribution', MAX_ATTRIBUTION);
  }
  if (fields.role !== undefined) assertText(fields.role, 'role', MAX_ROLE);
  if (fields.period !== undefined) assertText(fields.period, 'period', MAX_PERIOD);
  if (fields.summary !== undefined) assertText(fields.summary, 'summary', MAX_SUMMARY);
  if (fields.problem !== undefined) {
    assertText(fields.problem, 'problem', MAX_NARRATIVE);
  }
  if (fields.approach !== undefined) {
    assertText(fields.approach, 'approach', MAX_NARRATIVE);
  }

  if (fields.outcomes !== undefined) {
    if (fields.outcomes.length > MAX_OUTCOMES) {
      invalid({
        code: 'out-of-range',
        field: 'outcomes',
        message: `A case study may list at most ${MAX_OUTCOMES} outcomes (got ${fields.outcomes.length}).`,
      });
    }
    // Rendered as a list, never a paragraph — so a blank line is a visible gap
    // in the list rather than invisible whitespace.
    fields.outcomes.forEach((line, index) => {
      assertText(line, `outcomes[${index}]`, MAX_OUTCOME);
    });
  }

  // `body` is `z.string()`, not `NonEmptyStringSchema`: an empty body is the
  // normal state (the trio above is the primary narrative), so it is bounded
  // but not required to contain anything.
  if (fields.body !== undefined && fields.body.length > MAX_BODY) {
    invalid({
      code: 'out-of-range',
      field: 'body',
      message: `body must be ${MAX_BODY} characters or fewer (got ${fields.body.length}).`,
    });
  }

  if (fields.stack !== undefined) {
    if (fields.stack.length > MAX_STACK) {
      invalid({
        code: 'out-of-range',
        field: 'stack',
        message: `stack may hold at most ${MAX_STACK} entries (got ${fields.stack.length}).`,
      });
    }
    fields.stack.forEach((item, index) => {
      assertText(item, `stack[${index}]`, MAX_STACK_ITEM);
    });
  }

  if (fields.media !== undefined) {
    if (fields.media.length > MAX_MEDIA) {
      invalid({
        code: 'out-of-range',
        field: 'media',
        message: `media may hold at most ${MAX_MEDIA} assets (got ${fields.media.length}).`,
      });
    }
    fields.media.forEach((asset, index) => {
      assertMediaAsset(asset, `media[${index}]`);
    });
  }

  if (fields.links !== undefined) {
    if (fields.links.live !== undefined) {
      assertUrl(fields.links.live, 'links.live');
    }
    if (fields.links.press !== undefined) {
      assertUrl(fields.links.press, 'links.press');
    }
  }

  // Design tokens, and required (see `ProjectSchema`'s DIVERGENCE note): the
  // variants derive gradients from them and the procedural placeholder art
  // depends on them, so a blank accent is a broken card, not a plain one.
  if (fields.accent !== undefined) assertText(fields.accent, 'accent', MAX_ACCENT);
  if (fields.accentHue !== undefined) {
    // `HueSchema`: an HSL hue angle in degrees.
    assertRange(fields.accentHue, 'accentHue', 0, 360);
  }

  if (fields.aiBuildStats !== undefined) {
    assertRange(
      fields.aiBuildStats.sessions,
      'aiBuildStats.sessions',
      0,
      MAX_AI_SESSIONS,
    );
    assertRange(fields.aiBuildStats.hours, 'aiBuildStats.hours', 0, MAX_AI_HOURS);
  }

  if (fields.sortOrder !== undefined && !Number.isInteger(fields.sortOrder)) {
    // `SortOrderSchema` is `z.int()`. A fractional weight sorts correctly and
    // then breaks the first time `setSortOrder` renumbers densely, which is a
    // confusing way to lose an ordering.
    invalid({
      code: 'invalid-format',
      field: 'sortOrder',
      message: `sortOrder must be a whole number (got ${fields.sortOrder}).`,
    });
  }
}

/**
 * THE ADR 009 GATE. Throw unless every asset in `media` is sanitised.
 *
 * The error names each offending asset — index, alt text, and the UploadThing
 * key or URL — because the admin UI's job on failure is to say *which*
 * screenshot still needs work, and "publish failed" without that is a puzzle.
 *
 * ⚠️ An empty `media` array passes, because `every`-style checks over nothing
 * are vacuously true. That is accepted rather than overlooked: a case study with
 * no imagery renders the procedural placeholder art (see `accent`/`accentHue`),
 * and a publish path that demanded a screenshot would block the exact
 * intermediate state ADR 009's manual sanitisation work creates. The gate's job
 * is "nothing unsanitised goes public", not "everything has a picture".
 */
function assertSanitisedMedia(slug: string, media: readonly ProjectMedia[]): void {
  const offenders = media
    .map((asset, index) => ({ asset, index }))
    .filter(({ asset }) => asset.sanitised !== true);

  if (offenders.length === 0) return;

  const named = offenders
    .map(
      ({ asset, index }) =>
        `#${index + 1} ${JSON.stringify(asset.alt)} (${asset.storageKey ?? asset.url})`,
    )
    .join('; ');

  invalid({
    code: 'precondition-failed',
    field: 'media',
    message:
      `Cannot publish "${slug}": ADR 009 requires every case-study screenshot to be ` +
      `sanitised first. ${offenders.length} of ${media.length} ${offenders.length === 1 ? 'asset is' : 'assets are'} ` +
      `not marked sanitised — ${named}.`,
  });
}

/* ------------------------------------------------------------------ *
 * Read
 * ------------------------------------------------------------------ */

/**
 * Case studies in display order.
 *
 * Public by default: published rows only, ascending `sortOrder`, straight off
 * `by_published_sortOrder`. Pass `includeDrafts: true` for the admin listing,
 * which reads `by_sortOrder` instead — that index exists precisely because a
 * Convex index is only usable from its leading field, so
 * `by_published_sortOrder` cannot serve "both states, in one ordered read".
 *
 * `includeDrafts` is an explicit argument rather than an implicit
 * `isAdmin(ctx)` check, and the difference matters: with the implicit form,
 * `/work` would silently gain draft rows for the one signed-in visitor, so the
 * only person who could not see the site as the public sees it would be its
 * author. It also keeps this query's result a pure function of its arguments,
 * which is what makes it cacheable at the page level.
 *
 * @param limit - a ceiling, not pagination. The default is far above the
 *   plausible number of case studies; if this table ever needs paging, that is a
 *   `paginate()` and a different signature, not a bigger number.
 * @returns `Array<Doc<'projects'>>` — whole documents, unshaped, per the package
 *   convention (see snapshot.ts).
 */
export const list = query({
  args: {
    includeDrafts: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 200, 1), 500);

    if (args.includeDrafts === true) {
      await requireAdmin(ctx);
      return await ctx.db.query('projects').withIndex('by_sortOrder').take(limit);
    }

    return await ctx.db
      .query('projects')
      .withIndex('by_published_sortOrder', (q) => q.eq('published', true))
      .take(limit);
  },
});

/**
 * Published + featured case studies, in display order. Public.
 *
 * The dashboard's hero row (ADR 003) and the section's featured strip. Served by
 * `by_published_featured`, which is why that index exists — the alternative is
 * scanning every row to test a boolean, and `labs` reaches its equivalent the
 * same way, deliberately.
 *
 * The index orders by `featured`, not by `sortOrder`, so the handful of matching
 * rows are sorted in memory afterwards. That is a real trade and it is the right
 * one at this size: an index on `['published', 'featured', 'sortOrder']` would
 * be a fourth index on the table to save a sort of six items.
 *
 * Note this returns *eligible* rows. `siteSettings.featured.projectSlugs` is the
 * curated order and slot count for the dashboard grid (see that field's note in
 * schema.ts); a caller rendering the fixed-dimension grid should intersect the
 * two rather than trust either alone.
 */
export const listFeatured = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 12, 1), 50);

    const rows = await ctx.db
      .query('projects')
      .withIndex('by_published_featured', (q) =>
        q.eq('published', true).eq('featured', true),
      )
      .collect();

    return rows.sort((a, b) => a.sortOrder - b.sortOrder).slice(0, limit);
  },
});

/**
 * One case study by slug, or `null`.
 *
 * The single read behind `/work/[slug]`. `null` covers both "no such row" and
 * "that row is a draft and you are not signed in", which is what the page wants:
 * a draft URL must 404 for the public exactly as a nonexistent one does, and
 * telling the two apart would leak the existence of unpublished work.
 *
 * Deliberately does NOT assert the slug's format. A malformed slug cannot match
 * any row, so it returns `null` and the route renders its 404 — whereas throwing
 * would turn a mistyped URL into a 500.
 *
 * @param includeDrafts - admin-only, and checked before the row is read so the
 *   failure is "sign in", not "not found". This is how the admin editor and the
 *   draft preview load a row that `/work/[slug]` cannot see.
 */
export const getBySlug = query({
  args: {
    slug: v.string(),
    includeDrafts: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    if (args.includeDrafts === true) await requireAdmin(ctx);

    const row = await ctx.db
      .query('projects')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug))
      .first();

    if (row === null) return null;
    if (!row.published && args.includeDrafts !== true) return null;

    return row;
  },
});

/* ------------------------------------------------------------------ *
 * Write
 * ------------------------------------------------------------------ */

/**
 * Create a case study. Admin-only. **Always a draft.**
 *
 * There is no `published` argument: a new row is inserted with
 * `published: false` and reaches the public site only through `publish`, which
 * is where the ADR 009 gate lives. Accepting the flag here would mean two
 * publish paths and one gate.
 *
 * @param sortOrder - omitted, the row goes last (highest existing weight + 1),
 *   which is what "I just added this" means. `setSortOrder` renumbers the whole
 *   collection densely afterwards.
 * @param featured - omitted, `false`. Marking a draft featured is allowed and
 *   does nothing until it is published — `listFeatured` filters on both.
 *
 * @returns `{ projectId, slug, sortOrder }` — enough for the admin UI to
 *   navigate straight to the row it just made.
 */
export const create = mutation({
  args: {
    slug: v.string(),
    title: v.string(),

    client: v.string(),
    attribution: v.string(),
    role: v.string(),
    period: v.optional(v.string()),

    summary: v.string(),
    problem: v.optional(v.string()),
    approach: v.optional(v.string()),
    outcomes: v.optional(v.array(v.string())),
    body: v.optional(v.string()),

    stack: v.array(v.string()),
    media: v.array(mediaAsset),
    links: projectLinks,
    accent: v.string(),
    accentHue: v.number(),

    aiBuildStats: v.optional(aiBuildStats),

    featured: v.optional(v.boolean()),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    // Format + uniqueness in one call. Slugs are the join key for the whole
    // system and are never reused — see `assertSlugUnique`.
    await assertSlugUnique(ctx.db, 'projects', args.slug);

    // Last position + 1. `by_sortOrder` descending gives the current maximum in
    // one indexed read rather than a scan.
    const last = await ctx.db
      .query('projects')
      .withIndex('by_sortOrder')
      .order('desc')
      .first();

    const fields: ProjectFields = {
      published: false,
      featured: args.featured ?? false,
      sortOrder: args.sortOrder ?? (last === null ? 0 : last.sortOrder + 1),

      slug: args.slug,
      title: args.title.trim(),

      client: args.client.trim(),
      attribution: args.attribution.trim(),
      role: args.role.trim(),
      ...(args.period !== undefined ? { period: args.period.trim() } : {}),

      summary: args.summary.trim(),
      ...(args.problem !== undefined ? { problem: args.problem.trim() } : {}),
      ...(args.approach !== undefined ? { approach: args.approach.trim() } : {}),
      ...(args.outcomes !== undefined
        ? { outcomes: args.outcomes.map((line) => line.trim()) }
        : {}),
      ...(args.body !== undefined ? { body: args.body } : {}),

      stack: args.stack.map((item) => item.trim()),
      media: args.media,
      links: args.links,
      accent: args.accent.trim(),
      accentHue: args.accentHue,

      ...(args.aiBuildStats !== undefined ? { aiBuildStats: args.aiBuildStats } : {}),
    };

    assertProjectFields(fields);

    const projectId = await ctx.db.insert('projects', fields);

    return { projectId, slug: fields.slug, sortOrder: fields.sortOrder };
  },
});

/**
 * Edit a case study. Admin-only. Patch semantics.
 *
 * Only the fields present in the arguments are written; an omitted field is left
 * exactly as it was. Two consequences worth stating, because they are the usual
 * source of surprise in a patch API:
 *
 *   • **Clearing an optional field is `null`, not omission.** `period`,
 *     `problem`, `approach`, `outcomes`, `body` and `aiBuildStats` accept `null`
 *     to mean "remove this field", which the handler translates into the
 *     `undefined` that `ctx.db.patch` deletes with. Without that, "leave it
 *     alone" and "empty it" would be the same request.
 *   • **Arrays and objects are replaced whole, not merged.** Passing `media`
 *     replaces the entire array; passing `links: {}` clears both links. There is
 *     no per-item patch, because the admin form always holds the full list and a
 *     merge would make removal impossible.
 *
 * `published` is not an argument — see the file header.
 *
 * ⚠️ Renaming `slug` is allowed and is not free: it orphans every inbound link,
 * every `knowledgeDocs.sourceSlug` citing it, and any
 * `siteSettings.featured.projectSlugs` entry naming it. The admin UI should
 * treat it as a destructive action.
 *
 * @returns `{ projectId, slug }` — the slug as stored, which may be the new one.
 */
export const update = mutation({
  args: {
    projectId: v.id('projects'),

    slug: v.optional(v.string()),
    title: v.optional(v.string()),

    client: v.optional(v.string()),
    attribution: v.optional(v.string()),
    role: v.optional(v.string()),
    /** `null` clears. */
    period: v.optional(v.union(v.string(), v.null())),

    summary: v.optional(v.string()),
    /** `null` clears. */
    problem: v.optional(v.union(v.string(), v.null())),
    /** `null` clears. */
    approach: v.optional(v.union(v.string(), v.null())),
    /** `null` clears. */
    outcomes: v.optional(v.union(v.array(v.string()), v.null())),
    /** `null` clears. */
    body: v.optional(v.union(v.string(), v.null())),

    stack: v.optional(v.array(v.string())),
    media: v.optional(v.array(mediaAsset)),
    links: v.optional(projectLinks),
    accent: v.optional(v.string()),
    accentHue: v.optional(v.number()),

    /** `null` clears — the row predates agent-assisted work (ADR 016). */
    aiBuildStats: v.optional(v.union(aiBuildStats, v.null())),

    featured: v.optional(v.boolean()),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const row = await ctx.db.get(args.projectId);
    if (row === null) {
      invalid({
        code: 'not-found',
        field: 'projectId',
        message: 'That case study no longer exists.',
      });
    }

    const patch: ProjectPatch = {};

    if (args.slug !== undefined && args.slug !== row.slug) {
      await assertSlugUnique(ctx.db, 'projects', args.slug, row._id);
      patch.slug = args.slug;
    }

    if (args.title !== undefined) patch.title = args.title.trim();
    if (args.client !== undefined) patch.client = args.client.trim();
    if (args.attribution !== undefined) patch.attribution = args.attribution.trim();
    if (args.role !== undefined) patch.role = args.role.trim();
    if (args.period !== undefined) {
      patch.period = args.period === null ? undefined : args.period.trim();
    }

    if (args.summary !== undefined) patch.summary = args.summary.trim();
    if (args.problem !== undefined) {
      patch.problem = args.problem === null ? undefined : args.problem.trim();
    }
    if (args.approach !== undefined) {
      patch.approach = args.approach === null ? undefined : args.approach.trim();
    }
    if (args.outcomes !== undefined) {
      patch.outcomes =
        args.outcomes === null ? undefined : args.outcomes.map((line) => line.trim());
    }
    if (args.body !== undefined) {
      patch.body = args.body === null ? undefined : args.body;
    }

    if (args.stack !== undefined) patch.stack = args.stack.map((item) => item.trim());
    if (args.media !== undefined) patch.media = args.media;
    if (args.links !== undefined) patch.links = args.links;
    if (args.accent !== undefined) patch.accent = args.accent.trim();
    if (args.accentHue !== undefined) patch.accentHue = args.accentHue;

    if (args.aiBuildStats !== undefined) {
      patch.aiBuildStats = args.aiBuildStats === null ? undefined : args.aiBuildStats;
    }

    if (args.featured !== undefined) patch.featured = args.featured;
    if (args.sortOrder !== undefined) patch.sortOrder = args.sortOrder;

    assertProjectFields(patch);

    // THE ADR 009 GATE, second half. Replacing the media of a row that is
    // already public must satisfy the same rule `publish` enforced, or the gate
    // is one edit deep. Only checked when `media` is actually being replaced:
    // an already-published row cannot be holding unsanitised assets, and
    // re-asserting on every unrelated edit would make a published row
    // un-editable if it somehow were.
    if (row.published && patch.media !== undefined) {
      assertSanitisedMedia(patch.slug ?? row.slug, patch.media);
    }

    // A form that submits no changes should not produce a write.
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(row._id, patch);
    }

    return { projectId: row._id, slug: patch.slug ?? row.slug };
  },
});

/**
 * Publish a case study. **This is the ADR 009 gate.**
 *
 * Refuses unless every asset in `media` carries `sanitised: true`, and the error
 * names the ones that do not — see `assertSanitisedMedia`, including why an
 * empty `media` array is allowed through.
 *
 * Idempotent: publishing an already-published row still runs the gate (cheap,
 * and it means a stale tab cannot report success for a row that would now fail)
 * and reports `alreadyPublished`.
 *
 * Phase 6 adds a knowledge re-index here — see the file header.
 *
 * @returns `{ projectId, slug, published: true, alreadyPublished }`
 */
export const publish = mutation({
  args: { projectId: v.id('projects') },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const row = await ctx.db.get(args.projectId);
    if (row === null) {
      invalid({
        code: 'not-found',
        field: 'projectId',
        message: 'That case study no longer exists.',
      });
    }

    assertSanitisedMedia(row.slug, row.media);

    if (row.published) {
      return {
        projectId: row._id,
        slug: row.slug,
        published: true as const,
        alreadyPublished: true,
      };
    }

    await ctx.db.patch(row._id, { published: true });

    return {
      projectId: row._id,
      slug: row.slug,
      published: true as const,
      alreadyPublished: false,
    };
  },
});

/**
 * Withdraw a case study from the public site. Admin-only.
 *
 * No gate — taking something down is always allowed, immediately. The row keeps
 * its `featured` flag and `sortOrder` so re-publishing restores it to where it
 * was, and `listFeatured` already filters on `published` so an unpublished
 * featured row disappears from the dashboard in the same tick.
 *
 * @returns `{ projectId, slug, published: false, alreadyUnpublished }`
 */
export const unpublish = mutation({
  args: { projectId: v.id('projects') },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const row = await ctx.db.get(args.projectId);
    if (row === null) {
      invalid({
        code: 'not-found',
        field: 'projectId',
        message: 'That case study no longer exists.',
      });
    }

    if (!row.published) {
      return {
        projectId: row._id,
        slug: row.slug,
        published: false as const,
        alreadyUnpublished: true,
      };
    }

    await ctx.db.patch(row._id, { published: false });

    return {
      projectId: row._id,
      slug: row.slug,
      published: false as const,
      alreadyUnpublished: false,
    };
  },
});

/**
 * Toggle the `featured` flag on its own. Admin-only.
 *
 * `update` can do this too; this exists because the admin listing wants a
 * one-tap star per row and should not have to submit a form to set one boolean.
 * The mirror of `labs.setFeatured` — both sections feed the same dashboard grid,
 * and it would be a trap for one of them to have the affordance and the other
 * not.
 *
 * Featuring a draft is allowed and takes effect when it is published.
 *
 * @returns `{ projectId, featured }` — as stored, for optimistic-update
 *   reconciliation.
 */
export const setFeatured = mutation({
  args: {
    projectId: v.id('projects'),
    featured: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const row = await ctx.db.get(args.projectId);
    if (row === null) {
      invalid({
        code: 'not-found',
        field: 'projectId',
        message: 'That case study no longer exists.',
      });
    }

    if (row.featured !== args.featured) {
      await ctx.db.patch(row._id, { featured: args.featured });
    }

    return { projectId: row._id, featured: args.featured };
  },
});

/**
 * Renumber the whole collection from a display order. Admin-only.
 *
 * Takes **every** case study, in the order they should appear, and writes dense
 * weights `0, 1, 2, …`. That is the shape a drag-and-drop list produces, and
 * renumbering densely is what keeps the weights from drifting into fractions or
 * leaving gaps that a later insert falls into.
 *
 * Completeness is required rather than convenient: writing positional weights
 * for a subset would collide with the rows left out, so a partial list has no
 * correct interpretation. The admin listing already holds every row (`list` is
 * not paginated), so it always has the full set to send.
 *
 * Rows whose weight is already correct are skipped — reordering two items in a
 * list of thirty is two writes, not thirty.
 *
 * @param projectIds - every project `_id`, in display order.
 * @returns `{ count, changed }` — rows considered, and rows actually written.
 */
export const setSortOrder = mutation({
  args: { projectIds: v.array(v.id('projects')) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const requested = new Set<Id<'projects'>>(args.projectIds);
    if (requested.size !== args.projectIds.length) {
      invalid({
        code: 'invalid-format',
        field: 'projectIds',
        message: 'projectIds contains the same case study more than once.',
      });
    }

    const rows = await ctx.db.query('projects').withIndex('by_sortOrder').collect();

    const missing = rows.filter((row) => !requested.has(row._id));
    if (missing.length > 0 || args.projectIds.length !== rows.length) {
      invalid({
        code: 'precondition-failed',
        field: 'projectIds',
        message:
          `setSortOrder needs every case study, in display order: got ${args.projectIds.length} of ${rows.length}` +
          (missing.length > 0
            ? `, missing ${missing.map((row) => row.slug).join(', ')}`
            : '') +
          '.',
      });
    }

    const byId = new Map(rows.map((row) => [row._id, row]));
    let changed = 0;

    for (const [index, projectId] of args.projectIds.entries()) {
      const row = byId.get(projectId);
      // Unreachable: the counts matched and there are no duplicates, so every
      // requested id is one of `rows`. Guarded rather than asserted because a
      // non-null assertion here would be the one line hiding a real bug.
      if (row === undefined) continue;
      if (row.sortOrder === index) continue;

      await ctx.db.patch(row._id, { sortOrder: index });
      changed += 1;
    }

    return { count: rows.length, changed };
  },
});

/**
 * Delete a case study for good. Admin-only.
 *
 * Idempotent — a double-click or a stale tab both mean the caller got what it
 * wanted. Irreversible, so the admin UI must confirm; `unpublish` is the
 * reversible way to take something off the site.
 *
 * Two loose ends this deliberately leaves, both noted in the file header: the
 * UploadThing files behind `media[].storageKey` are orphaned, and any
 * `knowledgeDocs` rows citing this slug survive until phase 6's re-index prunes
 * them (they are derived and filtered on `published`, so they are safe).
 * `siteSettings.featured.projectSlugs` may also still name the deleted slug,
 * which readers already treat as "not featured yet" — see `siteSettings.upsert`.
 *
 * @returns `{ projectId, deleted }`
 */
export const remove = mutation({
  args: { projectId: v.id('projects') },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const row = await ctx.db.get(args.projectId);
    if (row === null) {
      return { projectId: args.projectId, deleted: false };
    }

    await ctx.db.delete(row._id);
    return { projectId: args.projectId, deleted: true };
  },
});
