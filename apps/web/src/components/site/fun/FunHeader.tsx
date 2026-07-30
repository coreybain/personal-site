import type { CSSProperties } from "react";
import Link from "next/link";

import { num } from "@/components/site/format";
import type { FunTally } from "@/lib/derive";
import { KIND_LABEL, KIND_ORDER } from "@/lib/derive";
import type { Identity, Lab } from "@/lib/snapshot";

function delay(ms: number): CSSProperties {
  return { "--hor-delay": `${ms}ms` } as CSSProperties;
}

/**
 * The header of /fun — the tally, in prose and in four numerals.
 *
 * ── Props, not module state ────────────────────────────────────────────────
 *
 * `identity`, `tally` and the Pintlog cross-link were read here off the mock at
 * module load. They arrive as props now, from the page's one `getSiteData()` /
 * `deriveFun()` pair. `pintlog` is passed already-found rather than as the whole
 * lab list: the page owns the lookup, so this component cannot quietly become a
 * second reader of the snapshot.
 */
export function FunHeader({
  identity,
  tally,
  pintlog,
}: {
  identity: Identity;
  tally: FunTally;
  /** The weekend Swift app the beer entries come from — cross-linked, not quoted. */
  pintlog: Lab | undefined;
}) {
  /**
   * The four numbers that actually mean something here, in the *sans* face —
   * this page never crosses the horizon, so its numerals stay sky-side. The
   * walks bring the only mono readouts on the page, down in the cards.
   */
  const skyline = [
    { value: num(tally.entries), label: "Moments logged" },
    { value: tally.km.toFixed(1), label: "Kilometres on foot" },
    { value: num(tally.steps), label: "Steps counted" },
    { value: num(tally.spanDays), label: "Days covered" },
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
        Coffee, beer, and a lot of walking.
      </h1>

      <p className="hor-lede hor-rise mt-7 max-w-[54ch] text-pretty" style={delay(170)}>
        The rest of this site is instrumented to two decimal places. This part is
        not. It is {tally.entries} small entries from the last {tally.spanDays}{" "}
        days in {identity.location} — {tally.counts.coffee} coffees,{" "}
        {tally.counts.beer} beers, {tally.counts.pub} nights at the pub and{" "}
        {tally.counts.walk} walks that came to {tally.km.toFixed(1)} km. The
        walks are the only thing here anyone bothered to count.
      </p>

      <div className="hor-rise mt-8 flex flex-wrap items-center gap-x-3 gap-y-3" style={delay(230)}>
        <div className="fun-key">
          {KIND_ORDER.map((kind) => (
            <span key={kind} className="fun-key-item">
              <span className="fun-swatch" data-kind={kind} aria-hidden="true" />
              {KIND_LABEL[kind]}
              <span className="fun-key-n">×{tally.counts[kind]}</span>
            </span>
          ))}
        </div>

        {pintlog ? (
          <Link href="/labs" className="hor-pill">
            <span
              className="block h-[7px] w-[7px] rounded-full"
              style={{ background: "var(--hor-accent)" }}
              aria-hidden="true"
            />
            Logged in {pintlog.title}
          </Link>
        ) : null}
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
