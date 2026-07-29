import type { Metadata } from "next";
import Link from "next/link";

import { stamp } from "@/components/site/format";
import { FunBands } from "@/components/site/fun/FunBands";
import { FunHeader } from "@/components/site/fun/FunHeader";
import { logRange, tally } from "@/components/site/fun/data";
import { snapshot } from "@/lib/snapshot";

import "./fun.css";

const { identity } = snapshot;

export const metadata: Metadata = {
  title: `Off the clock — ${identity.name}`,
  description: `${tally.entries} logged moments from the last ${tally.spanDays} days in ${identity.location}: ${tally.counts.coffee} coffees, ${tally.counts.beer} beers, ${tally.counts.pub} pub nights and ${tally.counts.walk} walks covering ${tally.km.toFixed(1)} km.`,
};

/**
 * /fun — the proof there is a person behind the dashboard.
 *
 * Sky zone from top to bottom. The rest of the site descends through a horizon
 * rule into graph paper and instrument panels; this page never does. It keeps
 * the same tokens, the same type scale and the same glass, and swaps telemetry
 * for generated artwork — a glass of beer, a cup from above, horizon strata for
 * a walk, a lit pub window.
 *
 * One seam divides it: the header's warm wash sits on a horizon rule of the
 * page's own, and below the rule the log runs on the plain page ground so the
 * cards carry the colour instead.
 *
 * Server component, no client JS, no images, no requests. Every number comes
 * from `snapshot.funLog` by way of `components/site/fun/data.ts`; the prose is
 * draft copy.
 */
export default function FunPage() {
  return (
    <main>
      {/* ── the warm end of the sky ───────────────────────────────── */}
      <section className="hor-sky">
        <div className="hor-wash" aria-hidden="true" />
        <div className="hor-shell">
          <FunHeader />
        </div>
      </section>

      {/* A horizon of its own — sky on both sides, so no deck material bleeds
          up through it. Fixed height; it can never reflow. */}
      <div className="fun-seam" aria-hidden="true">
        <div className="hor-boundary-chip">
          <span className="hor-tick" />
          <span className="hor-label">
            {stamp(logRange.oldest)} — {stamp(logRange.newest)}
          </span>
          <span className="hor-tick" />
        </div>
      </div>

      {/* ── the log ───────────────────────────────────────────────── */}
      <section className="hor-shell pb-16 sm:pb-20">
        <FunBands />

        <div className="mt-14 sm:mt-16">
          <div className="hor-rule" />
          <div className="fun-signoff">
            <p className="hor-body max-w-[46ch] text-pretty">
              None of this ships, none of it is instrumented, and the walks are
              the only part with a number attached. That is rather the point of
              it.
            </p>
            <Link href="/" className="hor-link text-[13px] font-medium">
              Back to the telemetry
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
