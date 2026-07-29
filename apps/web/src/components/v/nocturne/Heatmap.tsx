import type { ContributionWeek } from "@/lib/snapshot";

import { longDate, monthLabel, num, parseIso } from "./format";

/*
 * Hand-built 52 × 7 contribution grid — one inline SVG, no chart library.
 *
 * The viewBox is derived from the data at module scope and the element is
 * `width: 100%; height: auto`, so the intrinsic aspect ratio is known before
 * paint: the widget claims its exact box on first layout and never shifts,
 * at any viewport width or in either theme.
 */

const CELL = 11;
const GAP = 3;
const PITCH = CELL + GAP;
const LEFT = 25; // day-name gutter
const TOP = 16; // month-label gutter
const ROWS = 7;

/** Fill classes, indexed by ContributionLevel. */
const LEVEL_CLASS = [
  "noc-lv0",
  "noc-lv1",
  "noc-lv2",
  "noc-lv3",
  "noc-lv4",
] as const;

/** The same ramp as custom properties, for the non-SVG legend swatches. */
export const LEVEL_VAR = [
  "var(--noc-lv0)",
  "var(--noc-lv1)",
  "var(--noc-lv2)",
  "var(--noc-lv3)",
  "var(--noc-lv4)",
] as const;

/** Rows labelled on the left edge, GitHub-style: Mon / Wed / Fri. */
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

export function Heatmap({
  weeks,
  total,
}: {
  weeks: ContributionWeek[];
  total: number;
}) {
  const width = LEFT + weeks.length * PITCH - GAP;
  const height = TOP + ROWS * PITCH - GAP;
  const ticks = monthTicks(weeks);

  return (
    <svg
      className="noc-heat"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Contribution heatmap: ${num(total)} contributions across ${
        weeks.length
      } weeks, ${longDate(weeks[0][0].date)} to ${longDate(
        weeks[weeks.length - 1][6].date,
      )}.`}
      preserveAspectRatio="xMidYMid meet"
    >
      {ticks.map((tick) => (
        <text key={tick.x} className="noc-heat-tick" x={tick.x} y={9}>
          {tick.label}
        </text>
      ))}

      {Object.entries(DAY_LABELS).map(([row, label]) => (
        <text
          key={label}
          className="noc-heat-tick"
          x={LEFT - 7}
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
            className={`noc-heat-cell ${LEVEL_CLASS[day.level]}`}
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

export function HeatmapLegend() {
  return (
    <div className="flex items-center gap-1.5" aria-hidden="true">
      <span className="noc-micro">Less</span>
      <div className="flex items-center gap-[3px]">
        {LEVEL_VAR.map((fill, i) => (
          <span
            key={fill}
            className={`noc-legend-sw${i === 4 ? " noc-legend-sw-hot" : ""}`}
            style={{ background: fill }}
          />
        ))}
      </div>
      <span className="noc-micro">More</span>
    </div>
  );
}
