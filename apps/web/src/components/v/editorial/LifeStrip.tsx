import type { CSSProperties } from "react";

import { snapshot, type FunEntry } from "@/lib/snapshot";
import { SectionHeader } from "./SectionHeader";
import { decimal, num, relativeDays } from "./format";

/**
 * Photo-shaped placeholders. Same printing logic as the project art, tuned
 * warm and soft so the strip reads as snapshots, not data.
 */
const PLATE: Record<FunEntry["type"], { label: string; style: CSSProperties }> = {
  beer: {
    label: "Beer",
    style: {
      background: `
        repeating-linear-gradient(0deg, hsl(32 46% 40% / 0.42) 0 1px, transparent 1px 9px),
        radial-gradient(ellipse 90% 40% at 50% 30%, hsl(44 40% 96% / 0.9), transparent 72%),
        linear-gradient(180deg, hsl(44 34% 92%) 0 27%, hsl(36 66% 60%) 27% 100%)
      `,
    },
  },
  coffee: {
    label: "Coffee",
    style: {
      background: `
        radial-gradient(circle at 50% 44%, hsl(24 34% 32%) 0 24%, transparent 24.5%),
        radial-gradient(circle at 50% 44%, hsl(28 26% 74%) 0 33%, transparent 33.4%),
        linear-gradient(196deg, hsl(30 30% 91%), hsl(26 26% 80%))
      `,
    },
  },
  walk: {
    label: "Walk",
    style: {
      background: `
        linear-gradient(178deg, transparent 0 58%, hsl(168 26% 52% / 0.85) 58% 100%),
        repeating-linear-gradient(76deg, hsl(168 30% 38% / 0.4) 0 1px, transparent 1px 11px),
        linear-gradient(184deg, hsl(196 34% 90%), hsl(180 22% 82%))
      `,
    },
  },
};

function caption(entry: FunEntry): string {
  if (entry.type === "walk") {
    return `${num(entry.steps)} steps · ${decimal(entry.km)} km`;
  }
  return entry.note;
}

export function LifeStrip() {
  return (
    <section className="ed-wrap ed-band" id="off-the-clock">
      <SectionHeader
        index="04"
        label="Off the Clock"
        meta={snapshot.identity.location}
      />

      <div className="ed-life-band">
        <div className="ed-rise">
          <p className="ed-life-lede">Evidence of a pulse outside the terminal.</p>
          <p className="ed-life-sub">
            Logged the same way everything else on this page is: automatically,
            and without editing out the quiet weeks.
          </p>
        </div>

        <div className="ed-life">
          {snapshot.funEntries.map((entry) => (
            <figure className="ed-life-fig ed-rise" key={entry.title}>
              <div className="ed-life-img">
                <div
                  className="ed-art-layer"
                  style={PLATE[entry.type].style}
                  aria-hidden="true"
                />
              </div>
              <figcaption className="ed-life-cap">
                <p className="ed-caps" style={{ color: "var(--ed-ink-45)" }}>
                  <span className="ed-life-kind">{PLATE[entry.type].label}</span>
                  {" — "}
                  {relativeDays(entry.daysAgo)}
                </p>
                <p className="ed-life-title">{entry.title}</p>
                <p className="ed-life-note">{caption(entry)}</p>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

export default LifeStrip;
