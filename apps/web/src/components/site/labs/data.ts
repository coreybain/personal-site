import type { Lab } from "@/lib/snapshot";
import { snapshot } from "@/lib/snapshot";

/**
 * Derived reads for /labs. Every number here comes out of `snapshot.labs` —
 * nothing on this page is written by hand.
 *
 * The page's whole argument is that a personal repo is measured by *movement*,
 * not by stars, so the ordering and the ramp are both keyed off recency.
 */

/** Weeks in the trailing window `liveStats.commitsYear` is counted over. */
export const WEEKS = 52;

/** Most recently pushed first; commits break a tie. Never mutates the source. */
export const labs: Lab[] = [...snapshot.labs].sort(
  (a, b) =>
    a.liveStats.lastPushDaysAgo - b.liveStats.lastPushDaysAgo ||
    b.liveStats.commitsYear - a.liveStats.commitsYear,
);

export const totalCommits = labs.reduce((n, l) => n + l.liveStats.commitsYear, 0);
export const totalStars = labs.reduce((n, l) => n + l.liveStats.stars, 0);
export const totalForks = labs.reduce((n, l) => n + l.liveStats.forks, 0);

export const maxCommits = Math.max(...labs.map((l) => l.liveStats.commitsYear));

/** The freshest repo — the one the recency panel points at. */
export const freshest = labs[0];
export const stalest = labs[labs.length - 1];
export const featuredCount = labs.filter((l) => l.featured).length;

/** Distinct primary languages, in recency order. */
export const languages = [...new Set(labs.map((l) => l.language))];

/** The recency axis runs 0 → a whole number of weeks, never shorter than one. */
export const axisMax = Math.max(7, Math.ceil(stalest.liveStats.lastPushDaysAgo / 7) * 7);
export const axisTicks = Array.from({ length: axisMax / 7 + 1 }, (_, i) => i * 7);

/** Commits a week, averaged over the trailing window. */
export function cadence(lab: Lab): number {
  return lab.liveStats.commitsYear / WEEKS;
}

export const combinedCadence = totalCommits / WEEKS;

/**
 * Recency band, 0 (hot) → 3 (cold). Maps onto the shared `--hor-l1…l4` ramp,
 * so a fresh push reads amber exactly like a peak day on the homepage heatmap.
 */
export function band(daysAgo: number): 0 | 1 | 2 | 3 {
  if (daysAgo <= 1) return 0;
  if (daysAgo <= 7) return 1;
  if (daysAgo <= 21) return 2;
  return 3;
}

/** `0 → 'active today'`, otherwise `'active 12d ago'`. */
export function activePhrase(daysAgo: number): string {
  return daysAgo <= 0 ? "active today" : `active ${daysAgo}d ago`;
}

/** Position along the recency axis, 0 (today) → 1 (axis end). */
export function axisPos(daysAgo: number): number {
  return Math.min(1, daysAgo / axisMax);
}

export function repoUrl(lab: Lab): string {
  return `https://github.com/${lab.repoFullName}`;
}
