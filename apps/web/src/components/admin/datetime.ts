/**
 * Dates, between three incompatible representations.
 *
 * The schema uses two string formats and browsers use two input types, and they
 * do not line up:
 *
 *   `isoDate`      `YYYY-MM-DD`                    — a calendar day, no zone.
 *                                                    `experienceEntries.startDate`,
 *                                                    `endDate`.
 *   RFC-3339 UTC   `YYYY-MM-DDTHH:MM:SS.sssZ`      — an instant. Everything
 *                                                    named `*At`, per the header
 *                                                    of `convex/schema.ts`.
 *   `<input type="date">`         value is `YYYY-MM-DD`, zone-free.
 *   `<input type="datetime-local">` value is `YYYY-MM-DDTHH:MM` in the *viewer's*
 *                                   zone, with no offset recorded.
 *
 * The trap this file exists to avoid: round-tripping a calendar day through
 * `Date`. `new Date("2026-07-30")` parses as UTC midnight, and
 * `.toLocaleDateString()` in Sydney (UTC+10) renders it as 30 July while the same
 * value in Los Angeles renders as 29 July. Do that on save as well as on load and
 * a date drifts a day every time someone in the wrong hemisphere opens the form.
 *
 * So: **calendar days never touch `Date`.** They are sliced and concatenated as
 * strings, which is exactly correct because a calendar day has no instant to be
 * wrong about. Instants do use `Date`, because converting a local wall clock to
 * UTC is precisely what `Date` is for.
 *
 * Server-safe: no `"use client"`, no imports. `Date` is used only inside
 * functions, never at module scope, so nothing here differs between a server
 * render and a hydration.
 */

/** `YYYY-MM-DD`, nothing more. Rejects `2026-7-1` and `2026-13-01`. */
const ISO_DATE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

/**
 * An RFC-3339 instant in UTC. Deliberately strict about the trailing `Z`:
 * `convex/schema.ts` specifies UTC, and accepting `+10:00` here would let a
 * non-UTC string into a field every reader assumes is UTC.
 */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export function isIsoDate(value: string): boolean {
  return ISO_DATE.test(value);
}

export function isIsoInstant(value: string): boolean {
  return ISO_INSTANT.test(value);
}

/** Now, as the schema wants it. The one place `new Date()` is called for a write. */
export function nowIso(): string {
  return new Date().toISOString();
}

/* ------------------------------------------------------------------ *
 * Calendar days  ⇄  <input type="date">
 *
 * Both directions are the identity function on valid input. They exist anyway,
 * because the *validation* is the point: an invalid stored value must render as
 * an empty input rather than as a browser-rejected one, and an empty input must
 * produce `""` rather than `"T00:00:00Z"`.
 * ------------------------------------------------------------------ */

/** Stored `isoDate` → `<input type="date">` value. `""` for absent/invalid. */
export function isoDateToInput(value: string | null | undefined): string {
  return value && isIsoDate(value) ? value : "";
}

/** `<input type="date">` value → stored `isoDate`, or `null` when cleared. */
export function inputToIsoDate(value: string): string | null {
  return isIsoDate(value) ? value : null;
}

/* ------------------------------------------------------------------ *
 * Instants  ⇄  <input type="datetime-local">
 * ------------------------------------------------------------------ */

/**
 * Stored UTC instant → `<input type="datetime-local">` value, in the viewer's
 * zone.
 *
 * Built by hand from the local getters rather than with `toISOString()` (which
 * would hand back UTC and display the wrong wall clock) and rather than with
 * `toLocaleString()` (whose output format is locale-dependent and not what the
 * input parses). Seconds are dropped: the input hides them by default, and a
 * hidden field that silently rewrites itself on save is worse than a coarser one.
 */
export function isoInstantToLocalInput(value: string | null | undefined): string {
  if (!value || !isIsoInstant(value)) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * `<input type="datetime-local">` value → stored UTC instant, or `null`.
 *
 * The input's value carries no offset, so `new Date()` interprets it in the
 * browser's zone — which is what the person typing it meant. That makes the
 * result correct and *not* reproducible: the same keystrokes in Sydney and in
 * London produce different instants. Correct, but worth knowing when a timestamp
 * looks ten hours off in the Convex dashboard.
 */
export function localInputToIsoInstant(value: string): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/* ------------------------------------------------------------------ *
 * Display
 * ------------------------------------------------------------------ */

/**
 * A stored instant, for a table cell: `30 Jul 2026, 14:05`.
 *
 * Uses `en-AU` explicitly rather than the viewer's locale. Two reasons: this is a
 * single-user admin in Sydney, and a fixed locale means the rendered string is
 * the same on the server and in the browser — a locale-dependent one is a
 * hydration mismatch waiting for a laptop with different settings.
 *
 * The *zone* is still the viewer's, deliberately: an instant should read in the
 * time you were in when it happened.
 */
export function formatInstant(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * A stored calendar day, for a table cell: `Jul 2026`.
 *
 * Month precision because that is what the résumé prints, and string-sliced
 * because a calendar day must not go through `Date` (see the file header).
 */
export function formatMonth(value: string | null | undefined): string {
  if (!value || !isIsoDate(value)) {
    return "—";
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

  const year = value.slice(0, 4);
  const month = Number(value.slice(5, 7));

  return `${MONTHS[month - 1]} ${year}`;
}
