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
const TOOLTIP_HALF = 98;
const TOOLTIP_HEIGHT = 72;
const TOOLTIP_MARGIN = 12;

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

function cellTitle(day: ContributionDay): string {
  return day.count === 0
    ? `No commits · ${longDate(day.date)}`
    : `${day.project ?? NO_PROJECT_LABEL} · ${num(day.count)} commit${day.count === 1 ? "" : "s"} · ${longDate(day.date)}`;
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
    const hasRoomAbove = cellBounds.top >= TOOLTIP_HEIGHT + TOOLTIP_MARGIN;
    const hasRoomBelow =
      window.innerHeight - cellBounds.bottom >= TOOLTIP_HEIGHT + TOOLTIP_MARGIN;
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
              <span className="hor-heat-tooltip-row">
                <span className="hor-heat-tooltip-project">
                  <i aria-hidden="true" />
                  {active.day.project ?? NO_PROJECT_LABEL}
                </span>
                <strong>
                  {num(active.day.count)}
                  <small>{active.day.count === 1 ? "commit" : "commits"}</small>
                </strong>
              </span>
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
