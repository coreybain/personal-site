import type { CSSProperties } from "react";

import { num } from "@/components/site/format";
import type { FunTally } from "@/lib/derive";
import { KIND_LABEL, KIND_ORDER } from "@/lib/derive";
import type { Identity } from "@/lib/snapshot";

const MANUAL_KIND_ORDER = KIND_ORDER.filter((kind) => kind !== "walk");

function delay(ms: number): CSSProperties {
  return { "--hor-delay": `${ms}ms` } as CSSProperties;
}

/**
 * The header of /fun — the tally, in prose and in four numerals.
 *
 * ── Props, not module state ────────────────────────────────────────────────
 *
 * `identity` and `tally` were read here off the mock at module load. They arrive
 * as props now, from the page's one `getSiteData()` / `deriveFun()` pair, so this
 * component cannot quietly become a second reader of the snapshot.
 */
export function FunHeader({
  identity,
  tally,
}: {
  identity: Identity;
  tally: FunTally;
}) {
  /**
   * The four numbers that actually mean something here, in the *sans* face —
   * this page never crosses the horizon, so its numerals stay sky-side. The
   * walks bring the only mono readouts on the page, down in the cards.
   */
  const skyline = [
    {
      value: num(tally.entries + tally.healthActivities),
      label: "Moments & workouts",
    },
    { value: tally.km.toFixed(1), label: "Kilometres from HealthKit" },
    { value: num(tally.steps), label: "Steps from HealthKit" },
    { value: num(tally.healthDays), label: "Health days synced" },
  ];

  return (
    <header className="pt-28 pb-14 sm:pt-32 sm:pb-16 lg:pt-36">
      <div className="hor-rise" style={delay(40)}>
        <span className="hor-eyebrow">
          {/* The homepage's teaser strip is section 04; this is the whole of it. */}
          <span className="hor-mono">04</span>
          <span className="hor-tick" aria-hidden="true" />
          Off the clock
        </span>
      </div>

      <h1 className="fun-display hor-rise mt-6 max-w-[16ch] text-balance" style={delay(100)}>
        {tally.entries > 0
          ? "Coffee, beer, and a lot of walking."
          : tally.healthActivities > 0
            ? "Movement, straight from the phone."
            : tally.healthDays > 0
              ? "The phone kept count."
              : "Nothing logged off the clock yet."}
      </h1>

      <p className="hor-lede hor-rise mt-7 max-w-[54ch] text-pretty" style={delay(170)}>
        {tally.entries > 0 ? (
          <>
            The rest of this site is instrumented to two decimal places. This part is
            not. It is {tally.entries} small entries from the last {tally.spanDays}{" "}
            days in {identity.location} — {tally.counts.coffee} coffees,{" "}
            {tally.counts.beer} beers, {tally.counts.pub} nights at the pub and{" "}
            {tally.counts.walk} walks. {tally.healthDays > 0 ? (
              <>
                The iPhone has separately synced {num(tally.steps)} steps and{" "}
                {tally.km.toFixed(1)} km across {tally.healthDays} recent days,
                including {tally.healthActivities} workout sessions.
              </>
            ) : (
              <>The iPhone has not synced any HealthKit days yet.</>
            )}
          </>
        ) : tally.healthDays > 0 ? (
          <>
            The published off-the-clock feed is empty, but the iPhone health signal
            is live: {num(tally.steps)} steps, {tally.km.toFixed(1)} km and{" "}
            {tally.healthActivities} workout sessions across {tally.healthDays} recent days.
          </>
        ) : (
          <>
            The live off-the-clock feed is empty. New moments will appear here
            automatically when they are published from {identity.location}. The
            iPhone has not synced any HealthKit days yet.
          </>
        )}
      </p>

      <div className="hor-rise mt-8 flex flex-wrap items-center gap-x-3 gap-y-3" style={delay(230)}>
        <div className="fun-key">
          {MANUAL_KIND_ORDER.map((kind) => (
            <span key={kind} className="fun-key-item">
              <span className="fun-swatch" data-kind={kind} aria-hidden="true" />
              {KIND_LABEL[kind]}
              <span className="fun-key-n">×{tally.counts[kind]}</span>
            </span>
          ))}
          <span className="fun-key-item">
            <svg
              className="fun-key-icon"
              data-kind="walking"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle cx="13" cy="4" r="2" />
              <path d="m10 22 1-7-3-3 1-5 4-1 3 3 4 1" />
              <path d="m14 10-2 3 3 3 1 6" />
              <path d="m4 14 4-2" />
            </svg>
            Walks
            <span className="fun-key-n">×{tally.activityCounts.walking}</span>
          </span>
          <span className="fun-key-item">
            <svg
              className="fun-key-icon"
              data-kind="gym"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11" />
            </svg>
            Gym
            <span className="fun-key-n">×{tally.activityCounts.gym}</span>
          </span>
        </div>
      </div>

      <div className="hor-rise mt-12 sm:mt-14" style={delay(300)}>
        <div className="hor-rule" />
        <dl className="grid grid-cols-2 gap-x-8 gap-y-7 pt-7 sm:grid-cols-4">
          {skyline.map((item) => (
            /* dt before dd keeps the <dl> grouping valid; column-reverse puts
               the numeral on top the way the homepage's skyline does. */
            <div key={item.label} className="flex flex-col-reverse">
              <dt className="hor-eyebrow mt-2.5">{item.label}</dt>
              <dd className="hor-stat-sky">{item.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </header>
  );
}
