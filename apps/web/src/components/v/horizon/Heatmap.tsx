import type { CSSProperties } from "react";

import type { ContributionDay, ContributionWeek } from "@/lib/snapshot";

import { longDate, monthLabel, num, parseIso } from "./format";

/*
 * Hand-built 52 × 7 contribution grid, one inline SVG, no chart library.
 *
 * Fixed viewBox with `width: 100%; height: auto` means the intrinsic aspect
 * ratio is known before paint: the widget reserves its exact box on first
 * layout and never shifts — at any viewport width, in either theme.
 */

const CELL = 11;
const GAP = 3;
const PITCH = CELL + GAP;
const LEFT = 22; // day-name gutter
const TOP = 14; // month-label gutter
const ROWS = 7;

const LEVEL_CLASS = [
  "hor-lv0",
  "hor-lv1",
  "hor-lv2",
  "hor-lv3",
  "hor-lv4",
] as const;

/** The same ramp as custom properties, for the non-SVG legend swatches. */
export const RAMP_VARS = [
  "var(--hor-l0)",
  "var(--hor-l1)",
  "var(--hor-l2)",
  "var(--hor-l3)",
  "var(--hor-l4)",
] as const;

/** Rows labelled on the left edge, GitHub-style. */
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

function cellTitle(day: ContributionDay): string {
  return day.count === 0
    ? `No contributions · ${longDate(day.date)}`
    : `${num(day.count)} contribution${day.count === 1 ? "" : "s"} · ${longDate(
        day.date,
      )}`;
}

export function Heatmap({
  weeks,
  peak,
}: {
  weeks: ContributionWeek[];
  /** ISO date of the busiest day; it gets a ring so the eye lands on it. */
  peak?: string;
}) {
  const width = LEFT + weeks.length * PITCH - GAP;
  const height = TOP + ROWS * PITCH - GAP;
  const ticks = monthTicks(weeks);

  return (
    <svg
      className="hor-heat"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Contribution activity heatmap: ${weeks.length} weeks by seven days, Sunday to Saturday.`}
      preserveAspectRatio="xMidYMid meet"
    >
      {ticks.map((tick) => (
        <text key={tick.x} className="hor-heat-txt" x={tick.x} y={7}>
          {tick.label}
        </text>
      ))}

      {Object.entries(DAY_LABELS).map(([row, label]) => (
        <text
          key={label}
          className="hor-heat-txt"
          x={LEFT - 6}
          y={TOP + Number(row) * PITCH + CELL / 2}
          textAnchor="end"
          dominantBaseline="central"
        >
          {label}
        </text>
      ))}

      {weeks.map((week, col) => (
        <g
          key={week[0].date}
          className="hor-heat-col"
          style={{ "--c": col } as CSSProperties}
        >
          {week.map((day, row) => (
            <rect
              key={day.date}
              className={`hor-cell ${LEVEL_CLASS[day.level]}`}
              x={LEFT + col * PITCH}
              y={TOP + row * PITCH}
              width={CELL}
              height={CELL}
              rx={2.5}
            >
              <title>{cellTitle(day)}</title>
            </rect>
          ))}

          {peak
            ? week.map((day, row) =>
                day.date === peak ? (
                  <rect
                    key={`${day.date}-peak`}
                    className="hor-peak-ring"
                    x={LEFT + col * PITCH - 2}
                    y={TOP + row * PITCH - 2}
                    width={CELL + 4}
                    height={CELL + 4}
                    rx={4}
                  />
                ) : null,
              )
            : null}
        </g>
      ))}
    </svg>
  );
}

export function HeatmapLegend() {
  return (
    <div className="flex items-center gap-1.5">
      <span className="hor-label">Less</span>
      <div className="flex items-center gap-[3px]">
        {RAMP_VARS.map((fill, i) => (
          <span
            key={i}
            className="hor-swatch"
            style={{
              background: fill,
              boxShadow: i === 4 ? "var(--hor-glow-sun)" : undefined,
            }}
          />
        ))}
      </div>
      <span className="hor-label">More</span>
    </div>
  );
}
