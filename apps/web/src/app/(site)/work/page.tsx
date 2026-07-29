import type { Metadata } from "next";

import { Boundary } from "@/components/site/Boundary";
import { num, stampTime } from "@/components/site/format";
import { BuildLedger } from "@/components/site/work/BuildLedger";
import { WorkGrid } from "@/components/site/work/WorkGrid";
import { WorkIntro } from "@/components/site/work/WorkIntro";
import { buildHours, buildSessions } from "@/components/site/work/data";
import { snapshot } from "@/lib/snapshot";

import "./work.css";

const { identity, projects, gitStats } = snapshot;

export const metadata: Metadata = {
  title: `Work — ${identity.name}`,
  description: `${projects.length} production platforms built as ${identity.role} at ${
    identity.company
  }: document automation, travel operations, compliance and real-time auctions. ${num(
    gitStats.totalContributionsYear,
  )} contributions in twelve months, ${num(buildSessions)} agent sessions and ${num(
    buildHours,
  )} hours logged against them.`,
};

/**
 * /work — the case-study index.
 *
 * Same zone structure as the homepage, because it is the same site: a calm sky
 * states the shape of the work, the page crosses the horizon into a telemetry
 * deck for the build ledger, then surfaces again for the image-led grid. The
 * shell (ThemeScope, nav pill, footer) comes from the `(site)` layout; what
 * lives here is only this page's own zones.
 *
 * Every figure on the page is read from `@/lib/snapshot` or derived from it in
 * `components/site/work/data.ts`. Nothing is typed in by hand.
 */
export default function WorkPage() {
  return (
    <main>
      {/* ── above the horizon: the shape of the work ──────────────── */}
      <section className="hor-sky">
        <div className="hor-wash" aria-hidden="true" />
        <div className="hor-shell">
          <WorkIntro />
        </div>
      </section>

      <Boundary label={`Build ledger · ${stampTime(snapshot.computedAt)}`} />

      {/* ── below the horizon: what it cost to build ──────────────── */}
      <div className="hor-deck-zone">
        <div className="hor-deck-grid" aria-hidden="true" />
        <div className="hor-shell pb-16 sm:pb-20">
          <BuildLedger />
        </div>
      </div>

      <Boundary direction="out" />

      {/* ── back above the horizon: the platforms themselves ──────── */}
      <section className="hor-sky">
        <div className="hor-shell">
          <WorkGrid />
        </div>
      </section>
    </main>
  );
}
