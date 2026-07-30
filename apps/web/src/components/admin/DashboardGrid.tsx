"use client";

import { api } from "@home/convex/api";
import { useQuery } from "convex/react";
import Link from "next/link";

import { ADMIN_SECTIONS, type AdminSectionId } from "./sections";
import { CONVEX_READY } from "./useConvexReady";
import { ConvexGate, ConvexNotConfigured } from "./ConvexGate";

/**
 * The dashboard's section cards, with live counts where a backend exists.
 *
 * ── Why the whole grid is a client component ─────────────────────────────────
 *
 * The cards themselves are static — they come from `ADMIN_SECTIONS` — so on the
 * face of it this should be a server component with a small client leaf per count.
 * It is not, and the reason is React's rules on hooks: nine counts means nine
 * queries, hooks cannot be called conditionally, and the "is there a backend"
 * answer is not known per-card but per-deployment. One component that either calls
 * all nine hooks or none of them is the only arrangement that is legal *and* has a
 * single place where the gate is applied.
 *
 * The cost is the card markup shipping as a component tree rather than as HTML.
 * The admin has no JS budget — that constraint belongs to the public site, which
 * is precisely why the auth SDK lives down here — so this is the cheap side of the
 * trade.
 *
 * ── The counts are approximations, on purpose ────────────────────────────────
 *
 * Every `list` query in `packages/convex` clamps its `limit` (500 for projects and
 * labs, 200 for posts, 300 for fun entries) because none of them paginate. The
 * limits below ask for those ceilings, so the numbers are exact until a table
 * passes one, at which point the card under-reports. That is an acceptable trade
 * for a dashboard: a count is a "roughly how much is in here" signal, and the
 * screen that has to be exact is the entity's own list.
 *
 * There is deliberately no aggregate `counts` query in Convex for this. Adding one
 * per table to make a dashboard exact would be nine functions maintained for a
 * number nobody acts on.
 */

/** What one card shows below its label. `undefined` = still loading. */
type Count = { value: number | string; note?: string } | undefined;

/* ------------------------------------------------------------------ *
 * The live reader — mounted only inside ConvexGate
 * ------------------------------------------------------------------ */

function DashboardCounts() {
  /**
   * Nine subscriptions, all unconditional.
   *
   * `useQuery` returns `undefined` while a subscription is resolving and the data
   * afterwards, which maps directly onto the `Count` type above — so "loading" and
   * "zero" stay distinguishable all the way to the rendered card. That difference
   * matters here more than it looks: a dashboard that shows `0` while loading
   * invites someone to create a record that already exists.
   *
   * `includeDrafts: true` on projects and labs makes those two queries admin-only,
   * which is safe because `ConvexGate` has already established an authenticated
   * client. `posts.list` is auth-aware and needs no flag — it includes drafts for
   * an authenticated caller by itself.
   */
  const projects = useQuery(api.projects.list, {
    includeDrafts: true,
    limit: 500,
  });
  const labs = useQuery(api.labs.list, { includeDrafts: true, limit: 500 });
  const posts = useQuery(api.posts.list, { limit: 200 });
  const funEntries = useQuery(api.funEntries.list, { limit: 300 });
  const experience = useQuery(api.experienceEntries.list, {});
  const messages = useQuery(api.contactMessages.counts, {});
  const tokens = useQuery(api.ingestTokens.list, {});
  const resume = useQuery(api.resume.get, {});
  const settings = useQuery(api.siteSettings.get, {});

  /** `n` drafts, or nothing to say. Keeps the note out of the card when clean. */
  const drafts = (rows: readonly { published: boolean }[] | undefined) => {
    if (!rows) {
      return undefined;
    }

    const count = rows.filter((row) => !row.published).length;
    return count === 0 ? undefined : `${count} draft${count === 1 ? "" : "s"}`;
  };

  const counts: Record<AdminSectionId, Count> = {
    projects: projects && {
      value: projects.length,
      note: drafts(projects),
    },
    labs: labs && { value: labs.length, note: drafts(labs) },
    posts: posts && { value: posts.length, note: drafts(posts) },
    fun: funEntries && { value: funEntries.length },
    experience: experience && { value: experience.length },
    /* Singletons report presence, not a count: "1" would imply there could be
       two, and there cannot — `resume.get` and `siteSettings.get` return one
       document or `null`. */
    resume: resume === undefined ? undefined : { value: resume ? "set" : "empty" },
    settings:
      settings === undefined ? undefined : { value: settings ? "set" : "empty" },
    /* Spam is excluded from the total deliberately: the number on this card is
       "how much correspondence exists", and spam is not correspondence. It is
       still reachable from the inbox screen's status filter. */
    contact: messages && {
      value: messages.new + messages.read + messages.replied + messages.archived,
      note: messages.new > 0 ? `${messages.new} new` : undefined,
    },
    tokens: tokens && {
      value: tokens.filter((token) => token.revokedAt === null).length,
      note: (() => {
        const revoked = tokens.filter((token) => token.revokedAt !== null).length;
        return revoked === 0 ? undefined : `${revoked} revoked`;
      })(),
    },
  };

  return <Cards counts={counts} />;
}

/* ------------------------------------------------------------------ *
 * The cards
 * ------------------------------------------------------------------ */

function Cards({
  counts,
}: {
  /** `null` when there is no backend at all — every card shows an em dash. */
  counts: Record<AdminSectionId, Count> | null;
}) {
  return (
    <div className="adm-cards">
      {ADMIN_SECTIONS.map((section) => {
        const count = counts?.[section.id];

        return (
          <Link key={section.id} href={section.href} className="adm-card">
            <span className="adm-card-head">
              <span className="adm-card-label">{section.label}</span>
              <span className="adm-card-count">
                {counts === null ? (
                  <span
                    className="adm-card-value"
                    /* Not "0" and not a spinner: there is no backend, so there is
                       no number, and pretending otherwise is the one thing a
                       dashboard must not do. */
                    title="No Convex backend on this deployment"
                  >
                    —
                  </span>
                ) : count === undefined ? (
                  <span className="adm-skeleton" style={{ width: "2ch" }} />
                ) : (
                  <>
                    <span className="adm-card-value">{count.value}</span>
                    {count.note ? (
                      <span className="adm-card-note">{count.note}</span>
                    ) : null}
                  </>
                )}
              </span>
            </span>

            <span className="adm-card-blurb">{section.blurb}</span>
            <span className="adm-card-backing">{section.backing}</span>
          </Link>
        );
      })}
    </div>
  );
}

/**
 * The dashboard grid.
 *
 * Renders the cards either way. With no backend they carry em dashes and the
 * gate's notice appears above them — the shape of the admin stays legible on a
 * zero-env clone, which is the whole point of the placeholder tolerance.
 */
export function DashboardGrid() {
  if (!CONVEX_READY) {
    return (
      <>
        <ConvexNotConfigured />
        <Cards counts={null} />
      </>
    );
  }

  return (
    <ConvexGate>
      <DashboardCounts />
    </ConvexGate>
  );
}
