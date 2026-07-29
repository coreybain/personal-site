import { snapshot } from "@/lib/snapshot";

import styles from "./aurora.module.css";
import { num } from "./format";

const { identity, gitStats, aiUsage, projects } = snapshot;

const HEADLINE_STATS: { label: string; value: string; unit?: string }[] = [
  { label: "Contributions, last 12 months", value: num(gitStats.totalContributionsYear) },
  { label: "Agent sessions", value: num(aiUsage.totalSessions) },
  { label: "Platforms shipped", value: String(projects.length) },
  { label: "Current streak", value: String(gitStats.currentStreakDays), unit: "days" },
];

export function Hero() {
  return (
    <header className="pt-10 pb-14 sm:pt-16 sm:pb-20 lg:pt-20 lg:pb-28">
      <div className="grid items-end gap-10 lg:grid-cols-12 lg:gap-12">
        <div className="lg:col-span-7">
          <div className={styles.rise} style={{ "--aur-delay": "40ms" } as React.CSSProperties}>
            <span className={styles.pill}>
              <span className={styles.dot} />
              {identity.availability}
            </span>
          </div>

          <h1
            className={`${styles.display} ${styles.rise} mt-7 text-balance`}
            style={{ "--aur-delay": "110ms" } as React.CSSProperties}
          >
            {identity.name}
          </h1>

          <div
            className={`${styles.rise} mt-6 flex flex-wrap items-center gap-x-3 gap-y-2`}
            style={{ "--aur-delay": "180ms" } as React.CSSProperties}
          >
            <span className="text-[15px] font-medium tracking-[-0.015em]">
              {identity.role}
            </span>
            <span className="h-3 w-px bg-[var(--aur-hairline)]" aria-hidden="true" />
            <span className="text-[15px] text-[var(--aur-ink-3)]">
              {identity.company}
            </span>
            <span className="h-3 w-px bg-[var(--aur-hairline)]" aria-hidden="true" />
            <span className="text-[15px] text-[var(--aur-ink-3)]">
              {identity.location}
            </span>
          </div>

          <p
            className={`${styles.lede} ${styles.rise} mt-6 max-w-[46ch] text-pretty`}
            style={{ "--aur-delay": "240ms" } as React.CSSProperties}
          >
            I build the platforms other teams depend on — document automation,
            compliance, real-time auctions — and I ship them with agents in the
            loop, every day.
          </p>

          <div
            className={`${styles.rise} mt-9 flex flex-wrap items-center gap-3`}
            style={{ "--aur-delay": "300ms" } as React.CSSProperties}
          >
            <a className={styles.btn} href={`mailto:${identity.email}`}>
              Get in touch
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                <path
                  d="M2.6 6.5h7.8M7.2 3.3l3.2 3.2-3.2 3.2"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </a>
            <a
              className={styles.btnGhost}
              href={`https://github.com/${identity.github}`}
              rel="noreferrer"
            >
              github.com/{identity.github}
            </a>
          </div>
        </div>

        <div
          className={`${styles.rise} lg:col-span-5`}
          style={{ "--aur-delay": "360ms" } as React.CSSProperties}
        >
          <div className={`${styles.card} ${styles.lift} p-2`}>
            <div className="px-4 pt-3.5 pb-3">
              <span className={styles.eyebrow}>Signal</span>
            </div>
            <dl>
              {HEADLINE_STATS.map((stat) => (
                <div
                  key={stat.label}
                  className={`${styles.rowRule} flex items-center justify-between gap-4 px-4 py-3.5`}
                >
                  <dt className={styles.label}>{stat.label}</dt>
                  <dd className={`${styles.statSm} flex items-baseline gap-1.5`}>
                    {stat.value}
                    {stat.unit ? (
                      <span className={`${styles.micro} font-normal`}>{stat.unit}</span>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </header>
  );
}
