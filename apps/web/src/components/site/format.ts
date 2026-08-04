/** Deterministic formatting helpers for the Horizon design system. */

const GROUPED = new Intl.NumberFormat("en-US");

export function num(n: number): string {
  return GROUPED.format(n);
}

/** Rounded percentage of `part` in `whole`, guarding a zero denominator. */
export function pct(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 100);
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** `2026-03-03` → a Date parsed as UTC, so it never drifts by a timezone. */
export function parseIso(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function monthLabel(iso: string): string {
  return MONTHS[parseIso(iso).getUTCMonth()];
}

/** `2026-03-03` → `Tue 3 Mar 2026`. */
export function longDate(iso: string): string {
  const d = parseIso(iso);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${
    MONTHS[d.getUTCMonth()]
  } ${d.getUTCFullYear()}`;
}

/** `2026-03-03` → `03 MAR 26`. Instrument stamp for the deck. */
export function stamp(iso: string): string {
  const d = parseIso(iso);
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[
    d.getUTCMonth()
  ].toUpperCase()} ${String(d.getUTCFullYear()).slice(2)}`;
}

/** `2026-07-29T06:00:00Z` → `29 JUL 2026 · 06:00 UTC`. */
export function stampTime(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[
    d.getUTCMonth()
  ].toUpperCase()} ${d.getUTCFullYear()} · ${hh}:${mm} UTC`;
}

export function relativeDays(daysAgo: number): string {
  if (daysAgo <= 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  return `${daysAgo} days ago`;
}
