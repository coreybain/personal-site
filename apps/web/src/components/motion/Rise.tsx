"use client";

import * as m from "motion/react-m";
import type { CSSProperties, ReactNode } from "react";

/**
 * `--hor-ease` from @home/ui tokens, as motion's four control points. Kept in
 * step with the stylesheet by hand — there is one curve on this site and this
 * is it, so a motion entrance sitting next to a CSS entrance reads as one move.
 */
const HOR_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** Seconds. Matches the `hor-rise` keyframe duration exactly. */
const HOR_RISE_DURATION = 0.85;

/** Pixels. Matches the `hor-rise` keyframe travel exactly. */
const HOR_RISE_TRAVEL = 12;

export type RiseProps = {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Hold before the entrance starts, in milliseconds. Mirrors `--hor-delay`. */
  delayMs?: number;
  /**
   * Travel as well as fade. Turn it off for anything the stylesheet has already
   * placed with a `transform` — motion writes `transform` inline, and inline
   * wins, so a lift would silently discard the CSS one.
   */
  lift?: boolean;
};

/**
 * The site's entrance, expressed in motion instead of CSS.
 *
 * This is the `m` half of ADR 013: `m` carries no features of its own, so the
 * component costs ~5 kB until `MotionProvider` has loaded `domAnimation` after
 * paint. It must render beneath that provider — outside it, nothing animates.
 *
 * **Not for content.** `hor-rise` in horizon.css runs off the stylesheet, at
 * first paint, with no JavaScript in the path; it stays the entrance for
 * everything the page is actually about. An entrance driven from here cannot
 * begin until hydration *and* the feature chunk have landed, which is a real
 * LCP cost and a real flash-of-empty risk. So it is reserved for decorative
 * chrome, where arriving a beat late is invisible.
 *
 * Reduced motion needs no handling here: `MotionConfig reducedMotion="user"`
 * upstream drops the transform and keeps the fade.
 */
export function Rise({
  children,
  className,
  style,
  delayMs = 0,
  lift = true,
}: RiseProps) {
  return (
    <m.div
      className={className}
      style={style}
      initial={{ opacity: 0, ...(lift ? { y: HOR_RISE_TRAVEL } : null) }}
      animate={{ opacity: 1, ...(lift ? { y: 0 } : null) }}
      transition={{
        duration: HOR_RISE_DURATION,
        ease: HOR_EASE,
        delay: delayMs / 1000,
      }}
    >
      {children}
    </m.div>
  );
}
