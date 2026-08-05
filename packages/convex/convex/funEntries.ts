/**
 * funEntries.ts — the /fun feed: beer, coffee, walks, pubs.
 *
 * Three things make this table unlike every other content table in the package,
 * and all three are visible in the surface below.
 *
 * ── 1. There is no `published` flag, so there is no publish mutation ────────
 *
 * `funEntries` carries no `publishableShape` (schema.ts), which means an entry is
 * public the moment it is created — `list` below is a plain public read with no
 * `isAdmin` branch, because there are no drafts to hide. That is a deliberate
 * property of the content rather than an omission: a Fun Entry is a photo and a
 * sentence captured on a phone, and a draft state would be a review step on
 * something that has nothing to review. The gate is `requireAdmin` on the write,
 * which is the only gate this data needs.
 *
 * ── 2. `photo` is required, and that is the point of the table ──────────────
 *
 * The plan says it outright: `funEntries` and `labs` carry imagery as required
 * fields because they are the site's main source of images beyond the case
 * studies, which is what answers the "not interactive enough with images"
 * complaint about the previous site. So `photo` is a required argument on
 * `create` (Convex rejects the call without it) and can be replaced but never
 * cleared by `update`. An entry with no photo is not a degraded entry, it is a
 * hole in the /fun grid.
 *
 * ── 3. The four kinds are a discriminated union Convex cannot express ───────
 *
 * `FunEntrySchema` in `@home/types` is a `z.discriminatedUnion` on `type`:
 * beer/coffee/pub require a `note`, and only `walk` carries `steps` and `km`.
 * A Convex table has one flat shape, so schema.ts stores those four fields as
 * optional and says the implication is "enforced by the Zod discriminated union
 * and by the mutation". `assertKind` below IS that mutation-side enforcement —
 * it is the only thing stopping a `beer` row with a step count, or a `walk` with
 * no distance, from reaching a /fun page that renders per-kind metrics.
 *
 * This is also why `update` writes with `replace` rather than `patch`: the
 * invariant is a property of the whole row, not of any one field. See its
 * docblock.
 */

