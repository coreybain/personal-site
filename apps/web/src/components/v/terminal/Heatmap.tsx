import type { ContributionWeek } from "@/lib/snapshot";
import { group, isoMonthShort, isoToStamp } from "./format";

type MonthSpan = { key: string; label: string; span: number };

/** Collapse the 52 columns into month runs so labels can sit above the grid. */
function monthSpans(weeks: ContributionWeek[]): MonthSpan[] {
  const spans: MonthSpan[] = [];
  for (const week of weeks) {
    const iso = week[0].date;
    const key = iso.slice(0, 7);
    const last = spans[spans.length - 1];
    if (last && last.key === key) {
      last.span += 1;
    } else {
      spans.push({ key, label: isoMonthShort(iso), span: 1 });
    }
  }
  return spans;
}

const RAMP = [
  "var(--obs-l0)",
  "var(--obs-l1)",
  "var(--obs-l2)",
  "var(--obs-l3)",
  "var(--obs-l4)",
];

export function Heatmap({
  weeks,
  total,
}: {
  weeks: ContributionWeek[];
  total: number;
}) {
  const spans = monthSpans(weeks);
  const first = weeks[0][0].date;
  const last = weeks[weeks.length - 1][6].date;

  return (
    <div className="obs-hm-wrap">
      <div className="obs-hm-scroll">
        <div className="obs-hm-months" aria-hidden="true">
          {spans.map((s, i) => (
            <span
              key={s.key}
              className="obs-hm-month"
              style={{ gridColumn: `span ${s.span}` }}
            >
              {/* A one- or two-week sliver at either end has no room for a label. */}
              {s.span >= 3 || (i > 0 && i < spans.length - 1 && s.span >= 2)
                ? s.label
                : ""}
            </span>
          ))}
        </div>

        <div
          className="obs-hm"
          role="img"
          aria-label={`Contribution heatmap: ${group(
            total,
          )} contributions across the 52 weeks from ${isoToStamp(
            first,
          )} to ${isoToStamp(last)}.`}
        >
          {weeks.map((week, w) =>
            week.map((day) => (
              <span
                key={day.date}
                className="obs-cell"
                data-l={day.level}
                style={{ ["--c" as string]: w }}
                title={`${day.date} · ${day.count} contribution${
                  day.count === 1 ? "" : "s"
                }`}
              />
            )),
          )}
        </div>
      </div>

      <div className="obs-hm-foot">
        <span className="obs-label">
          {isoToStamp(first)} — {isoToStamp(last)}
        </span>
        <div className="obs-legend" aria-hidden="true">
          <span className="obs-label">Less</span>
          {RAMP.map((c, i) => (
            <span
              key={i}
              className="obs-legend-sw"
              style={{
                background: c,
                boxShadow:
                  i === 4
                    ? "0 0 7px hsl(46 100% 70% / 0.55)"
                    : i === 3
                      ? "0 0 5px hsl(40 90% 54% / 0.35)"
                      : undefined,
              }}
            />
          ))}
          <span className="obs-label">More</span>
        </div>
      </div>
    </div>
  );
}
