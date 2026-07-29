/**
 * Formatting helpers for the Editorial Ink variant.
 *
 * Everything here is deterministic: explicit locale, no `Date` parsing of
 * partial ISO strings, no `Intl` calls that depend on the runtime timezone.
 * Server render and client hydration must agree byte for byte.
 */

const MONTHS_SHORT = [
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

const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** `6434` → `"6,434"`. Locale pinned so SSR and hydration match. */
export function num(n: number): string {
  return n.toLocaleString("en-US");
}

/** `8.2` → `"8.2"`, `12480` → `"12,480"`. */
export function decimal(n: number, places = 1): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
}

/** Zero-indexed month from a `YYYY-MM-DD` string, without constructing a Date. */
export function monthIndex(iso: string): number {
  return Number(iso.slice(5, 7)) - 1;
}

export function year(iso: string): string {
  return iso.slice(0, 4);
}

/** `"2025-08-03"` → `"Aug 2025"`. */
export function monthYear(iso: string): string {
  return `${MONTHS_SHORT[monthIndex(iso)]} ${year(iso)}`;
}

export function monthShort(iso: string): string {
  return MONTHS_SHORT[monthIndex(iso)];
}

/** `"2026-07-29"` → `"29 July 2026"`. */
export function longDate(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${MONTHS_LONG[monthIndex(iso)]} ${year(iso)}`;
}

/** `"2025-11-03"`, row 1 → `"Mon 3 Nov 2025"`. */
export function dayLabel(iso: string, weekday: number): string {
  return `${DAYS_SHORT[weekday]} ${Number(iso.slice(8, 10))} ${monthShort(iso)} ${year(iso)}`;
}

const COUNT_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
] as const;

/** Editorial count: `4` → `"four"`. Falls back to numerals past twelve. */
export function countWord(n: number): string {
  return Number.isInteger(n) && n >= 0 && n < COUNT_WORDS.length
    ? COUNT_WORDS[n]
    : num(n);
}

/** `0` → `"Today"`, `1` → `"Yesterday"`, `n` → `"n days ago"`. */
export function relativeDays(daysAgo: number): string {
  if (daysAgo === 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  return `${daysAgo} days ago`;
}