import type { WithoutSystemFields } from 'convex/server';
import { type Infer, v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { mutation, query, type MutationCtx } from './_generated/server';
import { requireAdmin } from './lib/auth';
import {
  assertExpectedRevision,
  currentRevision,
  nextRevision,
} from './lib/revision';
import { assertRange, assertText, assertUrl, invalid } from './lib/validate';
import { funEntryType, mediaAsset } from './schema';

/* ------------------------------------------------------------------ *
 * Bounds
 *
 * `rating` (1–5, integer), `steps` (`CountSchema`: non-negative
 * integer) and the coordinate ranges are real contract bounds, mirrored
 * from `@home/types`. The string maxima are storage sanity bounds — the
 * Zod schema only requires those fields to be non-empty — and exist so
 * a runaway paste fails with a field-level message instead of a document
 * that approaches Convex's 1 MB limit.
 * ------------------------------------------------------------------ */

const MAX_TITLE = 160;
/** A caption, not a blog post. The blog is what `posts` is for. */
const MAX_NOTE = 2_000;
const MAX_LOCATION_NAME = 160;
const MAX_SUBURB = 120;
const MAX_ALT = 400;
const MAX_CAPTION = 500;
const MAX_PIXELS = 20_000;

/** `CountSchema`. ~24h of continuous walking; above this is a unit mix-up. */
const MAX_STEPS = 250_000;
/** Kilometres. An ultramarathon fits; a GPS glitch does not. */
const MAX_KM = 1_000;

/** Default page size for the /fun grid. */
const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 300;

/**
 * How far ahead of the server clock an `occurredAt` may sit, in milliseconds.
 *
 * A Fun Entry records something that happened. A future timestamp would sort to
 * the top of `by_occurredAt` and become the Snapshot's `latestFunEntry` — i.e.
 * the compatibility Snapshot signal would advertise a beer nobody has had yet. The
 * window is a day rather than zero because the phone's clock and its timezone
 * handling are both outside this backend's control, and rejecting a genuine
 * same-evening capture over a few hours of skew would be worse than allowing it.
 */
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ *
 * Local validators
 * ------------------------------------------------------------------ */

/**
 * Where an entry happened. **Mirrors the private `funLocation` validator in
 * schema.ts**, which is not exported.
 *
 * Duplicated rather than exported-and-imported because schema.ts was owned by
 * another change while this file was written; the honest fix is to export it
 * there and delete this. What keeps the copy from silently drifting in the
 * meantime is that every write below assembles a `WithoutSystemFields<Doc<
 * 'funEntries'>>` — so a field the table requires and this validator omits is a
 * typecheck failure in this file, not a rejected write in production.
 */
const funLocation = v.object({
  /** Venue or route name, e.g. `'The Old Fitz'`, `'Bay Run'`. */
  name: v.string(),
  /** Suburb / locality, e.g. `'Pyrmont'`. */
  suburb: v.optional(v.string()),
  latitude: v.optional(v.number()),
  longitude: v.optional(v.number()),
});

/** The stored media shape, derived from schema.ts's exported validator. */
type MediaAsset = Infer<typeof mediaAsset>;
type FunLocation = Infer<typeof funLocation>;
/** A whole entry as the table stores it, minus `_id` / `_creationTime`. */
type StoredFunEntry = WithoutSystemFields<Doc<'funEntries'>>;

/** Keep the compatibility Snapshot projection in the same transaction. */
async function refreshLatestFunEntry(ctx: MutationCtx): Promise<void> {
  const latest = await ctx.db
    .query('funEntries')
    .withIndex('by_occurredAt')
    .order('desc')
    .first();
  const latestValue: StoredFunEntry | null = (() => {
    if (latest === null) return null;
    const { _id: _id, _creationTime: _creationTime, ...entry } = latest;
    return entry;
  })();
  const snapshots = await ctx.db.query('snapshot').collect();

  for (const snapshot of snapshots) {
    await ctx.db.patch(snapshot._id, { latestFunEntry: latestValue });
  }
}

/**
 * Assert an uploaded asset is renderable. Mirrors `MediaAssetSchema`.
 *
 * ⚠️ Identical to `assertMedia` in posts.ts, and belongs in lib/validate.ts —
 * see the note there. Kept local for the same reason (parallel phase-2 work);
 * promoting it is a mechanical follow-up.
 *
 * The `url` check is the load-bearing one: `assertUrl` permits only `http(s)`,
 * which is what stops a `javascript:` payload reaching the `src` of an image the
 * public /fun grid renders. `sanitised` is not checked — the ADR 009 gate is
 * about client screenshots in `projects.media`, and a photo of a beer is not
 * client work, which is why the field is optional on the shared validator.
 */
function assertMedia(asset: MediaAsset, field: string): void {
  assertUrl(asset.url, `${field}.url`);
  assertText(asset.alt, `${field}.alt`, MAX_ALT);

  // A caption may legitimately be empty (`z.string()`, not non-empty).
  if (asset.caption !== undefined && asset.caption.length > MAX_CAPTION) {
    invalid({
      code: 'out-of-range',
      field: `${field}.caption`,
      message: `${field}.caption must be ${MAX_CAPTION} characters or fewer.`,
    });
  }

  for (const [name, value] of [
    ['width', asset.width],
    ['height', asset.height],
  ] as const) {
    if (value === undefined) continue;
    assertRange(value, `${field}.${name}`, 1, MAX_PIXELS);
    if (!Number.isInteger(value)) {
      invalid({
        code: 'invalid-format',
        field: `${field}.${name}`,
        message: `${field}.${name} must be a whole number of pixels.`,
      });
    }
  }
}

/** Assert a location is nameable and, where present, plottable. `FunLocationSchema`. */
function assertLocation(location: FunLocation): void {
  assertText(location.name, 'location.name', MAX_LOCATION_NAME);

  if (location.suburb !== undefined) {
    assertText(location.suburb, 'location.suburb', MAX_SUBURB);
  }

  // Real contract bounds (`z.number().min(-90).max(90)`), and load-bearing: the
  // /fun and /contact map treatments plot these, and an out-of-range pair puts a
  // pin somewhere the projection cannot draw.
  if (location.latitude !== undefined) {
    assertRange(location.latitude, 'location.latitude', -90, 90);
  }
  if (location.longitude !== undefined) {
    assertRange(location.longitude, 'location.longitude', -180, 180);
  }

  // One coordinate on its own is not a point. Almost certainly a form that lost
  // half a paste, and storing it would put a marker on the equator or the
  // prime meridian.
  if ((location.latitude === undefined) !== (location.longitude === undefined)) {
    invalid({
      code: 'precondition-failed',
      field: 'location',
      message: 'latitude and longitude must be given together, or not at all.',
    });
  }
}

/**
 * Normalise an instant to the RFC 3339 UTC string the schema stores.
 *
 * ⚠️ The conversion is the point of this function, not the validation.
 *
 * The phone captures Fun Entries in Sydney, so the natural thing for a client to
 * send is `2026-07-30T19:04:00+10:00`. That is a valid RFC 3339 instant and
 * `@home/types` accepts it — but stored as-is it would break `by_occurredAt`,
 * because that index's chronological ordering rests entirely on these strings
 * being fixed-width UTC (schema.ts's header explains why). `'2026-07-30T19:04+10:00'`
 * sorts *after* `'2026-07-30T12:00:00Z'` lexicographically while happening
 * *before* it, which would silently mis-order the /fun grid and could hand the
 * Snapshot the wrong `latestFunEntry`. So every instant is round-tripped through
 * `Date` and re-emitted as `…Z` with milliseconds.
 *
 * `Date.parse` is deliberately not treated as a format check on its own — it
 * accepts plenty that RFC 3339 does not — which is why the year is bounded
 * afterwards: outside 1970–9999 `toISOString()` switches to the expanded
 * `±YYYYYY` form and stops being fixed-width.
 */
function normaliseInstant(value: string, field: string): string {
  const ms = Date.parse(value);

  if (Number.isNaN(ms)) {
    invalid({
      code: 'invalid-format',
      field,
      message: `${field} must be an RFC 3339 timestamp (got ${JSON.stringify(value)}).`,
    });
  }

  // 0 is 1970-01-01T00:00:00Z. Before the epoch is a typo, not a memory.
  if (ms < 0 || ms > Date.parse('9999-12-31T23:59:59Z')) {
    invalid({
      code: 'out-of-range',
      field,
      message: `${field} must fall between 1970 and 9999 (got ${JSON.stringify(value)}).`,
    });
  }

  if (ms > Date.now() + MAX_CLOCK_SKEW_MS) {
    invalid({
      code: 'out-of-range',
      field,
      message: `${field} is in the future — a Fun Entry records something that has happened.`,
    });
  }

  return new Date(ms).toISOString();
}

/**
 * Assert the per-kind invariants of `FunEntrySchema`'s discriminated union.
 *
 * Takes the whole row, because that is the only level at which the rule exists:
 * `steps` is required on a walk and forbidden on a beer, so no field can be
 * checked without knowing `type`. Both halves matter —
 *
 *   • the *required* half stops a walk rendering on /fun with an empty metric
 *     row, and
 *   • the *forbidden* half stops a stale `steps` surviving a walk→beer edit,
 *     which is the failure `update`'s use of `replace` is designed around. A
 *     beer row carrying a step count would be a row `@home/types` cannot parse,
 *     and the iOS client parses through the generated `Codable` structs.
 */
function assertKind(entry: StoredFunEntry): void {
  assertText(entry.title, 'title', MAX_TITLE);

  if (entry.rating !== undefined) {
    // `z.int().min(1).max(5)` — a contract bound. Out of five, and no half stars.
    assertRange(entry.rating, 'rating', 1, 5);
    if (!Number.isInteger(entry.rating)) {
      invalid({
        code: 'invalid-format',
        field: 'rating',
        message: 'rating must be a whole number from 1 to 5.',
      });
    }
  }

  if (entry.type === 'walk') {
    if (entry.steps === undefined || entry.km === undefined) {
      invalid({
        code: 'precondition-failed',
        field: entry.steps === undefined ? 'steps' : 'km',
        message: 'A walk must carry both steps and km — they arrive with it from HealthKit.',
      });
    }
    assertRange(entry.steps, 'steps', 0, MAX_STEPS);
    if (!Number.isInteger(entry.steps)) {
      invalid({
        code: 'invalid-format',
        field: 'steps',
        message: 'steps must be a whole number.',
      });
    }
    // `NonNegativeNumberSchema` — fractional kilometres are the norm.
    assertRange(entry.km, 'km', 0, MAX_KM);

    // Optional on a walk, overriding the base shape: the distance is the point.
    if (entry.note !== undefined) {
      assertText(entry.note, 'note', MAX_NOTE);
    }
    return;
  }

  // beer | coffee | pub — `note` is required by `funEntryBaseShape`, and it is
  // the entry's whole editorial content. A photo with no sentence is a photo.
  if (entry.note === undefined) {
    invalid({
      code: 'precondition-failed',
      field: 'note',
      message: `A ${entry.type} entry needs a note.`,
    });
  }
  assertText(entry.note, 'note', MAX_NOTE);

  if (entry.steps !== undefined || entry.km !== undefined) {
    invalid({
      code: 'precondition-failed',
      field: entry.steps !== undefined ? 'steps' : 'km',
      message: `steps and km belong to a walk, not to a ${entry.type} entry.`,
    });
  }
}

/**
 * Resolve one optional field of a patch. **Absent ⇒ unchanged, `null` ⇒ cleared.**
 *
 * `v.optional(x)` alone cannot express "remove this field": an omitted argument
 * and a cleared one look identical. So every clearable field on `update` is
 * `v.optional(v.union(x, v.null()))`, and this collapses the three cases to the
 * two the document has. It is how a rating comes off an entry, or a walk loses a
 * note.
 */
function resolveOptional<T>(
  arg: T | null | undefined,
  current: T | undefined,
): T | undefined {
  if (arg === undefined) return current;
  if (arg === null) return undefined;
  return arg;
}

/**
 * Trim an optional string on the way *in*; a blank one is stored as absent.
 *
 * A required field would use `assertText` and reject `'   '`. `note` is optional
 * on a walk, so the meaningful reading of a blank note is "there is no note"
 * rather than "the save is invalid" — and storing whitespace would render as an
 * empty caption under the photo.
 */
function optionalText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Trim an optional string on the way *through a patch*; a blank one means clear it.
 *
 * The difference from `optionalText` is the blank case, and it is the difference
 * between the two call sites: on `create` a blank field was never filled in, but
 * on `update` a blank field is a textarea the admin just emptied, which is a
 * request to remove the note. Returning `null` routes that through
 * `resolveOptional`'s clear path instead of its unchanged path.
 */
function patchText(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/* ------------------------------------------------------------------ *
 * Read
 * ------------------------------------------------------------------ */

/**
 * Fun Entries, newest first. **Public** — there are no drafts here (file header).
 *
 * Both branches are indexed reads, and both get their ordering from the index
 * rather than from a sort in this function: `occurredAt` is a fixed-width UTC ISO
 * string, so descending index order *is* reverse-chronological order. That is the
 * property `normaliseInstant` exists to protect on the write side.
 *
 * @param type - optional kind filter, exactly the `beer | coffee | walk | pub`
 *   union the column stores (the validator is schema.ts's, so the filter and the
 *   field cannot drift). Passed, the read goes through `by_type_occurredAt`;
 *   omitted, through `by_occurredAt`. Two indexes rather than one because a
 *   Convex index is only usable from its leading field.
 * @param limit - page size, clamped to 1–300, default 60.
 * @returns `Array<Doc<'funEntries'>>` — whole documents, unshaped, per the
 *   package convention (see snapshot.ts). The web layer narrows the four kinds on
 *   read; see the DIVERGENCE note on `FunEntrySchema`.
 */
export const list = query({
  args: {
    type: v.optional(funEntryType),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

    if (args.type !== undefined) {
      const type = args.type;
      return await ctx.db
        .query('funEntries')
        .withIndex('by_type_occurredAt', (q) => q.eq('type', type))
        .order('desc')
        .take(limit);
    }

    return await ctx.db
      .query('funEntries')
      .withIndex('by_occurredAt')
      .order('desc')
      .take(limit);
  },
});

/** Every entry, newest first, for native administrative CRUD. */
export const listAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.db
      .query('funEntries')
      .withIndex('by_occurredAt')
      .order('desc')
      .collect();
  },
});

