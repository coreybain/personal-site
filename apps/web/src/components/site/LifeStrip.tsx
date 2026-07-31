import type { CSSProperties } from "react";

import type { FunEntry } from "@/lib/snapshot";

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
 * The homepage teaser: the three most recent entries only. Small and human,
 * deliberately the lightest section on the page.
 *
 * `entries` is `snapshot.funEntries` — a rolling ~60 days, newest first, pubs
 * already excluded by the contract. The slice stays here rather than in the
 * page because "three across" is this component's layout, not the page's data:
 * the full log lives on /fun, which shows pub visits too (`snapshot.funLog`).
 *
 * `location` comes from `identity` rather than from the entries themselves —
 * Convex fun entries carry their own `location`, but `FunEntry` has no field
 * for it, so the strip still says where Corey *is*, not where the walk was.
 */
export function LifeStrip({
  entries,
  location,
}: {
  entries: FunEntry[];
  /** `identity.location` — the "…, this week" tag on the right. */
  location: string;
}) {
  const recent = entries.slice(0, 3);

  return (
    <section className="pt-16 pb-16 sm:pt-20 sm:pb-20">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <span className="hor-eyebrow">
          <span className="hor-mono">04</span>
          <span className="hor-tick" aria-hidden="true" />
          Off the clock
        </span>
        <span className="hor-micro">{location}, this week</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 sm:gap-4">
        {recent.map((entry, i) => (
          <article
            /* `entry.id`, not `type`+`title`: two visits to the same place are
               two entries, and the old key made them one. See `FunEntry`. */
            key={entry.id}
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
