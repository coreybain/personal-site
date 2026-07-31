/**
 * format.ts — deterministic formatting for the printed document.
 *
 * A near-copy of `apps/web/src/components/site/format.tsx`, and deliberately a
 * copy rather than an import: this package may not reach into apps/web (see
 * props.ts), and the two renderers must print the same strings. Where a helper
 * appears in both files it has the same name, the same signature and the same
 * output, so `stamp('2026-07-31')` is `31 JUL 26` on the page and in the PDF.
 *
 * Everything here is UTC. `new Date('2026-07-31')` is parsed as UTC midnight by
 * the spec but `new Date('2026-07-31T00:00:00')` is parsed as *local* midnight,
 * and the difference is one day for anyone rendering from Sydney. Dates are
 * therefore always built with an explicit `Z`, exactly as the web helper does —
 * a résumé that says a different date depending on which region the serverless
 * function woke up in is not "provably current", it is just wrong.
 */

const GROUPED = new Intl.NumberFormat('en-US');

/** `6434` → `6,434`. */
export function num(n: number): string {
  return GROUPED.format(n);
}

/** Rounded percentage of `part` in `whole`, guarding a zero denominator. */
export function pct(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 100);
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** `2026-07-31` → a Date parsed as UTC, so it never drifts by a timezone. */
function parseIso(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

/**
 * `2026-07-31` → `31 JUL 26`.
 *
 * The instrument stamp. Mono, uppercase, used wherever the document is quoting
 * a measurement rather than writing prose — which on this page means the live
 * strip and the footer.
 *
 * `MONTHS[…]` is indexed by `getUTCMonth()`, which is 0–11 by definition, but
 * `noUncheckedIndexedAccess` cannot know that; the `?? ''` is the tax for the
 * flag rather than a real branch.
 */
export function stamp(isoDate: string): string {
  const d = parseIso(isoDate);
  const month = MONTHS[d.getUTCMonth()] ?? '';
  return `${String(d.getUTCDate()).padStart(2, '0')} ${month.toUpperCase()} ${String(
    d.getUTCFullYear(),
  ).slice(2)}`;
}

/** `2026-07-31T06:00:00Z` → `31 JUL 2026 · 06:00 UTC`. */
export function stampTime(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  const month = MONTHS[d.getUTCMonth()] ?? '';
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${String(d.getUTCDate()).padStart(2, '0')} ${month.toUpperCase()} ${d.getUTCFullYear()} · ${hh}:${mm} UTC`;
}

/**
 * An ISO instant → the `YYYY-MM-DD` it falls on, in UTC.
 *
 * `String.prototype.slice(0, 10)` is what apps/web uses and it is correct for
 * the `…Z` timestamps the snapshot stores, but it is a string operation on a
 * value this package accepts from a caller, so it goes through `Date` instead:
 * an instant with a `+11:00` offset is a different *day* in UTC, and slicing
 * would print the wrong one.
 */
export function isoDay(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Strip the scheme, a leading `www.` and any trailing slash from a URL, for
 * print.
 *
 * On paper `https://www.` is eleven wasted characters and a visual stutter at
 * the start of a contact row — and on this document specifically it is the
 * difference between `www.linkedin.com/in/coreybaines` overrunning the 176pt
 * contact column and `linkedin.com/in/coreybaines` sitting inside it. The
 * `<Link>` that wraps the printed text still carries the full URL, so the PDF
 * stays clickable.
 */
export function bareUrl(url: string): string {
  return url
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '');
}