/**
 * One entry by id, or `null`. **Public.**
 *
 * By id rather than by slug because `funEntries` has no slug — an entry has no
 * page of its own, so it needs no URL; /fun is a grid, and the admin editor
 * addresses a row it already listed. This is the one content table in the package
 * with no `getBySlug`, and the absence is the schema's, not an oversight.
 *
 * @returns `Doc<'funEntries'> | null`
 */
export const get = query({
  args: { entryId: v.id('funEntries') },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.entryId);
  },
});

/* ------------------------------------------------------------------ *
 * Write
 * ------------------------------------------------------------------ */

/**
 * Create a Fun Entry. Admin-only.
 *
 * `photo` and `occurredAt` are required arguments; `note` is required in effect
 * for beer/coffee/pub and `steps`/`km` for walks, enforced by `assertKind`
 * because Convex cannot express a conditional requirement in a validator.
 *
 * `occurredAt` is the caller's — the phone knows when the photo was taken and the
 * upload may be hours or days later, which is exactly why the schema stores "when
 * it happened" and not `_creationTime`. It is normalised to UTC on the way in;
 * see `normaliseInstant`.
 *
 * @returns `{ entryId, type, occurredAt, revision, created }` — `occurredAt` as *stored*, i.e. after
 *   UTC normalisation, so the client renders the same instant the index sorted on
 *   rather than the offset string it sent.
 */
