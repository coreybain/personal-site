/**
 * lib/days.ts — calendar-day label arithmetic, defined once.
 *
 * Everything the pipelines compute is keyed on a **`YYYY-MM-DD` label, not an
 * instant**. That is the contract's own choice, set out in the header of
 * schema.ts: a contribution calendar cell, an `aiUsageDays` row and a
 * `healthDays` row are all "a day", and a day has no timezone offset because it
 * is a label rather than a moment. The producing edge owns that label: Git and
 * AI usage use UTC; HealthKit uses the user's local calendar day.
 *
 * The three definitions below are what that choice reduces to in code. They
 * lived in both gitStats.ts and snapshotBuild.ts, byte-identical, because the
 * two modules were written in parallel. That duplication was not harmless:
 * `gitStats` builds the calendar and `snapshotBuild` folds the ingest tables
 * against it, so a change to either module's notion of "which day is this" that
 * did not land in the other would show up as a Snapshot whose AI numbers are
 * keyed one day off its heatmap — a mismatch that no type would catch and that
 * looks like a data problem rather than a code one.
 *
 * ── Why the arithmetic uses UTC ───────────────────────────────────────────
 *
 * GitHub's `contributionsCollection` returns its calendar in UTC dates, and the
 * Collector already reduces local session timestamps to UTC days before they are
 * pushed (see `utcDay` in tooling/collector/sessions.ts). Converting either one
 * into local time here would put those two feeds on different calendars. The
 * HealthKit edge deliberately produces local-day labels because daily movement
 * is meaningful in the user's calendar. Once a label reaches this package, we
 * never timezone-convert it: UTC midnight below is only an unambiguous way to
 * add or subtract whole labels without daylight-saving gaps.
 *
 * These are deliberately the *only* date helpers in this package. Anything
 * needing more than "which UTC day is this instant" or "which label is next"
 * — a difference in days, a window boundary — composes them locally, next to the
 * rule it is expressing, rather than growing this file into a date library.
 */

/** Milliseconds in a whole day. Exact: no leap seconds exist in UTC epoch time. */
export const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` for an epoch-millisecond instant, in UTC. */
export function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** A `YYYY-MM-DD` label mapped to UTC midnight solely for whole-day arithmetic. */
export function dayMs(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}
