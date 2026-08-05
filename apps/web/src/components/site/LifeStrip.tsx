import type { CSSProperties } from "react";

import type { FunEntry, HealthStats } from "@/lib/snapshot";

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

type LifeCard = {
  id: string;
  art: string;
  kind: string;
  when: string;
  title: string;
  detail: string;
  daysAgo: number;
  /** Curated entries win a same-day tie with the HealthKit summary. */
  sourceOrder: number;
};

const DAY_MS = 86_400_000;
const SYDNEY_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Australia/Sydney",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const WEEKDAY = new Intl.DateTimeFormat("en-AU", {
  timeZone: "UTC",
  weekday: "long",
});

function isoDayMs(isoDate: string): number {
  return Date.parse(`${isoDate}T00:00:00Z`);
}

function healthDaysAgo(date: string, computedAt: string): number {
  const snapshotDate = SYDNEY_DATE.format(new Date(computedAt));
  return Math.max(0, Math.round((isoDayMs(snapshotDate) - isoDayMs(date)) / DAY_MS));
}

function workoutLabel(count: number): string {
  if (count === 0) return "";
  return ` · ${count} workout${count === 1 ? "" : "s"}`;
}

/**
 * Merge the editorial feed with the phone's daily movement summaries. The
 * homepage owns this three-card projection; /fun continues to render each
 * source in its fuller, source-specific treatment.
 */
export function buildLifeCards(
  entries: readonly FunEntry[],
  healthStats: HealthStats | null,
  computedAt: string,
): LifeCard[] {
  const editorialCards: LifeCard[] = entries.map((entry) => ({
    id: `fun-${entry.id}`,
    art: ART[entry.type],
    kind: KIND[entry.type],
    when: relativeDays(entry.daysAgo),
    title: entry.title,
    detail: detail(entry),
    daysAgo: entry.daysAgo,
    sourceOrder: 0,
  }));

  const healthCards: LifeCard[] = (healthStats?.recentDays ?? []).map((day) => {
    const daysAgo = healthDaysAgo(day.date, computedAt);

    return {
      id: `health-${day.date}`,
      art: "hor-life-walk",
      kind: "HealthKit",
      when: relativeDays(daysAgo),
      title: `${WEEKDAY.format(new Date(`${day.date}T00:00:00Z`))} movement`,
      detail: `${num(day.steps)} steps · ${day.distanceKm.toFixed(1)} km${workoutLabel(day.activities.length)}`,
      daysAgo,
      sourceOrder: 1,
    };
  });

  return [...editorialCards, ...healthCards]
    .sort((a, b) => a.daysAgo - b.daysAgo || a.sourceOrder - b.sourceOrder)
    .slice(0, 3);
}

/**
 * The homepage teaser: the three most recent off-the-clock signals. Small and
 * human, deliberately the lightest section on the page.
 *
 * `entries` is `snapshot.funEntries` — pubs are already excluded by the
 * contract. `healthStats` supplies the same recent HealthKit days shown on
 * /fun, so the homepage does not become empty merely because no editorial Fun
 * Entry has been authored. The merge and slice stay here because "three
 * across" is this component's layout, not the page's data.
 *
 * `location` comes from `identity` rather than from the entries themselves —
 * Convex fun entries carry their own `location`, but `FunEntry` has no field
 * for it, so the strip still says where Corey *is*, not where the walk was.
 */
export function LifeStrip({
  entries,
  healthStats,
  computedAt,
  location,
}: {
  entries: readonly FunEntry[];
  healthStats: HealthStats | null;
  /** The Snapshot clock used for stable relative HealthKit dates. */
  computedAt: string;
  /** `identity.location` — the "…, this week" tag on the right. */
  location: string;
}) {
  const recent = buildLifeCards(entries, healthStats, computedAt);

  if (recent.length === 0) return null;

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
            key={entry.id}
            className="hor-card hor-lift hor-rise flex items-center gap-3.5 p-2.5"
            style={
              {
                "--hor-delay": `${80 + i * 60}ms`,
                borderRadius: "16px",
              } as CSSProperties
            }
          >
            <div className={`hor-life-art ${entry.art} w-[58px] shrink-0`} />
            <div className="min-w-0 pr-1.5">
              <div className="flex items-center gap-2">
                <span className="hor-eyebrow">{entry.kind}</span>
                <span className="hor-micro">· {entry.when}</span>
              </div>
              <p className="mt-1.5 truncate text-[13px] font-medium tracking-[-0.012em]">
                {entry.title}
              </p>
              <p className="hor-micro mt-1 truncate">{entry.detail}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
