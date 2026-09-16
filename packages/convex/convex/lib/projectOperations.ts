/** Shared case-study writes. Human and machine adapters authorize before calling. */
import { type Infer, v } from 'convex/values';
import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { assertExpectedRevision, currentRevision, nextRevision } from './revision';
import { assertRange, assertSlugUnique, assertText, assertUrl, invalid } from './validate';
import { aiBuildStats, mediaAsset } from '../schema';

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
  // public case-study art derives gradients from them and the procedural art
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
  if (fields.sortOrder !== undefined) {
    assertRange(fields.sortOrder, 'sortOrder', 0, 1_000_000_000);
    if (!Number.isSafeInteger(fields.sortOrder)) {
      invalid({
        code: 'invalid-format',
        field: 'sortOrder',
        message: 'sortOrder must be a whole number.',
      });
    }
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

export const projectCreateFields = {
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
};
export const projectPatchFields = {

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
};
// Editorial staging excludes publication, placement and collector-owned statistics.
const { aiBuildStats: _createStats, featured: _createFeatured, sortOrder: _createOrder, ...editorialCreate } = projectCreateFields;
const { aiBuildStats: _patchStats, featured: _patchFeatured, sortOrder: _patchOrder, ...editorialPatch } = projectPatchFields;
export const projectEditorialFields = editorialCreate;
export const projectEditorialPatchFields = editorialPatch;
const projectEditorial = v.object(projectEditorialFields);
export type ProjectContent = Infer<typeof projectEditorial>;

const projectCreate = v.object(projectCreateFields);
const projectPatch = v.object(projectPatchFields);
export type ProjectCreate = Infer<typeof projectCreate>;
export type ProjectUpdate = Infer<typeof projectPatch>;
type ExistingProjectArgs = { projectId: Id<'projects'>; expectedRevision?: number };

/** Validate a private edit; callers applying it live enforce the sanitisation gate. */
export async function prepareProjectPatch(
  ctx: MutationCtx,
  row: { _id: Id<'projects'>; slug: string },
  args: ProjectUpdate,
): Promise<ProjectPatch> {
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

  return patch;
}

export async function createProject(ctx: MutationCtx, args: ProjectCreate) {
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
    revision: 1,
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

  return {
    projectId,
    slug: fields.slug,
    sortOrder: fields.sortOrder,
    revision: 1 as const,
    created: true,
  };
}

export async function updateProject(ctx: MutationCtx, args: ExistingProjectArgs & ProjectUpdate) {
  const row = await ctx.db.get(args.projectId);
  if (row === null) {
    invalid({
      code: 'not-found',
      field: 'projectId',
      message: 'That case study no longer exists.',
    });
  }

  assertExpectedRevision(row.revision, args.expectedRevision);

  const patch = await prepareProjectPatch(ctx, row, args);

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
  const changed = Object.keys(patch).length > 0;
  const revision = changed ? nextRevision(row.revision) : currentRevision(row.revision);
  if (changed) {
    patch.revision = revision;
    await ctx.db.patch(row._id, patch);
  }

  // PHASE 4 — knowledge indexing (ADR 015). Editing a published case study
  // changes text `knowledgeDocs` is already holding. The rename half is NOT
  // gated on `published`: the old slug's document is orphaned either way (the
  // ⚠️ above), and an orphan is the one stale index entry re-indexing the
  // source cannot repair, because there is no source left under that key.
  if (patch.slug !== undefined) {
    await ctx.scheduler.runAfter(0, internal.knowledge.removeSource, {
      sourceType: 'project',
      sourceSlug: row.slug,
    });
  }

  // Only the fields `knowledge.sourceForIndex` reads. `media`, `links`,
  // `accent`, `accentHue`, `aiBuildStats`, `featured` and `sortOrder` are
  // excluded there — a reorder or a star must not cost an embedding call to
  // write an identical string back.
  const INDEXED_FIELDS = [
    'slug',
    'title',
    'client',
    'attribution',
    'role',
    'period',
    'summary',
    'problem',
    'approach',
    'outcomes',
    'body',
    'stack',
  ] as const;

  if (row.published && INDEXED_FIELDS.some((field) => field in patch)) {
    await ctx.scheduler.runAfter(0, internal.knowledge.indexSource, {
      sourceType: 'project',
      sourceSlug: patch.slug ?? row.slug,
    });
  }

  return {
    projectId: row._id,
    slug: patch.slug ?? row.slug,
    revision,
    changed,
  };
}

export async function publishProject(ctx: MutationCtx, args: ExistingProjectArgs) {
  const row = await ctx.db.get(args.projectId);
  if (row === null) {
    invalid({
      code: 'not-found',
      field: 'projectId',
      message: 'That case study no longer exists.',
    });
  }

  assertExpectedRevision(row.revision, args.expectedRevision);
  assertSanitisedMedia(row.slug, row.media);

  if (row.published) {
    return {
      projectId: row._id,
      slug: row.slug,
      published: true as const,
      alreadyPublished: true,
      changed: false,
      revision: currentRevision(row.revision),
    };
  }

  const revision = nextRevision(row.revision);
  await ctx.db.patch(row._id, { published: true, revision });

  // PHASE 4 — knowledge indexing (ADR 015). Scheduled rather than inline
  // because embedding needs `fetch`; `runAfter(0, …)` is part of this
  // transaction, so a publish rolled back by the gate above — or by anything
  // else — never schedules the job. See the file header.
  await ctx.scheduler.runAfter(0, internal.knowledge.indexSource, {
    sourceType: 'project',
    sourceSlug: row.slug,
  });

  return {
    projectId: row._id,
    slug: row.slug,
    published: true as const,
    alreadyPublished: false,
    changed: true,
    revision,
  };
}

export async function unpublishProject(ctx: MutationCtx, args: ExistingProjectArgs) {
  const row = await ctx.db.get(args.projectId);
  if (row === null) {
    invalid({
      code: 'not-found',
      field: 'projectId',
      message: 'That case study no longer exists.',
    });
  }

  assertExpectedRevision(row.revision, args.expectedRevision);
  if (!row.published) {
    return {
      projectId: row._id,
      slug: row.slug,
      published: false as const,
      alreadyUnpublished: true,
      changed: false,
      revision: currentRevision(row.revision),
    };
  }

  const revision = nextRevision(row.revision);
  await ctx.db.patch(row._id, { published: false, revision });

  // PHASE 4 — knowledge indexing (ADR 015). A flag patch, not a delete: the
  // text and its vector stay put for the moment this is published again, and
  // `knowledgeDocs.published` is the retrieval filter that makes the row
  // unreachable meanwhile. No embedding call, so this is the internal
  // mutation rather than the action.
  await ctx.scheduler.runAfter(0, internal.knowledge.setSourcePublished, {
    sourceType: 'project',
    sourceSlug: row.slug,
    published: false,
  });

  return {
    projectId: row._id,
    slug: row.slug,
    published: false as const,
    alreadyUnpublished: false,
    changed: true,
    revision,
  };
}

export async function removeProject(ctx: MutationCtx, args: ExistingProjectArgs) {
  const row = await ctx.db.get(args.projectId);
  if (row === null) {
    return { projectId: args.projectId, deleted: false, revision: null };
  }

  assertExpectedRevision(row.revision, args.expectedRevision);
  const revision = currentRevision(row.revision);
  const staged = await ctx.db.query('managementProjectDrafts')
    .withIndex('by_projectId', (q) => q.eq('projectId', row._id)).unique();
  if (staged) await ctx.db.delete(staged._id);
  await ctx.db.delete(row._id);

  // PHASE 4 — knowledge indexing (ADR 015). An orphaned `knowledgeDocs` row is
  // the one stale index entry re-indexing cannot repair — there is no source
  // left to read — so it is deleted outright via `by_source`.
  await ctx.scheduler.runAfter(0, internal.knowledge.removeSource, {
    sourceType: 'project',
    sourceSlug: row.slug,
  });

  return { projectId: args.projectId, deleted: true, revision };
}
