/**
 * siteSettings.ts — read and write the singleton that holds the site's chrome.
 *
 * Everything here changes without a deploy: the hero headline, the availability
 * line, who the site says it is about, which entries sit on the dashboard, and
 * which nav items exist at all. It is the record the phone edits.
 *
 * ── Singleton, by convention ───────────────────────────────────────────────
 *
 * Convex has no notion of a single-document table, so `siteSettings` is a table
 * with one row and the invariant lives in `upsert` below: it patches the existing
 * row and only inserts when there is none. `get` reads newest-first rather than
 * `.unique()` so that if a second row ever appears (a botched restore, two
 * concurrent first-writes), the site serves the fresher one instead of throwing
 * on every request. Same reasoning as `snapshot.get` — see snapshot.ts.
 *
 * ── `availability` is stored twice, and this file is why that is safe ──────
 *
 * `siteSettings.availability` and `siteSettings.identity.availability` are the
 * same string. The duplication is inherited (schema.ts and `SiteSettingsSchema`
 * both explain it: the implemented web shape reads it from `identity`, the plan
 * puts it at the top level), and the resolution is that **the mutations in this
 * file are the only writers, and they always write both from one input**. There
 * is no argument that can set them apart, so no reader can observe them
 * disagreeing. Collapse the field when apps/web stops reading
 * `snapshot.identity`; until then, do not add a writer that touches only one.
 *
 * `snapshot.identity` is a denormalised homepage copy. Both writers below patch
 * that copy in the same transaction, so an iPhone edit is visible everywhere
 * immediately instead of waiting for the hourly full Snapshot rebuild.
 */

import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { mutation, query, type MutationCtx } from './_generated/server';
import { requireAdmin } from './lib/auth';
import {
  assertExpectedRevision,
  currentRevision,
  nextRevision,
} from './lib/revision';
import {
  assertEmail,
  assertSlug,
  assertText,
  assertUrl,
  invalid,
  nowIso,
} from './lib/validate';
import { featuredSelections, identity, navVisibility } from './schema';

/** Committed public fallback, mirrored from apps/web/src/lib/snapshot.ts. */
const FALLBACK_IDENTITY = {
  name: 'Corey Baines',
  role: 'Principal Engineer',
  company: 'Corporate Interactive',
  location: 'Sydney, Australia',
  availability: 'Open to Principal Engineer roles',
  github: 'coreybain',
  linkedin: 'https://www.linkedin.com/in/coreybaines/',
  x: 'https://x.com/coreybaines',
  email: 'corey@spiritdevs.com',
} satisfies Doc<'snapshot'>['identity'];

/** Keep the homepage identity copy current in the settings transaction. */
async function refreshSnapshotIdentity(
  ctx: MutationCtx,
  value: Doc<'siteSettings'>['identity'],
): Promise<void> {
  const snapshots = await ctx.db.query('snapshot').collect();
  for (const snapshot of snapshots) {
    await ctx.db.patch(snapshot._id, { identity: value });
  }
}

/* ------------------------------------------------------------------ *
 * Read
 * ------------------------------------------------------------------ */

/**
 * The site settings, or `null` if they have never been written.
 *
 * **Public.** Every field on this row is already rendered on the public site —
 * the headline, the availability line, the socials, the nav — so there is
 * nothing here to withhold, and making it public is what lets the layout read it
 * without dragging an authenticated client onto public routes (see the docblock
 * on apps/web ConvexClientProvider for why that budget matters).
 *
 * `null` is a real state, not an edge case: a fresh deployment has no settings
 * row until the first `upsert`. Callers render their static defaults rather than
 * throwing — the same contract as `snapshot.get`.
 *
 * @returns `Doc<'siteSettings'> | null`
 */
export const get = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query('siteSettings').order('desc').first();
  },
});

/* ------------------------------------------------------------------ *
 * Write
 * ------------------------------------------------------------------ */

