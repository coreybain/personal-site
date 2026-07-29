import type { ReactElement } from "react";

import type { FunEntry } from "@/lib/snapshot";
import { snapshot } from "@/lib/snapshot";

import { delay } from "./SectionHead";
import { num, relativeDays } from "./format";

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** Small, drawn by hand, no icon dependency. */
const GLYPH: Record<FunEntry["type"], ReactElement> = {
  beer: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 8h9v11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V8Z" {...STROKE} />
      <path d="M16 11h2a2 2 0 0 1 0 4h-2" {...STROKE} />
      <path d="M7 8a2.4 2.4 0 0 1 2.6-2.4A2.6 2.6 0 0 1 14.6 5 2.3 2.3 0 0 1 16 8" {...STROKE} />
    </svg>
  ),
  coffee: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9Z" {...STROKE} />
      <path d="M17 11h1.6a2.4 2.4 0 0 1 0 4.8H17" {...STROKE} />
      <path d="M8 3v2.4M12 3v2.4" {...STROKE} />
    </svg>
  ),
  walk: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="13.4" cy="4.4" r="1.9" {...STROKE} />
      <path d="m8 21 3-5.4-2.2-3 1-4.4 3.6-.9 2.4 3.3 2.8 1.2" {...STROKE} />
      <path d="m11 15.6 3.3 1.6 1.2 3.8" {...STROKE} />
      <path d="m9.4 7.6-3 1.4-1 2.6" {...STROKE} />
    </svg>
  ),
};

/** "Sydney, Australia" → "Sydney" — the strip caption only wants the city. */
const city = snapshot.identity.location.split(",")[0].trim();

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

export function LifeStrip() {
  return (
    <section className="pri-shell pri-rise" style={delay(560)}>
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div className="pri-sec-eyebrow">
          <span className="pri-eyebrow pri-mono">04</span>
          <span className="pri-sec-tick" aria-hidden="true" />
          <span className="pri-eyebrow">Off the clock</span>
        </div>
        <span className="pri-micro">{city}, this week</span>
      </div>

      <div className="grid gap-3.5 sm:grid-cols-3 sm:gap-4">
        {snapshot.funEntries.map((entry) => (
          <article
            key={`${entry.type}-${entry.title}`}
            className="pri-card pri-card-sm pri-lift flex items-center gap-3.5 p-3"
          >
            <span className="pri-life-art">{GLYPH[entry.type]}</span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="pri-eyebrow">{KIND[entry.type]}</span>
                <span className="pri-micro">· {relativeDays(entry.daysAgo)}</span>
              </div>
              <p className="mt-1.5 truncate text-[0.8125rem] font-semibold tracking-[-0.014em]">
                {entry.title}
              </p>
              <p className="pri-micro mt-1 truncate">{detail(entry)}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
