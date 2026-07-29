/**
 * Derived numbers for /resume.
 *
 * Every value here is computed from `@/lib/snapshot` at module load — nothing is
 * typed by hand. If the snapshot moves, this page moves with it.
 */

import { snapshot } from "@/lib/snapshot";

const { identity, gitStats, aiUsage, resumeDocument, computedAt } = snapshot;

export { identity, gitStats, aiUsage, resumeDocument, computedAt };

/* ---- calendar --------------------------------------------------------- */

export const weekCount = gitStats.calendar.length;
export const days = gitStats.calendar.flat();
export const firstDay = gitStats.calendar[0][0].date;
export const lastDay = gitStats.calendar[weekCount - 1][6].date;

export const activeDays = days.filter((day) => day.count > 0).length;
export const coveragePct = Math.round((activeDays / days.length) * 100);

/** One total per column — the cadence sparkline reads straight off this. */
export const weeklyTotals: number[] = gitStats.calendar.map((week) =>
  week.reduce((sum, day) => sum + day.count, 0),
);

export const peakWeekTotal = Math.max(...weeklyTotals);
export const peakWeekIndex = weeklyTotals.indexOf(peakWeekTotal);
export const peakWeekStart = gitStats.calendar[peakWeekIndex][0].date;

export const perWeek = Math.round(gitStats.totalContributionsYear / weekCount);
export const privatePct = Math.round(
  (gitStats.privateContributions / gitStats.totalContributionsYear) * 100,
);

/* ---- agents ----------------------------------------------------------- */

export const sessionsPerWeek = Math.round(aiUsage.totalSessions / weekCount);
export const avgSessionMinutes = Math.round(
  (aiUsage.totalHours * 60) / aiUsage.totalSessions,
);

/* ---- the document ----------------------------------------------------- */

/** First four digits of a free-form date string (`'2018'`, `'Mar 2018'`). */
function year(value: string): number | null {
  const match = value.match(/\d{4}/);
  return match ? Number(match[0]) : null;
}

export const snapshotYear = new Date(computedAt).getUTCFullYear();

const startYears = resumeDocument.experience
  .map((role) => year(role.start))
  .filter((value): value is number => value !== null);

export const careerStartYear = startYears.length
  ? Math.min(...startYears)
  : snapshotYear;

export const yearsShipping = Math.max(1, snapshotYear - careerStartYear);

/** Tenure in whole years; an open-ended role runs to the snapshot year. */
export function tenureYears(start: string, end: string): number {
  const from = year(start);
  const to = year(end) ?? snapshotYear;
  if (from === null) return 0;
  return Math.max(1, to - from);
}

export const companyCount = new Set(
  resumeDocument.experience.map((role) => role.company),
).size;

export const currentRole = resumeDocument.experience[0];
