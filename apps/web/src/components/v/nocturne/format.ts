/**
 * Deterministic formatting helpers for the Nocturne variant.
 *
 * Everything here is pure and locale-pinned so the server render and the client
 * hydration produce byte-identical strings — no `toLocaleString()` drift.
 */

const GROUPED = new Intl.NumberFormat("en-US");

export function num(n: number): string {
  return GROUPED.format(n);
}

/** Whole-percent share, rounded. Guards divide-by-zero. */
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

/** `2026-03-03` → a Date pinned to UTC midnight, so it never drifts a day. */
export function parseIso(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function monthLabel(iso: string): string {
  return MONTHS[parseIso(iso).getUTCMonth()];
}

/** `2026-03-03` → `3 Mar 2026`. */
export function shortDate(iso: string): string {
  const d = parseIso(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** `2026-03-03` → `Tue, 3 Mar 2026`. */
export function longDate(iso: string): string {
  const d = parseIso(iso);
  return `${WEEKDAYS[d.getUTCDay()]}, ${shortDate(iso)}`;
}

/** `2026-07-29T06:00:00Z` → `29 Jul 2026`. */
export function stampDate(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function relativeDays(daysAgo: number): string {
  if (daysAgo <= 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  return `${daysAgo} days ago`;
}

/** Inline-style helper: the stagger delay consumed by `.noc-rise`. */
export function delay(ms: number): React.CSSProperties {
  return { "--noc-delay": `${ms}ms` } as React.CSSProperties;
}
