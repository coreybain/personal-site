/**
 * Locale-free formatting helpers. Deterministic on server and client so the
 * page can stay fully server-rendered with no hydration drift.
 */

export function group(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function pct(part: number, whole: number): number {
  return Math.round((part / whole) * 100);
}

export function daysAgoLabel(daysAgo: number): string {
  if (daysAgo === 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  return `${daysAgo} days ago`;
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
];

export function monthShort(iso: string): string {
  return MONTHS[Number(iso.slice(5, 7)) - 1];
}

export function monthIndex(iso: string): number {
  return Number(iso.slice(5, 7)) - 1;
}

/** `2026-07-29T06:00:00Z` → `29.07.2026 · 06:00 UTC` */
export function stampUtc(iso: string): string {
  const [date, time] = iso.split("T");
  const [y, m, d] = date.split("-");
  return `${d}.${m}.${y} · ${time.slice(0, 5)} UTC`;
}
