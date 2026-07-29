/**
 * Deterministic formatting helpers for the Observatory variant.
 *
 * Everything here is locale- and timezone-independent on purpose: the page is
 * server-rendered and must hydrate to byte-identical markup.
 */

const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;

/** 6434 → "6,434". No Intl, no locale surprises. */
export function group(n: number): string {
  const neg = n < 0;
  const digits = Math.abs(Math.trunc(n)).toString();
  let out = "";
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ",";
    out += digits[i];
  }
  return neg ? `-${out}` : out;
}

/** 5792 / 6434 → "90.0" */
export function pctOf(part: number, whole: number, dp = 1): string {
  if (whole === 0) return (0).toFixed(dp);
  return ((part / whole) * 100).toFixed(dp);
}

/** "2026-07-29" → "29 JUL 2026" */
export function isoToStamp(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
}

/** "2026-07-29" → "JUL" */
export function isoMonthShort(iso: string): string {
  return MONTHS[Number(iso.slice(5, 7)) - 1];
}

/** "2026-07-29T06:00:00Z" → "2026-07-29 · 06:00 UTC" */
export function isoToClock(iso: string): string {
  return `${iso.slice(0, 10)} · ${iso.slice(11, 16)} UTC`;
}

/** 0 → "TODAY", 1 → "YESTERDAY", n → "n DAYS AGO" */
export function daysAgoLabel(n: number): string {
  if (n === 0) return "TODAY";
  if (n === 1) return "YESTERDAY";
  return `${n} DAYS AGO`;
}
