import type { CSSProperties } from "react";

import { longDate, monthLabel, num, parseIso } from "@/components/site/format";

import { gitStats, peakWeekTotal, weeklyTotals } from "./data";

/*
 * Weekly contribution cadence — one inline SVG, no chart library.
 *
 * The homepage renders the same year as a 52 × 7 matrix. A résumé wants one
 * line of evidence, not a grid, so the same calendar is summed per column and
 * drawn as 52 bars. Fixed viewBox with `width: 100%; height: auto`: the box is
 * known before paint and the widget never shifts.
 */

const BAR = 7;
const GAP = 3;
const PITCH = BAR + GAP;
const PLOT = 58; // baseline y
const HEIGHT = 72; // + month labels
const MIN_BAR = 2;

/** Bars ride the site ramp: the busier the week, the further up the dawn arc. */
function levelClass(ratio: number): string {
  if (ratio >= 0.86) return "hor-lv4";
  if (ratio >= 0.68) return "hor-lv3";
  if (ratio >= 0.42) return "hor-lv2";
  return "hor-lv1";
}

type Tick = { x: number; label: string };

function monthTicks(): Tick[] {
  const ticks: Tick[] = [];
  let lastMonth = -1;
  let lastCol = -5;

  gitStats.calendar.forEach((week, col) => {
    const month = parseIso(week[0].date).getUTCMonth();
    if (month === lastMonth) return;
    lastMonth = month;
    if (col - lastCol < 5 || col > gitStats.calendar.length - 3) return;
    lastCol = col;
    ticks.push({ x: col * PITCH, label: monthLabel(week[0].date) });
  });

  return ticks;
}

export function Cadence() {
  const width = weeklyTotals.length * PITCH - GAP;
  const ticks = monthTicks();

  return (
    <svg
      className="res-cadence"
      viewBox={`0 0 ${width} ${HEIGHT}`}
      role="img"
      aria-label={`Weekly contribution cadence across ${weeklyTotals.length} weeks. Busiest week: ${num(
        peakWeekTotal,
      )} contributions.`}
      preserveAspectRatio="xMidYMid meet"
    >
      <line
        className="res-baseline"
        x1="0"
        y1={PLOT + 0.5}
        x2={width}
        y2={PLOT + 0.5}
      />

      {weeklyTotals.map((total, col) => {
        const ratio = peakWeekTotal === 0 ? 0 : total / peakWeekTotal;
        const height = Math.max(MIN_BAR, Math.round(ratio * (PLOT - 4)));
        const x = col * PITCH;
        const week = gitStats.calendar[col];

        return (
          <g key={week[0].date}>
            <rect
              className={`res-bar ${levelClass(ratio)}`}
              style={{ "--c": col } as CSSProperties}
              x={x}
              y={PLOT - height}
              width={BAR}
              height={height}
              rx={1.5}
            >
              <title>
                {`Week of ${longDate(week[0].date)} · ${num(total)} contribution${
                  total === 1 ? "" : "s"
                }`}
              </title>
            </rect>

            {total === peakWeekTotal ? (
              <rect
                className="res-peak-tick"
                x={x + BAR / 2 - 0.5}
                y={PLOT - height - 6}
                width={1}
                height={3}
              />
            ) : null}
          </g>
        );
      })}

      {ticks.map((tick) => (
        <text key={tick.x} className="hor-heat-txt" x={tick.x} y={HEIGHT - 2}>
          {tick.label}
        </text>
      ))}
    </svg>
  );
}
