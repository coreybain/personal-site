import { snapshot, type ContributionWeek } from "@/lib/snapshot";
import { dayLabel, monthIndex, monthShort, num } from "./format";

/* Geometry, in viewBox units. The SVG carries its own intrinsic ratio, so the
   widget reserves its height before a single byte of CSS lands: zero shift. */
const CELL = 11;
const GAP = 3;
const PITCH = CELL + GAP;
const GUTTER_L = 26; // weekday labels
const GUTTER_T = 18; // month labels

const LEVEL_FILL = [
  "var(--ed-l0)",
  "var(--ed-l1)",
  "var(--ed-l2)",
  "var(--ed-l3)",
  "var(--ed-l4)",
] as const;

/** Rows to label. Sunday-first grid, so 1 / 3 / 5 are Mon / Wed / Fri. */
const LABELLED_ROWS = [1, 3, 5] as const;

type MonthTick = { x: number; label: string; key: string };

/** GitHub's rule: tick a month the first week it appears, if there's room. */
function monthTicks(weeks: ContributionWeek[]): MonthTick[] {
  const ticks: MonthTick[] = [];
  let lastMonth = -1;
  let lastTickWeek = -99;

  weeks.forEach((week, w) => {
    const m = monthIndex(week[0].date);
    if (m === lastMonth) return;
    lastMonth = m;
    // Leave room for the label itself, and don't crowd the right edge.
    if (w - lastTickWeek < 3 || w > weeks.length - 3) return;
    lastTickWeek = w;
    ticks.push({
      x: GUTTER_L + w * PITCH,
      label: monthShort(week[0].date).toUpperCase(),
      key: week[0].date,
    });
  });

  return ticks;
}

export function ContributionHeatmap() {
  const weeks = snapshot.gitStats.calendar;
  const today = snapshot.computedAt.slice(0, 10);

  const width = GUTTER_L + weeks.length * PITCH - GAP;
  const height = GUTTER_T + 7 * PITCH - GAP;
  const ticks = monthTicks(weeks);

  return (
    <svg
      className="ed-heat"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      preserveAspectRatio="xMinYMid meet"
      role="img"
      aria-label={`Contribution calendar: ${num(
        snapshot.gitStats.totalContributionsYear,
      )} contributions across the last ${weeks.length} weeks.`}
    >
      {ticks.map((tick) => (
        <text key={tick.key} x={tick.x} y={10}>
          {tick.label}
        </text>
      ))}

      {LABELLED_ROWS.map((row) => (
        <text key={row} x={0} y={GUTTER_T + row * PITCH + 8.5}>
          {["S", "M", "T", "W", "T", "F", "S"][row]}
        </text>
      ))}

      {weeks.map((week, w) =>
        week.map((day, d) => {
          const x = GUTTER_L + w * PITCH;
          const y = GUTTER_T + d * PITCH;
          const future = day.date > today;

          return (
            <rect
              key={day.date}
              x={x}
              y={y}
              width={CELL}
              height={CELL}
              rx={1}
              fill={future ? "var(--ed-paper-2)" : LEVEL_FILL[day.level]}
              stroke={future ? "var(--ed-rule-soft)" : "none"}
              strokeWidth={future ? 1 : 0}
            >
              <title>
                {future
                  ? `${dayLabel(day.date, d)} — not yet`
                  : `${num(day.count)} contribution${
                      day.count === 1 ? "" : "s"
                    } — ${dayLabel(day.date, d)}`}
              </title>
            </rect>
          );
        }),
      )}

      {/* Today, ringed. */}
      {weeks.map((week, w) =>
        week.map((day, d) =>
          day.date === today ? (
            <rect
              key={`today-${day.date}`}
              x={GUTTER_L + w * PITCH - 2.5}
              y={GUTTER_T + d * PITCH - 2.5}
              width={CELL + 5}
              height={CELL + 5}
              rx={2}
              fill="none"
              stroke="var(--ed-ink)"
              strokeWidth={1}
              shapeRendering="geometricPrecision"
            />
          ) : null,
        ),
      )}
    </svg>
  );
}

export default ContributionHeatmap;
