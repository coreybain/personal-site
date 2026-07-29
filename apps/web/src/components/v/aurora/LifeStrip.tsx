import type { FunEntry } from "@/lib/snapshot";
import { snapshot } from "@/lib/snapshot";

import styles from "./aurora.module.css";
import { num, relativeDays } from "./format";

const ART: Record<FunEntry["type"], string> = {
  beer: styles.lifeBeer,
  coffee: styles.lifeCoffee,
  walk: styles.lifeWalk,
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

export function LifeStrip() {
  return (
    <section
      className={`${styles.rise}`}
      style={{ "--aur-delay": "540ms" } as React.CSSProperties}
    >
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <span className={`${styles.eyebrow} flex items-center gap-2.5`}>
          <span className={styles.mono}>04</span>
          <span className="h-px w-6 bg-[var(--aur-hairline)]" aria-hidden="true" />
          Off the clock
        </span>
        <span className={styles.micro}>Sydney, this week</span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {snapshot.funEntries.map((entry) => (
          <article
            key={`${entry.type}-${entry.title}`}
            className={`${styles.card} ${styles.cardSm} ${styles.lift} flex items-center gap-3.5 p-2.5`}
          >
            <div className={`${ART[entry.type]} ${styles.lifeArt} w-[72px] shrink-0`}>
              <div className={styles.lifeGrid} />
            </div>
            <div className="min-w-0 pr-1.5">
              <div className="flex items-center gap-2">
                <span className={styles.eyebrow}>{KIND[entry.type]}</span>
                <span className={styles.micro}>· {relativeDays(entry.daysAgo)}</span>
              </div>
              <p className="mt-1.5 truncate text-[13px] font-medium tracking-[-0.012em]">
                {entry.title}
              </p>
              <p className={`${styles.micro} mt-1 truncate`}>{detail(entry)}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