export const create = mutation({
  args: {
    type: funEntryType,
    title: v.string(),
    photo: mediaAsset,
    note: v.optional(v.string()),
    rating: v.optional(v.number()),
    location: v.optional(funLocation),
    steps: v.optional(v.number()),
    km: v.optional(v.number()),
    occurredAt: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    assertMedia(args.photo, 'photo');
    if (args.location !== undefined) assertLocation(args.location);

    // Assembled as the table's own document type, so a field this file writes
    // that the schema does not describe — or a required field it forgets — is a
    // typecheck failure here rather than a rejected write at runtime. This is
    // also what keeps the local `funLocation` copy above honest.
    const row: StoredFunEntry = {
      revision: 1,
      type: args.type,
      title: args.title.trim(),
      photo: args.photo,
      note: optionalText(args.note),
      rating: args.rating,
      location: args.location,
      steps: args.steps,
      km: args.km,
      occurredAt: normaliseInstant(args.occurredAt, 'occurredAt'),
    };

    // Whole-row check: the per-kind rules cannot be evaluated field by field.
    assertKind(row);

    const entryId = await ctx.db.insert('funEntries', row);
    await refreshLatestFunEntry(ctx);

    // The same transaction refreshes the Snapshot copy so the homepage never
    // advertises a stale or deleted latest entry between hourly rebuilds.

    return {
      entryId,
      type: row.type,
      occurredAt: row.occurredAt,
      revision: 1 as const,
      created: true,
    };
  },
});