/**
 * Create or replace the settings row. Admin-only.
 *
 * A whole-record write rather than a field-by-field patch: the admin settings
 * form renders every field on one screen and submits all of them, and a partial
 * upsert would need each field to be optional — at which point "the caller
 * omitted `nav`" and "the caller wants `nav` unchanged" become the same request.
 * `setAvailability` below exists for the one field that genuinely needs editing
 * on its own.
 *
 * Note the absent `availability` argument. It is derived from
 * `identity.availability` and written to both places — see the file header.
 *
 * Slugs in `featured` are format-checked but NOT existence-checked. That is
 * deliberate: the dashboard is curated ahead of the content (a slug can be
 * pencilled in before the case study is written), and the readers already treat a
 * slug that resolves to nothing as "not featured yet". An existence check here
 * would make the settings form fail on a perfectly reasonable intermediate state.
 *
 * @returns `{ settingsId, updatedAt, created, changed, revision }`
 */
export const upsert = mutation({
  args: {
    expectedRevision: v.optional(v.number()),
    headline: v.string(),
    availabilityVisible: v.boolean(),
    identity,
    featured: featuredSelections,
    nav: navVisibility,
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    /* ---- formats @home/types enforces and Convex cannot -------------- */

    assertText(args.headline, 'headline', 180);

    assertText(args.identity.name, 'identity.name', 120);
    assertText(args.identity.role, 'identity.role', 120);
    assertText(args.identity.company, 'identity.company', 160);
    assertText(args.identity.location, 'identity.location', 160);
    assertText(args.identity.availability, 'identity.availability', 200);
    // A bare username, not a URL — the git cron and every repo link are built
    // from it, so a pasted `https://github.com/…` here breaks the GitHub API
    // calls rather than just looking wrong.
    assertText(args.identity.github, 'identity.github', 39);
    if (/[/:\s]/.test(args.identity.github.trim())) {
      invalid({
        code: 'invalid-format',
        field: 'identity.github',
        message: 'github must be a bare username — no URL, no whitespace.',
      });
    }
    assertUrl(args.identity.linkedin, 'identity.linkedin');
    if (args.identity.x !== undefined) {
      assertUrl(args.identity.x, 'identity.x');
    }
    assertEmail(args.identity.email, 'identity.email');

    for (const [field, slugs] of [
      ['featured.projectSlugs', args.featured.projectSlugs],
      ['featured.labSlugs', args.featured.labSlugs],
      ['featured.postSlugs', args.featured.postSlugs],
    ] as const) {
      for (const value of slugs) {
        assertSlug(value, field);
      }
    }

    /* ---- write ------------------------------------------------------- */

    const existing = await ctx.db.query('siteSettings').order('desc').first();
    assertExpectedRevision(existing?.revision, args.expectedRevision);

    // Every stored string is trimmed, matching the rest of the package. It
    // matters most for `identity.github`: schema.ts calls it "also an API key" —
    // the phase-4 git cron and every repo URL are built from it, and a trailing
    // space passes the length check while quietly breaking those calls.
    const trim = (identity: typeof args.identity) => {
      const { x, ...required } = identity;
      return {
        ...(Object.fromEntries(
          Object.entries(required).map(([k, value]) => [k, value.trim()]),
        ) as typeof required),
        ...(x !== undefined ? { x: x.trim() } : {}),
      };
    };

    const content = {
      headline: args.headline.trim(),
      // Both copies, from one input. See the file header.
      availability: args.identity.availability.trim(),
      availabilityVisible: args.availabilityVisible,
      identity: trim(args.identity),
      featured: args.featured,
      nav: args.nav,
    };
    const changed =
      existing === null ||
      existing.headline !== content.headline ||
      existing.availability !== content.availability ||
      (existing.availabilityVisible ?? true) !== content.availabilityVisible ||
      JSON.stringify(existing.identity) !== JSON.stringify(content.identity) ||
      JSON.stringify(existing.featured) !== JSON.stringify(content.featured) ||
      JSON.stringify(existing.nav) !== JSON.stringify(content.nav);
    const revision =
      existing === null
        ? nextRevision(undefined)
        : changed
          ? nextRevision(existing.revision)
          : currentRevision(existing.revision);
    const updatedAt = changed ? nowIso() : (existing?.updatedAt ?? nowIso());
    const row = {
      revision,
      ...content,
      updatedAt,
    };

    if (existing !== null) {
      if (changed) {
        await ctx.db.patch(existing._id, row);
        await refreshSnapshotIdentity(ctx, row.identity);
      }
      return {
        settingsId: existing._id,
        updatedAt,
        created: false,
        changed,
        revision,
      };
    }

    const settingsId = await ctx.db.insert('siteSettings', row);
    await refreshSnapshotIdentity(ctx, row.identity);
    return {
      settingsId,
      updatedAt,
      created: true,
      changed: true,
      revision: row.revision,
    };
  },
});

