/**
 * sydneyTime.ts — the preview area's one time zone.
 *
 * Every schedule is set and shown in Sydney time (docs/plans/preview-area.md),
 * whatever zone the browser or server is in. Convex stores UTC instants; these
 * helpers convert at the edge. Daylight saving is handled by `Intl`, so "9:00"
 * on either side of a DST change means 9:00 on the clock in Sydney.
 */

export const SYDNEY = "Australia/Sydney";

const PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: SYDNEY,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

/** Sydney's UTC offset at an instant, in minutes (600 for AEST, 660 for AEDT). */
function offsetMinutes(instant: number): number {
  const parts = Object.fromEntries(PARTS.formatToParts(new Date(instant)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return Math.round((asUtc - Math.floor(instant / 60_000) * 60_000) / 60_000);
}

/**
 * `2026-10-03`, `09:00` (a Sydney wall-clock time) → the UTC ISO instant.
 * Returns null for malformed input. During the hour that does not exist when
 * clocks go forward, the time moves forward by the gap, as clocks do; during
 * the hour that happens twice when they go back, the later (standard-time)
 * occurrence is used.
 */
export function sydneyToUtc(date: string, time: string): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  const wall = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]);
  if (!Number.isFinite(wall)) return null;
  // Two passes settle the offset across a DST boundary.
  let instant = wall - offsetMinutes(wall) * 60_000;
  instant = wall - offsetMinutes(instant) * 60_000;
  return new Date(instant).toISOString();
}

/** The Sydney date and time of an instant, for prefilling the schedule inputs. */
export function sydneyInputs(iso: string): { date: string; time: string } {
  const parts = Object.fromEntries(PARTS.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

const DISPLAY = new Intl.DateTimeFormat("en-AU", {
  timeZone: SYDNEY,
  weekday: "short", day: "numeric", month: "short",
  hour: "numeric", minute: "2-digit", timeZoneName: "short",
});

/** `Fri 3 Oct, 9:00 am AEST`. */
export function formatSydney(iso: string): string {
  return DISPLAY.format(new Date(iso)).replace(/\s+/g, " ");
}
