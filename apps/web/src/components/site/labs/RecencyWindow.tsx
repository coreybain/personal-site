import type { CSSProperties } from "react";

import { DeckHead, Panel } from "@/components/site/Panel";
import { num } from "@/components/site/format";

import {
  activePhrase,
  axisMax,
  axisPos,
  axisTicks,
  band,
  cadence,
  combinedCadence,
  freshest,
  labs,
  maxCommits,
  totalCommits,
  totalForks,
  totalStars,
} from "./data";

/**
 * The recency window — one shared axis, one dot per repository.
 *
 * A dot plot rather than four separate gauges, because the question this page
 * answers is comparative: *is anything still moving?* Left edge is today, the
 * stem is elapsed time and the dot is the push, so a short stem reads as fresh
 * before a single numeral is parsed. Stars are nowhere in this widget on
 * purpose — they are the least informative number a personal repo produces.
 *
 * Fixed 38px rows and a fixed axis foot: the panel reserves its exact box on
 * first layout and cannot shift.
 */

const busiest = labs.reduce((a, b) =>
  b.liveStats.commitsYear > a.liveStats.commitsYear ? b : a,
);

const SUBSTATS = [
  {
    label: "Last push",
    value:
      freshest.liveStats.lastPushDaysAgo <= 0
        ? "Today"
        : `${freshest.liveStats.lastPushDaysAgo} d`,
    sub: `${freshest.title} · ${activePhrase(freshest.liveStats.lastPushDaysAgo)}`,
  },
  {
    label: "Combined cadence",
    value: combinedCadence.toFixed(1),
    sub: `commits a week across ${labs.length} repos`,
  },
  {
    label: "Commits, 12 mo",
    value: num(totalCommits),
    sub: `busiest: ${busiest.title}, ${cadence(busiest).toFixed(1)}/wk`,
  },
  {
    label: "Stars, all repos",
    value: num(totalStars),
    sub: `${totalForks} forks · counted, not chased`,
  },
];

/** `--labs-x` positions a mark along the plotted range; `p` is 0 → 1. */
function at(p: number): CSSProperties {
  return { "--labs-x": `${(p * 100).toFixed(2)}%` } as CSSProperties;
}

export function RecencyWindow() {
  const stepPct = `${(100 / (axisTicks.length - 1)).toFixed(4)}%`;

  return (
    <section id="recency" className="scroll-mt-20">
      <DeckHead
        index="01"
        title="Recency window"
        meta={`${labs.length} repositories · axis 0 — ${axisMax} d`}
      />

      <Panel
        label="Days since last push"
        meta={
          <>
            <span className="hor-hot">{freshest.title}</span> newest · peak{" "}
            {num(maxCommits)} commits
          </>
        }
        padded={false}
        delay={40}
      >
        <div className="hor-panel-body">
          <div className="labs-plot" style={{ "--labs-step": stepPct } as CSSProperties}>
            {labs.map((lab) => {
              const days = lab.liveStats.lastPushDaysAgo;
              const p = axisPos(days);

              return (
                <div className="labs-plot-row" key={lab.slug}>
                  <span className="labs-plot-name">{lab.title}</span>

                  <span className="labs-plot-track">
                    <span className="labs-plot-inner">
                      <i className="labs-plot-stem" style={at(p)} aria-hidden="true" />
                      <i
                        className={`labs-plot-dot labs-band-${band(days)}`}
                        style={at(p)}
                        aria-hidden="true"
                      />
                    </span>
                  </span>

                  <span className="labs-plot-val">
                    {days}d
                    <span className="sr-only"> since last push</span>
                  </span>
                </div>
              );
            })}

            <div className="labs-plot-row labs-axis" aria-hidden="true">
              <span className="hor-label">Days ago</span>
              <span className="labs-plot-track">
                <span className="labs-plot-inner">
                  {axisTicks.map((tick, i) => (
                    <span
                      key={tick}
                      className="labs-axis-tick"
                      style={at(tick / axisMax)}
                      data-edge={
                        i === 0
                          ? "start"
                          : i === axisTicks.length - 1
                            ? "end"
                            : undefined
                      }
                    >
                      {tick}d
                    </span>
                  ))}
                </span>
              </span>
              <span />
            </div>
          </div>

          <p className="hor-micro mt-5 max-w-[62ch]">
            Left edge is today. The stem is elapsed time and the dot is the last
            push, so a short stem is a repository that is still moving. Colour
            runs the same night-to-dawn ramp as the contribution grid on the
            homepage.
          </p>
        </div>

        <div className="hor-substats">
          {SUBSTATS.map((s) => (
            <div key={s.label} className="hor-substat">
              <span className="hor-label">{s.label}</span>
              <div className="hor-readout-sm mt-2.5">{s.value}</div>
              <p className="hor-micro mt-1.5 truncate">{s.sub}</p>
            </div>
          ))}
        </div>
      </Panel>
    </section>
  );
}
