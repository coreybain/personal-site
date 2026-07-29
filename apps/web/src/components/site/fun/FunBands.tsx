import { stamp } from "@/components/site/format";

import { FunCard } from "./FunCard";
import { bands, entryKey, isWalk, isoDaysAgo, tally } from "./data";

/**
 * The log, in three recency bands.
 *
 * Grouping is by *when*, not by what — the artwork already says what. Each band
 * opens on a hairline rule with its own date range, and its newest entry runs
 * wide as a banner, which is where the grid gets its rhythm. Everything is
 * rendered on the server; there is nothing to click and nothing to filter.
 */

/**
 * Where each band starts in the log as a whole, so the entrance stagger reads
 * as one sweep down the page instead of restarting at every band.
 */
const OFFSETS: number[] = bands.reduce<number[]>((acc, band, i) => {
  acc.push(i === 0 ? 0 : acc[i - 1] + bands[i - 1].entries.length);
  return acc;
}, []);

export function FunBands() {
  return (
    <div>
      {bands.map((band, b) => {
        const oldest = band.entries[band.entries.length - 1];
        const newest = band.entries[0];

        return (
          <section key={band.id} className="fun-band">
            <div className="fun-band-head">
              {/* A real heading, so the outline runs h1 → band → card. */}
              <h2 className="hor-eyebrow">{band.label}</h2>
              <span className="fun-band-rule" aria-hidden="true" />
              <span className="hor-label fun-band-stamp">
                {stamp(isoDaysAgo(oldest.daysAgo))} — {stamp(isoDaysAgo(newest.daysAgo))}
              </span>
            </div>

            <p className="hor-body mb-4 max-w-[52ch] text-pretty">{band.blurb}</p>

            <div className="fun-grid">
              {band.entries.map((entry, i) => {
                const index = OFFSETS[b] + i;
                return (
                  <FunCard
                    key={entryKey(entry)}
                    entry={entry}
                    lead={i === 0}
                    peak={isWalk(entry) && entry.km === tally.longestKm}
                    delay={90 + Math.min(index, 11) * 45}
                  />
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