/**
 * Delete the site-settings singleton. Admin-only.
 *
 * The public site intentionally falls back to its committed defaults when this
 * table is empty. Delete every row so a duplicate created by a restore cannot
 * unexpectedly become the active settings record. Idempotent by design.
 *
 * @returns `{ deleted, revision }` — number of rows removed and the last active
 *   revision, or `null` when the singleton was already absent.
 */
export const remove = mutation({
  args: { expectedRevision: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const rows = await ctx.db.query('siteSettings').order('desc').collect();
    const active = rows[0] ?? null;
    if (active !== null) {
      assertExpectedRevision(active.revision, args.expectedRevision);
    }
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    await refreshSnapshotIdentity(ctx, FALLBACK_IDENTITY);

    return {
      deleted: rows.length,
      revision: active === null ? null : currentRevision(active.revision),
    };
  },
});

/**
 * Update the availability line and its public visibility on their own. Admin-only.
 *
 * The single most load-bearing string on the site (the goal is landing a
 * Principal Engineer role), the one that goes stale in a way that costs
 * something, and the reason it is editable from the phone at all. It gets its own
 * mutation so that "I just accepted an offer, take the banner down" is one tap
 * and not a round trip through a form that also wants your nav configuration.
 *
 * Writes both copies of the field, like `upsert`. Fails if there is no settings
 * row yet: creating the singleton from a one-field mutation would leave every
 * other field to be invented here, and inventing an identity is not this
 * function's business.
 *
 * @returns `{ settingsId, availability, availabilityVisible, updatedAt, changed, revision }`
 */
export const setAvailability = mutation({
  args: {
    availability: v.string(),
    availabilityVisible: v.boolean(),
    expectedRevision: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    assertText(args.availability, 'availability', 200);

    const existing = await ctx.db.query('siteSettings').order('desc').first();
    if (existing === null) {
      invalid({
        code: 'not-found',
        message:
          'Site settings have not been created yet — run siteSettings.upsert first.',
      });
    }
    assertExpectedRevision(existing.revision, args.expectedRevision);

    const availability = args.availability.trim();
    const changed =
      existing.availability !== availability ||
      existing.identity.availability !== availability ||
      (existing.availabilityVisible ?? true) !== args.availabilityVisible;

    if (!changed) {
      return {
        settingsId: existing._id,
        availability,
        availabilityVisible: args.availabilityVisible,
        updatedAt: existing.updatedAt,
        changed: false,
        revision: currentRevision(existing.revision),
      };
    }

    const updatedAt = nowIso();
    const revision = nextRevision(existing.revision);
    const nextIdentity = { ...existing.identity, availability };
    await ctx.db.patch(existing._id, {
      availability,
      availabilityVisible: args.availabilityVisible,
      identity: nextIdentity,
      updatedAt,
      revision,
    });
    await refreshSnapshotIdentity(ctx, nextIdentity);

    return {
      settingsId: existing._id,
      availability,
      availabilityVisible: args.availabilityVisible,
      updatedAt,
      changed: true,
      revision,
    };
  },
});
