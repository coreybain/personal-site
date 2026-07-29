import { snapshot } from "@/lib/snapshot";

import styles from "./aurora.module.css";
import { ContributionHeatmap, HeatmapLegend } from "./ContributionHeatmap";
import { SectionHeading } from "./SectionHeading";
import { longDate, num, pct } from "./format";

const { gitStats } = snapshot;
const { calendar, languages } = gitStats;

const DAY_MS = 86_400_000;

const firstDay = calendar[0][0].date;
const lastDay = calendar[calendar.length - 1][6].date;

const privateShare = pct(gitStats.privateContributions, gitStats.totalContributionsYear);
const perDay = Math.round(gitStats.totalContributionsYear / (calendar.length * 7));

/** The day the current streak started, derived from the snapshot timestamp. */
const streakStart = new Date(
  Date.parse(snapshot.computedAt) - (gitStats.currentStreakDays - 1) * DAY_MS,
)
  .toISOString()
  .slice(0, 10);

/** Sequential ramp, darkest for the largest share — same family as the heatmap. */
const LANG_FILL = [
  "var(--aur-lv4)",
  "var(--aur-lv3)",
  "var(--aur-lv2)",
  "var(--aur-lv1)",
  "var(--aur-lv0)",
] as const;

export function GitSignal() {
  return (
    <section
      id="signal"
      className={`${styles.rise} scroll-mt-16`}
      style={{ "--aur-delay": "420ms" } as React.CSSProperties}
    >
      <SectionHeading
        index="01"
        eyebrow="Git signal"
        title={
          <>
            {num(gitStats.totalContributionsYear)} contributions in the last
            year.
          </>
        }
        lede={
          <>
            Roughly {perDay} a day, every day — across private product work and
            public repositories.
          </>
        }
      />

      <div className={`${styles.card} p-5 sm:p-7`}>
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-[13px] font-medium tracking-[-0.012em]">
              Contribution activity
            </span>
            <span className={`${styles.micro} ${styles.mono}`}>
              {longDate(firstDay)} → {longDate(lastDay)}
            </span>
          </div>
          <HeatmapLegend />
        </div>

        <div className={styles.heatScroll}>
          <div className={styles.heatFloor}>
            <ContributionHeatmap weeks={calendar} />
          </div>
        </div>

        <div className={`${styles.hairline} mt-6 grid gap-6 pt-6 sm:gap-7 lg:grid-cols-12`}>
          {/* Private share */}
          <div className="lg:col-span-5">
            <div className="flex items-baseline justify-between gap-4">
              <span className={styles.eyebrow}>Private work</span>
              <span className={styles.statSm}>{privateShare}%</span>
            </div>
            <div className={`${styles.meter} mt-3.5`}>
              <span
                className={styles.meterSeg}
                style={{
                  width: `${privateShare}%`,
                  background: "linear-gradient(90deg, var(--aur-accent-soft), var(--aur-accent))",
                }}
              />
            </div>
            <p className={`${styles.micro} mt-3`}>
              {num(gitStats.privateContributions)} private ·{" "}
              {num(gitStats.publicCommits)} public commits across{" "}
              {gitStats.publicRepoCount} repositories
            </p>
          </div>

          {/* Streak */}
          <div className="lg:col-span-3">
            <span className={styles.eyebrow}>Current streak</span>
            <div className="mt-3 flex items-baseline gap-1.5">
              <span className={styles.stat}>{gitStats.currentStreakDays}</span>
              <span className={styles.label}>days</span>
            </div>
            <p className={`${styles.micro} mt-3`}>
              Unbroken since {longDate(streakStart)}
            </p>
          </div>

          {/* Languages */}
          <div className="lg:col-span-4">
            <span className={styles.eyebrow}>Languages</span>
            <div className={`${styles.meterSplit} mt-3.5`}>
              {languages.map((lang, i) => (
                <span
                  key={lang.name}
                  className={styles.meterSeg}
                  style={{ width: `${lang.pct}%`, background: LANG_FILL[i] }}
                />
              ))}
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-3.5 gap-y-1.5">
              {languages.map((lang, i) => (
                <li key={lang.name} className={`${styles.micro} flex items-center gap-1.5`}>
                  <span
                    className="block h-[7px] w-[7px] rounded-full"
                    style={{ background: LANG_FILL[i] }}
                    aria-hidden="true"
                  />
                  {lang.name}
                  <span className={styles.tnum} style={{ color: "var(--aur-ink-2)" }}>
                    {lang.pct}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
