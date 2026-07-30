import type { Metadata } from "next";

import { Boundary } from "@/components/site/Boundary";
import { num, stampTime } from "@/components/site/format";
import { FeaturedLabs } from "@/components/site/labs/FeaturedLabs";
import { LabWall } from "@/components/site/labs/LabWall";
import { LabsCoda } from "@/components/site/labs/LabsCoda";
import { LabsIntro } from "@/components/site/labs/LabsIntro";
import { RecencyWindow } from "@/components/site/labs/RecencyWindow";
import { getSiteData } from "@/lib/data";
import { activePhrase, deriveLabs } from "@/lib/derive";

import "./labs.css";

/**
 * /labs — the personal repositories.
 *
 * Same three-material rhythm as the homepage, weighted differently: the sky
 * opening is one short paragraph whose only job is to separate this page from
 * the client work, and then the page spends almost all of itself below the
 * horizon, as a telemetry wall.
 *
 * Server component end to end; every number comes from Convex by way of
 * `@/lib/data` — with the mock as a per-domain fallback — and is reduced by
 * `deriveLabs()`. The snapshot is read **once**, here, and passed down as props;
 * nothing below this function fetches. Colour is `--hor-*` only, so both themes
 * are handled by the two THEME blocks in horizon.css.
 */

/**
 * ISR, five minutes — the same window every `(site)` page declares. Written as a
 * literal because Next requires this value to be statically analysable; see the
 * ISR section of `@/lib/data`'s header for why 300 and why an uncached Convex
 * `fetch` still prerenders.
 */
export const revalidate = 300;

/**
 * `generateMetadata` rather than a `metadata` constant: the description quotes
 * the freshest push, and a module-scope object is built once per process.
 *
 * `getSiteData()` is wrapped in React's `cache()` and metadata generation shares
 * a request scope with the render below, so this is the same six queries — not
 * twelve.
 */
export async function generateMetadata(): Promise<Metadata> {
  const snapshot = await getSiteData();
  const { labs, totalCommits, combinedCadence, freshest } = deriveLabs(
    snapshot.labs,
  );

  return {
    title: `Labs — ${snapshot.identity.name}`,
    description: `${labs.length} personal repositories, built outside client work: ${num(
      totalCommits,
    )} commits in the last 12 months at ${combinedCadence.toFixed(
      1,
    )} a week, most recent push ${activePhrase(
      freshest.liveStats.lastPushDaysAgo,
    )} on ${freshest.title}.`,
  };
}

export default async function LabsPage() {
  const snapshot = await getSiteData();
  const derived = deriveLabs(snapshot.labs);

  return (
    <main>
      {/* ── above the horizon: what these are ─────────────────────── */}
      <section className="hor-sky">
        <div className="hor-wash" aria-hidden="true" />
        <div className="hor-shell">
          <LabsIntro identity={snapshot.identity} {...derived} />
        </div>
      </section>

      <Boundary label={`Labs · ${stampTime(snapshot.computedAt)}`} />

      {/* ── below the horizon: the wall ───────────────────────────── */}
      <div className="hor-deck-zone">
        <div className="hor-deck-grid" aria-hidden="true" />
        <div className="hor-shell pb-16 sm:pb-20">
          <RecencyWindow {...derived} />
          <FeaturedLabs {...derived} />
          <LabWall {...derived} />
        </div>
      </div>

      <Boundary direction="out" />

      {/* ── surfacing again for the closing note ──────────────────── */}
      <section className="hor-sky">
        <div className="hor-shell">
          <LabsCoda
            identity={snapshot.identity}
            gitStats={snapshot.gitStats}
            {...derived}
          />
        </div>
      </section>
    </main>
  );
}