/**
 * Update a Fun Entry. Admin-only. Absent ⇒ unchanged, `null` ⇒ cleared.
 *
 * ⚠️ **This writes with `replace`, not `patch`, and that is deliberate.**
 *
 * Everywhere else in this package an update is a `ctx.db.patch` of just the
 * fields that were passed. Here the row is a discriminated union flattened into
 * one table, so a field-by-field patch has a hole in it: changing `type` from
 * `'walk'` to `'beer'` leaves `steps` and `km` behind, and the result is a row
 * that `FunEntrySchema` cannot parse and that the iOS client's generated
 * `Codable` structs would fail to decode. Merging first, validating the merged
 * row with `assertKind`, and writing the whole thing makes that state
 * unreachable: the fields a kind does not own are cleared as part of the same
 * write that changes the kind.
 *
 * The other direction cannot be automatic, and does not try to be — a change
 * *into* `walk` must supply `steps` and `km` in the same call, and a change into
 * beer/coffee/pub must supply a `note` if the entry has none, because there is no
 * value this mutation could invent. Both fail as `precondition-failed` naming the
 * missing field.
 *
 * `photo` can be replaced but not cleared (no `null` in its validator) — see the
 * file header for why the photo is the table.
 *
 * @returns `{ entryId, type, occurredAt, changed, revision }` — `changed` is false when the
 *   call passed nothing but an id, which is a successful no-op rather than an
 *   error.
 */
