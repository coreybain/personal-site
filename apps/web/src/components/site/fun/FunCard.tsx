import type { CSSProperties } from "react";

import { num, relativeDays, stamp } from "@/components/site/format";
import { KIND_LABEL, isWalk } from "@/lib/derive";
import type { FunLogEntry } from "@/lib/snapshot";

/**
 * One logged moment.
 *
 * Photo-led, except there are no photos: the top of every card is a plane of
 * generated art keyed to the kind of thing it was — amber glass for beer,
 * concentric crema for coffee, horizon strata for a walk, two lit panes for a
 * pub. The frame reserves its box with `aspect-ratio`, so nothing shifts as the
 * page settles.
 *
 * Type is carried by the art and a badge, never by a filter — the page is a
 * server component end to end and there is no client JS on it at all.
 *
 * ── Props, not module state ────────────────────────────────────────────────
 *
 * `hue` and `date` used to be read here by calling `hueFor(entry)` and
 * `isoDaysAgo(entry.daysAgo)` out of `./data`, which computed both against the
 * *mock* at module load. Both are now resolved by `FunBands` from the
 * `deriveFun()` closures the page built, so this card renders whatever the page
 * fetched and holds no opinion about where it came from. Plain values cross the
 * boundary rather than the closures themselves — see the rules at the top of
 * `@/lib/derive`.
 */
export function FunCard({
  entry,
  hue,
  date,
  lead = false,
  peak = false,
  delay,
}: {
  entry: FunLogEntry;
  /** Base hue for the generated artwork, from `deriveFun().hueFor`. */
  hue: number;
  /** ISO date the entry happened on, from `deriveFun().isoDaysAgo`. */
  date: string;
  /** The newest entry in its band: a wide banner rather than a tile. */
  lead?: boolean;
  /** The longest walk in the log. Gets the ramp's sun, as peaks do site-wide. */
  peak?: boolean;
  delay: number;
}) {
  const walk = isWalk(entry);

  return (
    <article
      className={`hor-card hor-lift hor-rise fun-card${lead ? " fun-lead" : ""}`}
      data-peak={peak ? "1" : undefined}
      style={
        {
          "--hor-delay": `${delay}ms`,
        } as CSSProperties
      }
    >
      <div
        className="fun-art"
        data-kind={entry.type}
        style={{ "--fun-h": String(hue) } as CSSProperties}
        aria-hidden="true"
      >
        <span className="fun-paint" />
      </div>

      <div className="fun-body">
        <div className="fun-badge">
          <span className="hor-eyebrow">{KIND_LABEL[entry.type]}</span>
          <span className="hor-vrule hor-vrule-sm" aria-hidden="true" />
          <span className="hor-micro">{relativeDays(entry.daysAgo)}</span>
        </div>

        <h3 className={`mt-2 ${lead ? "hor-h3" : "fun-title"}`}>{entry.title}</h3>

        {walk ? (
          <div className="fun-readouts">
            <div className="fun-readout-cell">
              <span className="hor-readout-sm">{num(entry.steps)}</span>
              <span className="hor-label mt-1.5 block">Steps</span>
            </div>
            <div className="fun-readout-cell">
              <span className="hor-readout-sm">{entry.km.toFixed(1)}</span>
              <span className="hor-label mt-1.5 block">Kilometres</span>
            </div>
          </div>
        ) : (
          <p className="hor-body mt-1.5 text-pretty">{entry.note}</p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <span className="hor-label">{stamp(date)}</span>
          {peak ? (
            <>
              <span className="fun-peak-dot" aria-hidden="true" />
              <span className="hor-micro hor-hot">Longest walk</span>
            </>
          ) : null}
        </div>
      </div>
    </article>
  );
}
