import type { FunEntry } from "@/lib/snapshot";
import { snapshot } from "@/lib/snapshot";

import { delay, num, relativeDays } from "./format";

const ART: Record<FunEntry["type"], string> = {
  beer: "noc-life-beer",
  coffee: "noc-life-coffee",
  walk: "noc-life-walk",
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

/** Small and human. Same glass, a third of the weight. */
export function LifeStrip() {
  return (
    <section className="noc-rise" style={delay(560)}>
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <span className="noc-eyebrow flex items-center gap-2.5">
          <span className="noc-mono noc-accent">04</span>
          <span className="h-px w-6 bg-[var(--noc-hair)]" aria-hidden="true" />
          Off the clock
        </span>
        <span className="noc-micro">{snapshot.identity.location}, this week</span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {snapshot.funEntries.map((entry) => (
          <article
            key={`${entry.type}-${entry.title}`}
            className="noc-card noc-card-sm noc-lift flex items-center gap-3.5 p-2.5"
          >
            <div className={`noc-life-art ${ART[entry.type]} w-[72px] shrink-0`}>
              <div className="noc-life-mesh" />
            </div>
            <div className="min-w-0 pr-1.5">
              <div className="flex items-center gap-2">
                <span className="noc-eyebrow">{KIND[entry.type]}</span>
                <span className="noc-micro">· {relativeDays(entry.daysAgo)}</span>
              </div>
              <p className="mt-1.5 truncate text-[13px] font-medium tracking-[-0.012em]">
                {entry.title}
              </p>
              <p className="noc-micro mt-1 truncate">{detail(entry)}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
