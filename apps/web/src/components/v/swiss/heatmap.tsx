import type { ContributionWeek } from "@/lib/snapshot";
import { group, monthIndex, monthShort } from "./format";

/* Grid geometry, in SVG user units. The <svg> scales fluidly but its
 * aspect ratio is locked, so the widget never shifts the layout. */
const CELL = 12;
const GAP = 3;
const PITCH = CELL + GAP;
const ROWS = 7;
const H = ROWS * PITCH - GAP;

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function Heatmap({
  weeks,
  total,
}: {
  weeks: ContributionWeek[];
  total: number;
}) {
  const cols = weeks.length;
  const W = cols * PITCH - GAP;

  // One label per month change, positioned as a fraction of the grid width.
  const months: { key: string; label: string; left: number }[] = [];
  let last = -1;
  weeks.forEach((week, i) => {
    const m = monthIndex(week[0].date);
    if (m !== last) {
      last = m;
      if (i > 0 && i < cols - 2) {
        months.push({
          key: week[0].date,
          label: monthShort(week[0].date),
          left: ((i * PITCH) / W) * 100,
        });
      }
    }
  });

  return (
    <div>
      <div className="sw-cal-months sw-mono sw-mute">
        {months.map((m) => (
          <span key={m.key} style={{ left: `${m.left}%` }}>
            {m.label}
          </span>
        ))}
      </div>

      <svg
        className="sw-cal"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Contribution calendar: ${group(
          total,
        )} contributions across the last ${cols} weeks.`}
      >
        {weeks.map((week, w) =>
          week.map((day, d) => (
            <rect
              key={day.date}
              x={w * PITCH}
              y={d * PITCH}
              width={CELL}
              height={CELL}
              fill={`var(--sw-l${day.level})`}
            >
              <title>{`${day.count} on ${DAY_NAMES[d]} ${day.date}`}</title>
            </rect>
          )),
        )}
      </svg>
    </div>
  );
}

export function HeatmapLegend() {
  return (
    <div className="flex items-center gap-2">
      <span className="sw-mono sw-mute">Less</span>
      <div className="flex gap-[3px]">
        {[0, 1, 2, 3, 4].map((l) => (
          <span
            key={l}
            className="sw-swatch"
            style={{ background: `var(--sw-l${l})` }}
          />
        ))}
      </div>
      <span className="sw-mono sw-mute">More</span>
    </div>
  );
}
