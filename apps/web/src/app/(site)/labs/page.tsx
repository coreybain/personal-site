import type { Metadata } from "next";

import { Boundary } from "@/components/site/Boundary";
import { num, stampTime } from "@/components/site/format";
import { FeaturedLabs } from "@/components/site/labs/FeaturedLabs";
import { LabWall } from "@/components/site/labs/LabWall";
import { LabsCoda } from "@/components/site/labs/LabsCoda";
import { LabsIntro } from "@/components/site/labs/LabsIntro";
import { RecencyWindow } from "@/components/site/labs/RecencyWindow";
import {
  activePhrase,
  combinedCadence,
  freshest,
  labs,
  totalCommits,
} from "@/components/site/labs/data";
import { snapshot } from "@/lib/snapshot";

import "./labs.css";

/**
 * /labs — the personal repositories.
 *
 * Same three-material rhythm as the homepage, weighted differently: the sky
 * opening is one short paragraph whose only job is to separate this page from
 * the client work, and then the page spends almost all of itself below the
 * horizon, as a telemetry wall.
 *
 * Server component end to end; every number comes from `@/lib/snapshot` by way
 * of `components/site/labs/data.ts`. Colour is `--hor-*` only, so both themes
 * are handled by the two THEME blocks in horizon.css.
 */

export const metadata: Metadata = {
  title: `Labs — ${snapshot.identity.name}`,
  description: `${labs.length} personal repositories, built outside client work: ${num(
    totalCommits,
  )} commits in the last 12 months at ${combinedCadence.toFixed(
    1,
  )} a week, most recent push ${activePhrase(
    freshest.liveStats.lastPushDaysAgo,
  )} on ${freshest.title}.`,
};

export default function LabsPage() {
  return (
    <main>
      {/* ── above the horizon: what these are ─────────────────────── */}
      <section className="hor-sky">
        <div className="hor-wash" aria-hidden="true" />
        <div className="hor-shell">
          <LabsIntro />
        </div>
      </section>

      <Boundary label={`Labs · ${stampTime(snapshot.computedAt)}`} />

      {/* ── below the horizon: the wall ───────────────────────────── */}
      <div className="hor-deck-zone">
        <div className="hor-deck-grid" aria-hidden="true" />
        <div className="hor-shell pb-16 sm:pb-20">
          <RecencyWindow />
          <FeaturedLabs />
          <LabWall />
        </div>
      </div>

      <Boundary direction="out" />

      {/* ── surfacing again for the closing note ──────────────────── */}
      <section className="hor-sky">
        <div className="hor-shell">
          <LabsCoda />
        </div>
      </section>
    </main>
  );
}
