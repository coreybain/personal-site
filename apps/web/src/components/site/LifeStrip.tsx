import type { CSSProperties } from "react";

import type { FunEntry } from "@/lib/snapshot";
import { snapshot } from "@/lib/snapshot";

import { num, relativeDays } from "./format";

const ART: Record<FunEntry["type"], string> = {
  beer: "hor-life-beer",
  coffee: "hor-life-coffee",
  walk: "hor-life-walk",
};

const KIND: Record<FunEntry["type"], string> = {
  beer: "Beer",
  coffee: "Coffee",
  walk: "Walk",
};

function detail(entry: FunEntry): string {
  return entry.type === "walk"
    ? `${num(entry.steps)} steps · ${entry.km} km`
    : entry.note;
}

/**
 * The homepage teaser: the three most recent entries only.
 *
 * `snapshot.funEntries` now carries a rolling ~60 days. The strip is a
 * three-across row and reads as a glance, not a feed — the full log lives on
 * /fun, which also shows pub visits (`snapshot.funLog`).
 */
const RECENT = snapshot.funEntries.slice(0, 3);

/** Small and human. Deliberately the lightest section on the page. */
export function LifeStrip() {
  return (
    <section className="pt-16 pb-16 sm:pt-20 sm:pb-20">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <span className="hor-eyebrow">
          <span className="hor-mono">04</span>
          <span className="hor-tick" aria-hidden="true" />
          Off the clock
        </span>
        <span className="hor-micro">{snapshot.identity.location}, this week</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 sm:gap-4">
        {RECENT.map((entry, i) => (
          <article
            key={`${entry.type}-${entry.title}`}
            className="hor-card hor-lift hor-rise flex items-center gap-3.5 p-2.5"
            style={
              {
                "--hor-delay": `${80 + i * 60}ms`,
                borderRadius: "16px",
              } as CSSProperties
            }
          >
            <div className={`hor-life-art ${ART[entry.type]} w-[58px] shrink-0`} />
            <div className="min-w-0 pr-1.5">
              <div className="flex items-center gap-2">
                <span className="hor-eyebrow">{KIND[entry.type]}</span>
                <span className="hor-micro">· {relativeDays(entry.daysAgo)}</span>
              </div>
              <p className="mt-1.5 truncate text-[13px] font-medium tracking-[-0.012em]">
                {entry.title}
              </p>
              <p className="hor-micro mt-1 truncate">{detail(entry)}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
