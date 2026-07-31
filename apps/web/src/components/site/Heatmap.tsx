"use client";

import {
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { createPortal } from "react-dom";

import type {
  ContributionDay,
  ContributionProject,
  ContributionWeek,
} from "@/lib/snapshot";

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
const TOOLTIP_HALF = 98;
const TOOLTIP_MARGIN = 12;

/*
 * Tooltip height is *estimated*, not measured, because it is needed one frame
 * before the tooltip exists: `showTooltip` decides above-or-below from the
 * cell's rect at pointer-enter, and the element it is sizing has not rendered.
 * Measuring would mean render-then-reposition, i.e. a visible jump.
 *
 * So these three numbers stand in for the CSS, and they are the one place in
 * this component that has to be kept in step with `horizon.css` by hand. They
 * are deliberately slight over-estimates: guessing too tall places the tooltip
 * below when it would just barely have fitted above, which is invisible;
 * guessing too short places it above and lets it run off the top of the
 * viewport, which is not.
 */
/** Head + total row + padding — a popup with no breakdown, as it always was. */
const TOOLTIP_BASE_HEIGHT = 72;
/** The hairline rule above the breakdown, plus the air either side of it. */
const TOOLTIP_SPLIT_HEAD = 10;
/** One `Name … n` line of the breakdown. */
const TOOLTIP_SPLIT_ROW = 17;

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

/**
 * Shown when a day's commits could not be attributed to a public project.
 *
 * `project` is `null` for most days by design, not by omission: the git pipeline
 * only names a repo when a curated, *public* Lab accounts for a strict majority
 * of that day's contributions, because the count includes private work that
 * ADR 008 forbids naming. Roughly 290 of 364 cells are `null` on a normal week.
 *
 * Exported as a constant because it is needed in two places — the visible
 * tooltip and the accessible name — and having them written out separately is
 * exactly how they drifted: the tooltip handled `null` and the `aria-label` did
 * not, so screen-reader users heard "null · 18 commits · Mon 4 Aug 2025" on
 * every unattributed cell while sighted users saw the correct text.
 */
const NO_PROJECT_LABEL = "No project activity";

/**
 * How many named projects the popup prints before it starts counting the rest.
 *
 * The mock never exceeds three and a real day rarely does either, so this is a
 * ceiling rather than a routine truncation — but it is a *fixed* ceiling, which
 * is what keeps the estimated height above honest and stops one freak day from
 * rendering a popup taller than the viewport.
 */
const BREAKDOWN_LIMIT = 4;

type Breakdown = {
  /** The rows the popup prints, largest first. Empty ⇒ print no breakdown. */
  shown: ContributionProject[];
  /** Projects folded into the trailing "+N more" row. `0` when all of them fit. */
  hidden: number;
};

/**
 * The single source of the breakdown, read by all three consumers — the visible
 * list, the estimated height, and the accessible name.
 *
 * That is not tidiness, it is the fix for a bug this file has already had once:
 * the tooltip and the `aria-label` were written out separately, the tooltip
 * learned to handle `null` and the label did not, and screen-reader users heard
 * "null · 18 commits" on every unattributed cell for a release. A breakdown is
 * more moving parts than a nullable string — a cap, an overflow count, an empty
 * case — so it is derived once here and never re-derived at a call site.
 *
 * `byProject` is defaulted rather than trusted. The type says it is always an
 * array and `mapGitStats` guarantees it for the live snapshot, but this runs in
 * the browser against JSON that was serialised by a different process on a
 * different deploy: a stored row written before the field existed reaches this
 * function as `undefined`, and `undefined.slice` in a client component blanks
 * the section rather than degrading it.
 */
function breakdownOf(day: ContributionDay): Breakdown {
  const byProject = day.byProject ?? [];
  const shown = byProject.slice(0, BREAKDOWN_LIMIT);
  return { shown, hidden: byProject.length - shown.length };
}

function commitCount(count: number): string {
  return `${num(count)} commit${count === 1 ? "" : "s"}`;
}

/** Estimated rendered height, for the above-or-below decision. See the constants. */
function tooltipHeight(day: ContributionDay): number {
  const { shown, hidden } = breakdownOf(day);
  if (shown.length === 0) return TOOLTIP_BASE_HEIGHT;

  const rows = shown.length + (hidden > 0 ? 1 : 0);
  return TOOLTIP_BASE_HEIGHT + TOOLTIP_SPLIT_HEAD + rows * TOOLTIP_SPLIT_ROW;
}

/**
 * The cell's accessible name — what a screen reader announces on arrow-key
 * navigation, and the only form of the popup a keyboard-only user gets.
 *
 * It carries the breakdown, because "which projects, how many each" is the
 * whole point of the popup and an accessible name that omitted it would make
 * the feature sighted-only. It carries the breakdown *tersely*: separators
 * rather than sentences, the same cap as the visible list, no "attributed to"
 * or "on this day". Thirty-odd cells are traversed per journey across this
 * grid; a label that reads well once reads like an essay by the fourth.
 */
function cellTitle(day: ContributionDay): string {
  if (day.count === 0) return `No commits · ${longDate(day.date)}`;

  const { shown, hidden } = breakdownOf(day);

  // No breakdown — a day the producer could not attribute, or a stored snapshot
  // predating the field. Word for word what this label said before `byProject`
  // existed, so the absent case is a non-event rather than a regression.
  if (shown.length === 0) {
    return `${day.project ?? NO_PROJECT_LABEL} · ${commitCount(day.count)} · ${longDate(day.date)}`;
  }

  // "18 commits: QuoteCloud 12, TravelDocs 4, Other work 2 · Mon 4 Aug 2025".
  // The colon is doing real work: it tells a listener the list about to arrive
  // is a decomposition of the number just read, not a second set of numbers.
  const parts = shown.map((entry) => `${entry.name} ${num(entry.commits)}`);
  if (hidden > 0) parts.push(`and ${num(hidden)} more`);

  return `${commitCount(day.count)}: ${parts.join(", ")} · ${longDate(day.date)}`;
}

type ActiveCell = {
  day: ContributionDay;
  index: number;
  x: number;
  y: number;
  placement: "top" | "bottom";
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function Heatmap({
  weeks,
  peak,
}: {
  weeks: ContributionWeek[];
  /** ISO date of the busiest day; it gets a ring so the eye lands on it. */
  peak?: string;
}) {
  const tooltipId = useId();
  const cellRefs = useRef<Array<SVGRectElement | null>>([]);
  const days = weeks.flat();
  const firstActiveIndex = Math.max(
    0,
    days.findIndex((day) => day.count > 0),
  );
  const [focusIndex, setFocusIndex] = useState(firstActiveIndex);
  const [active, setActive] = useState<ActiveCell | null>(null);
  const width = LEFT + weeks.length * PITCH - GAP;
  const height = TOP + ROWS * PITCH - GAP;
  const ticks = monthTicks(weeks);
  /*
   * Derived during render rather than stored alongside `active`, because it is
   * a pure function of the active day: a second state field would be a second
   * thing that can fall out of step with the first. It is one `slice` of an
   * array of at most a handful of entries, once per hover — memoising it would
   * cost more than it saves.
   */
  const breakdown = active ? breakdownOf(active.day) : null;
  const namedProjects = breakdown ? breakdown.shown.length + breakdown.hidden : 0;

  const showTooltip = (
    day: ContributionDay,
    index: number,
    element: SVGRectElement,
  ) => {
    if (day.count === 0) {
      setActive(null);
      return;
    }

    const cellBounds = element.getBoundingClientRect();
    const svgBounds = element.ownerSVGElement?.getBoundingClientRect() ?? cellBounds;
    const viewportMin = TOOLTIP_HALF + TOOLTIP_MARGIN;
    const viewportMax = window.innerWidth - TOOLTIP_HALF - TOOLTIP_MARGIN;
    const panelMin = svgBounds.left + TOOLTIP_HALF;
    const panelMax = svgBounds.right - TOOLTIP_HALF;
    const minX = Math.max(viewportMin, panelMin);
    const maxX = Math.min(viewportMax, panelMax);
    const desiredX = cellBounds.left + cellBounds.width / 2;
    const x =
      minX <= maxX
        ? clamp(desiredX, minX, maxX)
        : clamp(desiredX, viewportMin, viewportMax);
    // Measured per day, not per component: a day that breaks down across three
    // projects is materially taller than one that does not, and a fixed guess
    // would flip a tall popup above a cell it cannot fit above.
    const estimatedHeight = tooltipHeight(day);
    const hasRoomAbove = cellBounds.top >= estimatedHeight + TOOLTIP_MARGIN;
    const hasRoomBelow =
      window.innerHeight - cellBounds.bottom >= estimatedHeight + TOOLTIP_MARGIN;
    const placement = hasRoomAbove || !hasRoomBelow ? "top" : "bottom";

    setActive({
      day,
      index,
      x,
      y: placement === "top" ? cellBounds.top : cellBounds.bottom,
      placement,
    });
  };

  const focusCell = (index: number) => {
    const nextIndex = clamp(index, 0, days.length - 1);
    setFocusIndex(nextIndex);
    cellRefs.current[nextIndex]?.focus();
  };

  const onCellKeyDown = (event: KeyboardEvent<SVGRectElement>, index: number) => {
    let nextIndex: number | null = null;

    if (event.key === "ArrowLeft") nextIndex = index - ROWS;
    if (event.key === "ArrowRight") nextIndex = index + ROWS;
    if (event.key === "ArrowUp") nextIndex = index - 1;
    if (event.key === "ArrowDown") nextIndex = index + 1;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = days.length - 1;

    if (event.key === "Escape") {
      event.preventDefault();
      setActive(null);
      return;
    }

    if (nextIndex === null) return;
    event.preventDefault();
    focusCell(nextIndex);
  };

  return (
    <>
      <svg
        className="hor-heat"
        viewBox={`0 0 ${width} ${height}`}
        role="group"
        aria-label={`Contribution activity heatmap: ${weeks.length} weeks by seven days, Sunday to Saturday. Use arrow keys to inspect days.`}
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
            {week.map((day, row) => {
              const index = col * ROWS + row;

              return (
                <rect
                  key={day.date}
                  ref={(element) => {
                    cellRefs.current[index] = element;
                  }}
                  className={`hor-cell ${LEVEL_CLASS[day.level]}`}
                  x={LEFT + col * PITCH}
                  y={TOP + row * PITCH}
                  width={CELL}
                  height={CELL}
                  rx={2.5}
                  role="img"
                  tabIndex={index === focusIndex ? 0 : -1}
                  aria-label={cellTitle(day)}
                  aria-describedby={active?.index === index ? tooltipId : undefined}
                  onPointerEnter={(event: PointerEvent<SVGRectElement>) =>
                    showTooltip(day, index, event.currentTarget)
                  }
                  onPointerLeave={(event) => {
                    if (document.activeElement !== event.currentTarget) setActive(null);
                  }}
                  onFocus={(event) => {
                    setFocusIndex(index);
                    showTooltip(day, index, event.currentTarget);
                  }}
                  onBlur={() => setActive(null)}
                  onKeyDown={(event) => onCellKeyDown(event, index)}
                />
              );
            })}

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

      {active && typeof document !== "undefined"
        ? createPortal(
            <div
              id={tooltipId}
              className="hor-heat-tooltip"
              role="tooltip"
              data-placement={active.placement}
              style={
                {
                  "--hor-tip-x": `${active.x}px`,
                  "--hor-tip-y": `${active.y}px`,
                } as CSSProperties
              }
            >
              <span className="hor-heat-tooltip-head">
                <span className="hor-heat-tooltip-date">
                  {longDate(active.day.date)}
                </span>
                {active.day.date === peak ? (
                  <span className="hor-heat-tooltip-peak">
                    <i aria-hidden="true" />
                    Busiest day
                  </span>
                ) : null}
              </span>
              {/*
                The total row keeps its geometry in both states — the big
                number on the right never moves — and only its left slot
                changes meaning.

                With a breakdown, the left slot states the *scope* ("3
                projects") and the names live in the list below, so no name is
                printed twice. Without one it falls back to the single label
                this popup has always shown, which is what makes an absent or
                empty `byProject` render as the old popup exactly rather than
                as a broken new one.
              */}
              <span className="hor-heat-tooltip-row">
                {breakdown && breakdown.shown.length > 0 ? (
                  <span className="hor-heat-tooltip-project is-scope">
                    {`${num(namedProjects)} project${namedProjects === 1 ? "" : "s"}`}
                  </span>
                ) : (
                  <span className="hor-heat-tooltip-project">
                    <i aria-hidden="true" />
                    {active.day.project ?? NO_PROJECT_LABEL}
                  </span>
                )}
                <strong>
                  {num(active.day.count)}
                  <small>{active.day.count === 1 ? "commit" : "commits"}</small>
                </strong>
              </span>

              {/*
                The breakdown itself. `aria-hidden`, and deliberately so: the
                cell already carries all of this in its accessible name, and
                `aria-describedby` would make a screen reader read the day
                twice — once as the label, once as the description. Sighted
                users get the list, everyone gets the content.

                A list element rather than rows of spans because it *is* a
                list, and one whose length varies between one and five.
              */}
              {breakdown && breakdown.shown.length > 0 ? (
                <ul className="hor-heat-tooltip-split" aria-hidden="true">
                  {breakdown.shown.map((entry) => (
                    <li key={entry.name}>
                      <span>{entry.name}</span>
                      <b>{num(entry.commits)}</b>
                    </li>
                  ))}
                  {breakdown.hidden > 0 ? (
                    <li className="is-rest">
                      <span>{`+${num(breakdown.hidden)} more`}</span>
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </div>,
            document.querySelector(".hor") ?? document.body,
          )
        : null}
    </>
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