export const update = mutation({
  args: {
    entryId: v.id('funEntries'),
    expectedRevision: v.optional(v.number()),
    type: v.optional(funEntryType),
    title: v.optional(v.string()),
    photo: v.optional(mediaAsset),
    note: v.optional(v.union(v.string(), v.null())),
    rating: v.optional(v.union(v.number(), v.null())),
    location: v.optional(v.union(funLocation, v.null())),
    steps: v.optional(v.union(v.number(), v.null())),
    km: v.optional(v.union(v.number(), v.null())),
    occurredAt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const row = await ctx.db.get(args.entryId);
    if (row === null) {
      invalid({
        code: 'not-found',
        field: 'entryId',
        message: 'That entry no longer exists.',
      });
    }

    assertExpectedRevision(row.revision, args.expectedRevision);

    const {
      entryId: _entryId,
      expectedRevision: _expectedRevision,
      ...fields
    } = args;
    const passedNothing = Object.values(fields).every((value) => value === undefined);
    if (passedNothing) {
      return {
        entryId: row._id,
        type: row.type,
        occurredAt: row.occurredAt,
        changed: false,
        revision: currentRevision(row.revision),
      };
    }

    if (args.photo !== undefined) assertMedia(args.photo, 'photo');
    if (args.location !== undefined && args.location !== null) {
      assertLocation(args.location);
    }

    const type = args.type ?? row.type;
    const isWalk = type === 'walk';

    const merged: StoredFunEntry = {
      revision: nextRevision(row.revision),
      type,
      title: args.title !== undefined ? args.title.trim() : row.title,
      photo: args.photo ?? row.photo,
      note: resolveOptional(patchText(args.note), row.note),
      rating: resolveOptional(args.rating, row.rating),
      location: resolveOptional(args.location, row.location),
      // The walk metrics are carried forward only while the entry IS a walk. A
      // kind change away from `walk` therefore drops them in the same write that
      // changes the kind, rather than failing the save on fields the caller had
      // no reason to know it needed to clear. Passing `steps` or `km` explicitly
      // on a non-walk still fails in `assertKind`, because that is a client bug
      // and not an edit.
      steps: resolveOptional(args.steps, isWalk ? row.steps : undefined),
      km: resolveOptional(args.km, isWalk ? row.km : undefined),
      occurredAt:
        args.occurredAt !== undefined
          ? normaliseInstant(args.occurredAt, 'occurredAt')
          : row.occurredAt,
    };

    assertKind(merged);

    await ctx.db.replace(row._id, merged);
    await refreshLatestFunEntry(ctx);

    // Snapshot refresh is transactional with the source edit; see `create`.

    return {
      entryId: row._id,
      type: merged.type,
      occurredAt: merged.occurredAt,
      changed: true,
      revision: currentRevision(merged.revision),
    };
  },
});

/**
 * Delete a Fun Entry. Admin-only.
 *
 * Idempotent — deleting a row that is already gone reports `deleted: false` and
 * succeeds, because the likely cause is a double-click or a stale tab and both
 * mean the caller got what it wanted. Same contract as `contactMessages.remove`
 * and `posts.remove`.
 *
 * There is no soft delete, and unlike `posts` there is no `unpublish` to reach
 * for instead: an entry has no URL of its own to break (see `get`), so removing
 * one costs nothing but the row.
 *
 * @returns `{ entryId, deleted, revision }` — `revision` is the last stored
 *   revision, or `null` when the row was already absent.
 */
export const remove = mutation({
  args: {
    entryId: v.id('funEntries'),
    expectedRevision: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const row = await ctx.db.get(args.entryId);
    if (row === null) {
      return { entryId: args.entryId, deleted: false, revision: null };
    }

    assertExpectedRevision(row.revision, args.expectedRevision);
    const revision = currentRevision(row.revision);
    await ctx.db.delete(row._id);
    await refreshLatestFunEntry(ctx);

    // Snapshot refresh is transactional with the source delete; see `create`.
    //
    // UploadThing (ADR 010) is separate: the CDN object outlives the row, and
    // reaping it needs `photo.storageKey` and an action that can call
    // UploadThing's delete API. Phase 2's UploadThing work owns that decision;
    // nothing here should assume the file is gone.

    return { entryId: args.entryId, deleted: true, revision };
  },
});
