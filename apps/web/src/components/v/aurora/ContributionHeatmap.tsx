import type { ContributionWeek } from "@/lib/snapshot";

import styles from "./aurora.module.css";
import { longDate, monthLabel, num, parseIso } from "./format";

/*
 * Hand-built 52 × 7 contribution grid as a single inline SVG.
 *
 * Rendered with a fixed viewBox and `width: 100%; height: auto`, so the
 * intrinsic aspect ratio is known before paint — the widget reserves its exact
 * box on first layout and never shifts, at any viewport width.
 */

const CELL = 10;
const GAP = 3;
const PITCH = CELL + GAP;
const LEFT = 24; // day-name gutter
const TOP = 15; // month-label gutter
const ROWS = 7;

/** Fill classes, indexed by ContributionLevel. */
const LEVEL_CLASS = [styles.lv0, styles.lv1, styles.lv2, styles.lv3, styles.lv4] as const;

/** The same ramp as CSS custom properties, for non-SVG swatches. */
const LEVEL_VAR = [
  "var(--aur-lv0)",
  "var(--aur-lv1)",
  "var(--aur-lv2)",
  "var(--aur-lv3)",
  "var(--aur-lv4)",
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
    // Keep ~3 columns of air between labels and never run off the right edge.
    if (col - lastCol < 3 || col > weeks.length - 3) return;
    lastCol = col;
    ticks.push({ x: LEFT + col * PITCH, label: monthLabel(first.date) });
  });

  return ticks;
}

export function ContributionHeatmap({ weeks }: { weeks: ContributionWeek[] }) {
  const width = LEFT + weeks.length * PITCH - GAP;
  const height = TOP + ROWS * PITCH - GAP;
  const ticks = monthTicks(weeks);

  return (
    <svg
      className={styles.heatmap}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Contribution activity heatmap, ${weeks.length} weeks by seven days.`}
      preserveAspectRatio="xMidYMid meet"
    >
      {ticks.map((tick) => (
        <text key={tick.x} className={styles.heatLabel} x={tick.x} y={8}>
          {tick.label}
        </text>
      ))}

      {Object.entries(DAY_LABELS).map(([row, label]) => (
        <text
          key={label}
          className={styles.heatLabel}
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
            className={`${styles.heatCell} ${LEVEL_CLASS[day.level]}`}
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
    <div className="flex items-center gap-1.5">
      <span className={styles.micro}>Less</span>
      <div className="flex items-center gap-[3px]">
        {LEVEL_VAR.map((fill, i) => (
          <span
            key={i}
            className="block h-[9px] w-[9px] rounded-[2.5px]"
            style={{ background: fill }}
          />
        ))}
      </div>
      <span className={styles.micro}>More</span>
    </div>
  );
}
