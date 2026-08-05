import type { Metadata } from "next";
import Link from "next/link";

import { stamp } from "@/components/site/format";
import { FunBands } from "@/components/site/fun/FunBands";
import { FunHeader } from "@/components/site/fun/FunHeader";
import { HealthActivityFeed } from "@/components/site/fun/HealthActivityFeed";
import { getSiteData } from "@/lib/data";
import { deriveFun } from "@/lib/derive";

import "./fun.css";

/**
 * ISR, five minutes. Written as a literal because Next requires this value to be
 * statically analysable — see the ISR section of `@/lib/data`'s header for why
 * 300 and not something else.
 */
export const revalidate = 300;

/**
 * `generateMetadata`, not a `metadata` object.
 *
 * The description quotes the tally, and the tally is now fetched rather than
 * frozen — a module-scope `metadata` const would have been computed once per
 * process and could never see a Convex row. `getSiteData()` is wrapped in
 * React's `cache()`, so this call and the page's below are one round of queries
 * per render, not two.
 *
 * The title is bare — the `(site)` layout's `title.template` adds the
 * "— Corey Baines" suffix once, from live identity.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { identity, funLog, computedAt, healthStats } = await getSiteData();
  const { tally } = deriveFun(funLog, computedAt, healthStats);

  const healthDescription =
    tally.healthDays > 0
      ? ` HealthKit has synced ${tally.steps.toLocaleString("en-AU")} steps and ${tally.km.toFixed(1)} km across ${tally.healthDays} recent days.`
      : "";

  return {
    title: "Off the clock",
    description: `${tally.entries} logged moments from the last ${tally.spanDays} days in ${identity.location}: ${tally.counts.coffee} coffees, ${tally.counts.beer} beers, ${tally.counts.pub} pub nights and ${tally.counts.walk} walks.${healthDescription}`,
    alternates: { canonical: "/fun" },
  };
}

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
 * Server component, no client JS, no images. **One read**: `getSiteData()` is
 * called once here and the result is passed down as props — no component under
 * this page fetches, and none of them import the snapshot. Every figure comes
 * from `deriveFun(funLog, computedAt, healthStats)`; the prose is draft copy.
 *
 * An empty feed is rendered as an explicit state. It is never filled with the
 * committed design-study entries.
 */
export default async function FunPage() {
  const { identity, funLog, computedAt, healthStats } = await getSiteData();
  const { bands, healthActivities, hueFor, isoDaysAgo, logRange, tally } = deriveFun(
    funLog,
    computedAt,
    healthStats,
  );

  return (
    <main>
      {/* ── the warm end of the sky ───────────────────────────────── */}
      <section className="hor-sky">
        <div className="hor-wash" aria-hidden="true" />
        <div className="hor-shell">
          <FunHeader identity={identity} tally={tally} />
        </div>
      </section>

      {/* A horizon of its own — sky on both sides, so no deck material bleeds
          up through it. Fixed height; it can never reflow. */}
      <div className="fun-seam" aria-hidden="true">
        <div className="hor-boundary-chip">
          <span className="hor-tick" />
          <span className="hor-label">
            {funLog.length > 0
              ? `${stamp(logRange.oldest)} — ${stamp(logRange.newest)}`
              : healthActivities.length > 0
                ? `Health activities · ${healthActivities.length}`
                : "Live log · no entries"}
          </span>
          <span className="hor-tick" />
        </div>
      </div>

      {/* ── the log ───────────────────────────────────────────────── */}
      <section className="hor-shell pb-16 sm:pb-20">
        <HealthActivityFeed activities={healthActivities} />

        <FunBands
          bands={bands}
          hueFor={hueFor}
          isoDaysAgo={isoDaysAgo}
          longestKm={tally.longestKm}
        />

        {funLog.length === 0 && healthActivities.length === 0 ? (
          <div className="hor-card hor-rise mt-10 p-6 sm:p-8">
            <span className="hor-eyebrow">Live feed</span>
            <h2 className="hor-h3 mt-3.5">No moments have been published yet.</h2>
            <p className="hor-body mt-3 max-w-[52ch] text-pretty">
              This is the current Convex result, not placeholder content. The page
              will populate on its next revalidation after the first entry arrives.
            </p>
          </div>
        ) : null}

        {funLog.length > 0 ? (
          <div className="mt-14 sm:mt-16">
            <div className="hor-rule" />
            <div className="fun-signoff">
              <p className="hor-body max-w-[46ch] text-pretty">
                None of this ships, none of it is instrumented, and the walks are the only part
                with a number attached. That is rather the point of it.
              </p>
              <Link href="/" className="hor-link text-[13px] font-medium">
                Back to the telemetry
              </Link>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
