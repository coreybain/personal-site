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
  "var(--con-l0)",
  "var(--con-l1)",
  "var(--con-l2)",
  "var(--con-l3)",
  "var(--con-l4)",
];

/** Rows are Sunday → Saturday; only alternate rows get a label. */
const DAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];

/**
 * 52 × 7 contribution grid, hand-built from `snapshot.gitStats.calendar`.
 * No chart library: one CSS grid, `grid-auto-flow: column`, one span per day.
 *
 * The cells are square via `aspect-ratio` inside a fixed-min-width scroller, so
 * the widget's height never changes — including when the theme flips, which
 * only re-resolves the five ramp variables.
 */
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
    <div className="con-hm">
      <div className="con-hm-scroll">
        <div className="con-hm-inner">
          <div className="con-hm-months" aria-hidden="true">
            {spans.map((s, i) => (
              <span
                key={s.key}
                className="con-hm-month"
                style={{ gridColumn: `span ${s.span}` }}
              >
                {/* A one-week sliver at either end has no room for a label. */}
                {s.span >= 3 || (i > 0 && i < spans.length - 1 && s.span >= 2)
                  ? s.label
                  : ""}
              </span>
            ))}
          </div>

          <div className="con-hm-days" aria-hidden="true">
            {DAY_LABELS.map((d, i) => (
              <span key={i} className="con-hm-day">
                {d}
              </span>
            ))}
          </div>

          <div
            className="con-hm-grid"
            role="img"
            aria-label={`Contribution heatmap: ${group(
              total,
            )} contributions across the 52 weeks from ${isoToStamp(
              first,
            )} to ${isoToStamp(last)}.`}
          >
            {weeks.map((week) =>
              week.map((day) => (
                <span
                  key={day.date}
                  className="con-cell"
                  data-l={day.level}
                  title={`${day.date} · ${day.count} contribution${
                    day.count === 1 ? "" : "s"
                  }`}
                />
              )),
            )}
          </div>
        </div>
      </div>

      <div className="con-hm-foot">
        <span className="con-label">
          {isoToStamp(first)} — {isoToStamp(last)}
        </span>
        <div className="con-legend" aria-hidden="true">
          <span className="con-label">Less</span>
          {RAMP.map((c, i) => (
            <span key={i} className="con-sw" style={{ background: c }} />
          ))}
          <span className="con-label">More</span>
        </div>
      </div>
    </div>
  );
}
