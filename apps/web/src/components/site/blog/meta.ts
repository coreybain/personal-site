/**
 * The one conversion the blog needs that `@/components/site/format` does not
 * already provide.
 *
 * `format.ts` splits its date helpers by input: `stamp`/`longDate` take a
 * calendar day (`2026-03-03`) and `stampTime` takes an instant
 * (`2026-03-03T06:00:00Z`). `posts.publishedAt` is an instant, but a post is
 * dated by its *day* — nobody wants "06:00 UTC" under a headline.
 *
 * **The day is Sydney's.** This used to slice the UTC day off the string,
 * which was right only while posts happened to be published in Sydney's
 * afternoon. Scheduled posts go out at Sydney times (docs/plans/preview-area.md),
 * and 9am in Sydney is 11pm UTC the day before — the UTC slice would date a
 * Friday-morning post Thursday. `Intl` with an explicit time zone is exact
 * across daylight saving and independent of the server's own zone.
 */

const SYDNEY_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Australia/Sydney",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** `2026-10-02T23:00:00Z` → `2026-10-03` — the calendar day in Sydney. */
export function dayOf(isoInstant: string): string {
  return SYDNEY_DAY.format(new Date(isoInstant));
}
