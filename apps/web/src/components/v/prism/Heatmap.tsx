import type { CSSProperties } from "react";

import type { ContributionWeek } from "@/lib/snapshot";

import { longDate, monthLabel, num, parseIso } from "./format";

/*
 * Hand-built 52 × 7 contribution grid, one inline SVG, no chart library.
 *
 * The Prism twist: the whole grid is painted with a single instance of the
 * signature spectrum, laid across the year in `userSpaceOnUse` coordinates —
 * so hue encodes *when*, and per-cell opacity encodes *how much*. That keeps
 * the ramp monotonic (and therefore readable) while letting the identity
 * gradient do real work instead of decoration.
 *
 * Fixed viewBox + `width: 100%; height: auto` means the intrinsic aspect ratio
 * is known before paint: the widget reserves its exact box on first layout and
 * never shifts, at any width, in either theme.
 */

const GRADIENT_ID = "pri-heat-spectrum";

const CELL = 11;
const GAP = 3;
const PITCH = CELL + GAP;
const LEFT = 26; // day-name gutter
const TOP = 16; // month-label gutter
const ROWS = 7;

const LEVEL_CLASS = ["pri-c0", "pri-c1", "pri-c2", "pri-c3", "pri-c4"] as const;

const DAY_LABELS: Record<number, string> = { 1: "Mon", 3: "Wed", 5: "Fri" };

type MonthTick = { x: number; label: string };

function monthTicks(weeks: ContributionWeek[]): MonthTick[] {
  const ticks: MonthTick[] = [];
  let lastMonth = -1;
  let lastCol = -4;

  weeks.forEach((week, col) => {
    const first = week[0];
    if (!first) return;
    const month = parseIso(first.date).getUTCMonth();
    if (month === lastMonth) return;
    lastMonth = month;
    // Keep ~3 columns of air between labels, and never run off the right edge.
    if (col - lastCol < 3 || col > weeks.length - 3) return;
    lastCol = col;
    ticks.push({ x: LEFT + col * PITCH, label: monthLabel(first.date) });
  });

  return ticks;
}

export function Heatmap({ weeks }: { weeks: ContributionWeek[] }) {
  const width = LEFT + weeks.length * PITCH - GAP;
  const height = TOP + ROWS * PITCH - GAP;
  const ticks = monthTicks(weeks);
  const total = weeks.flat().reduce((sum, day) => sum + day.count, 0);

  return (
    <svg
      className="pri-heatmap"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Contribution heatmap: ${num(
        total,
      )} contributions across ${weeks.length} weeks by seven days, oldest on the left.`}
    >
      <defs>
        <linearGradient
          id={GRADIENT_ID}
          gradientUnits="userSpaceOnUse"
          x1={LEFT}
          y1={0}
          x2={width}
          y2={0}
        >
          <stop className="pri-gs1" offset="0" />
          <stop className="pri-gs2" offset="0.33" />
          <stop className="pri-gs3" offset="0.66" />
          <stop className="pri-gs4" offset="1" />
        </linearGradient>
      </defs>

      {ticks.map((tick) => (
        <text key={tick.x} className="pri-heat-label" x={tick.x} y={8}>
          {tick.label}
        </text>
      ))}

      {Object.entries(DAY_LABELS).map(([row, label]) => (
        <text
          key={label}
          className="pri-heat-label"
          x={LEFT - 8}
          y={TOP + Number(row) * PITCH + CELL / 2}
          textAnchor="end"
          dominantBaseline="central"
        >
          {label}
        </text>
      ))}

      {weeks.map((week, col) =>
        week.map((day, row) => (
          <rect
            key={day.date}
            className={`pri-cell ${LEVEL_CLASS[day.level]}`}
            fill={`url(#${GRADIENT_ID})`}
            x={LEFT + col * PITCH}
            y={TOP + row * PITCH}
            width={CELL}
            height={CELL}
            rx={2.5}
          >
            <title>
              {day.count === 0
                ? `No contributions · ${longDate(day.date)}`
                : `${num(day.count)} contribution${
                    day.count === 1 ? "" : "s"
                  } · ${longDate(day.date)}`}
            </title>
          </rect>
        )),
      )}
    </svg>
  );
}

const LEGEND_STEPS: CSSProperties[] = [
  { background: "var(--pri-hm-empty)" },
  { opacity: "var(--pri-hm-o1)" },
  { opacity: "var(--pri-hm-o2)" },
  { opacity: "var(--pri-hm-o3)" },
  {},
];

export function HeatmapLegend() {
  return (
    <div className="flex items-center gap-1.5">
      <span className="pri-micro">Less</span>
      <div className="flex items-center gap-[3px]">
        {LEGEND_STEPS.map((style, i) => (
          <span key={i} className="pri-legend-sw" style={style} />
        ))}
      </div>
      <span className="pri-micro">More</span>
    </div>
  );
}
