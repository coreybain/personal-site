"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";

import type { TocEntry } from "@/lib/markdown";

/**
 * "On this page" — the post's outline, with a rail that tracks the reader.
 *
 * ── The rail ───────────────────────────────────────────────────────────────
 *
 * A hairline runs down the left of the list and steps right wherever an `h3`
 * sits under its `h2`, so the line itself draws the outline's shape. Over it, an
 * accent segment covers every section currently on screen: it grows as the next
 * heading scrolls in, shrinks as the last one scrolls out, and follows the same
 * jogs as the hairline because it is the hairline, masked.
 *
 * The geometry comes from the rendered links (their `offsetTop`/`offsetHeight`
 * inside the list), so wrapped titles and font loading are measured rather than
 * assumed. A `ResizeObserver` on the list re-measures on any of those, and on
 * the mobile panel opening. The path is built once per measurement; scrolling
 * only moves the segment's `top` and `height`, which CSS transitions.
 *
 * ── Without JavaScript ─────────────────────────────────────────────────────
 *
 * The list is plain `#id` links rendered on the server, so the contents work
 * before hydration and without it. The rail is drawn only once measured.
 */

/** Distance the fixed nav pill covers at the top of the viewport. */
const TOP_INSET = 96;

/** Where the rail sits for each depth, in px from the list's left edge. */
const RAIL_X: Record<TocEntry["depth"], number> = { 2: 1, 3: 11 };
const RAIL_WIDTH = 12;

type Rail = {
  d: string;
  height: number;
  /** Each link's vertical extent inside the list. */
  spans: { top: number; bottom: number }[];
};

/**
 * The on-screen sections. When none are (above the first heading, below the
 * last), the previous `first`/`last` are kept with `visible: false`, so the
 * segment shrinks where it was instead of sliding back to the top.
 */
type Range = { first: number; last: number; visible: boolean };

const NOTHING: Range = { first: 0, last: 0, visible: false };

function railPath(entries: TocEntry[], links: HTMLAnchorElement[]): Rail {
  const spans = links.map((link) => ({
    top: link.offsetTop,
    bottom: link.offsetTop + link.offsetHeight,
  }));

  let d = "";
  spans.forEach(({ top, bottom }, i) => {
    const x = RAIL_X[entries[i].depth];
    if (i === 0) {
      d += `M${x} ${top}`;
    } else if (x !== RAIL_X[entries[i - 1].depth]) {
      // The step between depths: a short diagonal into the new column.
      d += ` L${x} ${top + 8}`;
    }
    d += ` L${x} ${bottom}`;
  });

  return { d, height: spans.at(-1)?.bottom ?? 0, spans };
}

/** The sections whose extent overlaps the part of the viewport being read. */
function visibleRange(
  headings: HTMLElement[],
  end: number,
): { first: number; last: number } | null {
  const top = TOP_INSET;
  const bottom = window.innerHeight * 0.9;

  let first = -1;
  let last = -1;
  headings.forEach((heading, i) => {
    const start = heading.getBoundingClientRect().top;
    const stop =
      i < headings.length - 1
        ? headings[i + 1].getBoundingClientRect().top
        : end;

    if (stop > top && start < bottom) {
      if (first === -1) first = i;
      last = i;
    }
  });

  return first === -1 ? null : { first, last };
}

function nextRange(current: Range, seen: { first: number; last: number } | null): Range {
  if (seen === null) return current.visible ? { ...current, visible: false } : current;
  if (current.visible && current.first === seen.first && current.last === seen.last) {
    return current;
  }
  return { ...seen, visible: true };
}

export function PostToc({ toc }: { toc: TocEntry[] }) {
  const listRef = useRef<HTMLOListElement>(null);
  const [rail, setRail] = useState<Rail | null>(null);
  const [range, setRange] = useState<Range>(NOTHING);
  const [open, setOpen] = useState(false);
  const listId = useId();

  // Measure the rail from the rendered links.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const observer = new ResizeObserver(() => {
      const links = Array.from(list.querySelectorAll<HTMLAnchorElement>("a"));
      // Hidden (the closed mobile panel): nothing to measure yet.
      if (list.offsetHeight === 0 || links.length !== toc.length) return;
      setRail(railPath(toc, links));
    });

    observer.observe(list);
    return () => observer.disconnect();
  }, [toc]);

  // Track which sections are on screen.
  useEffect(() => {
    const headings = toc
      .map(({ id }) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (headings.length !== toc.length) return;

    // The last section runs to the end of the post body, not the page.
    const body = headings[0].parentElement;
    let frame = 0;

    const update = () => {
      frame = 0;
      const end = body?.getBoundingClientRect().bottom ?? Infinity;
      const seen = visibleRange(headings, end);
      setRange((current) => nextRange(current, seen));
    };

    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };

    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [toc]);

  const thumbTop = rail?.spans[range.first]?.top ?? 0;
  const thumbHeight =
    rail && range.visible ? (rail.spans[range.last]?.bottom ?? thumbTop) - thumbTop : 0;

  const mask = rail
    ? `url("data:image/svg+xml,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${RAIL_WIDTH} ${rail.height}"><path d="${rail.d}" stroke="black" stroke-width="2" fill="none"/></svg>`,
      )}")`
    : undefined;

  return (
    <nav className="blog-toc" aria-label="On this page" data-open={open}>
      <p className="blog-aside-label blog-toc-label">On this page</p>
      <button
        type="button"
        className="blog-aside-label blog-toc-toggle"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
      >
        On this page
        <span className="hor-mono blog-toc-count">{toc.length}</span>
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
          <path
            d="M2.5 4l3 3 3-3"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <div className="blog-toc-body" id={listId}>
        <ol ref={listRef} className="blog-toc-list">
          {rail ? (
            <>
              <svg
                className="blog-toc-rail"
                width={RAIL_WIDTH}
                height={rail.height}
                viewBox={`0 0 ${RAIL_WIDTH} ${rail.height}`}
                aria-hidden="true"
              >
                <path d={rail.d} fill="none" />
              </svg>
              <div
                className="blog-toc-rail blog-toc-rail-active"
                style={{
                  width: RAIL_WIDTH,
                  height: rail.height,
                  maskImage: mask,
                  WebkitMaskImage: mask,
                }}
                aria-hidden="true"
              >
                <div
                  className="blog-toc-thumb"
                  style={
                    {
                      "--toc-top": `${thumbTop}px`,
                      "--toc-height": `${thumbHeight}px`,
                    } as CSSProperties
                  }
                />
              </div>
            </>
          ) : null}

          {toc.map((entry, i) => {
            const active = range.visible && i >= range.first && i <= range.last;
            return (
              <li key={entry.id}>
                <a
                  href={`#${entry.id}`}
                  className="blog-toc-link"
                  data-depth={entry.depth}
                  data-active={active}
                  aria-current={active && i === range.first ? "location" : undefined}
                >
                  {entry.text}
                </a>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
