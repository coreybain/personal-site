import { snapshot } from "@/lib/snapshot";

import { Heatmap, HeatmapLegend } from "./Heatmap";
import { SectionHead, delay } from "./SectionHead";
import { num, pct, shortDate } from "./format";

const { gitStats } = snapshot;
const { calendar, languages } = gitStats;

const DAY_MS = 86_400_000;

const firstDay = calendar[0][0].date;
const lastDay = calendar[calendar.length - 1][6].date;

const privateShare = pct(gitStats.privateContributions, gitStats.totalContributionsYear);
const perDay = Math.round(gitStats.totalContributionsYear / (calendar.length * 7));

/** The day the current streak began, derived from the snapshot timestamp. */
const streakStart = new Date(
  Date.parse(snapshot.computedAt) - (gitStats.currentStreakDays - 1) * DAY_MS,
)
  .toISOString()
  .slice(0, 10);

/** The spectrum doubles as the categorical palette; "Other" stays neutral. */
const LANG_FILL = [
  "var(--pri-s1)",
  "var(--pri-s2)",
  "var(--pri-s3)",
  "var(--pri-s4)",
  "var(--pri-ink-4)",
] as const;

export function GitSignal() {
  return (
    <section id="signal" className="pri-shell pri-rise scroll-mt-8" style={delay(440)}>
      <SectionHead
        index="01"
        eyebrow="Git signal"
        title={<>{num(gitStats.totalContributionsYear)} contributions in the last year.</>}
        lede={
          <>
            Roughly {perDay} a day, every day — across private product work and
            public repositories.
          </>
        }
        aside={
          <span className="pri-pill">
            <span className="pri-dot" aria-hidden="true" />
            {gitStats.currentStreakDays}-day streak, live
          </span>
        }
      />

      <div className="pri-card p-5 sm:p-7">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-[0.8125rem] font-semibold tracking-[-0.014em]">
              Contribution activity
            </span>
            <span className="pri-micro pri-mono">
              {shortDate(firstDay)} → {shortDate(lastDay)}
            </span>
          </div>
          <HeatmapLegend />
        </div>

        <div className="pri-heat-scroll">
          <div className="pri-heat-floor">
            <Heatmap weeks={calendar} />
          </div>
        </div>

        <p className="pri-micro mt-4">
          Hue runs with the calendar, oldest on the left; opacity is volume.
        </p>

        <div className="pri-rule mt-6 grid gap-7 pt-6 sm:gap-8 lg:grid-cols-12">
          {/* Where the work actually lives */}
          <div className="lg:col-span-5">
            <div className="flex items-baseline justify-between gap-4">
              <span className="pri-eyebrow">Private work</span>
              <span className="pri-stat-sm">{privateShare}%</span>
            </div>
            <div className="pri-meter mt-3.5">
              <span
                className="pri-seg"
                style={{
                  width: `${privateShare}%`,
                  backgroundImage: "var(--pri-grad-x)",
                }}
              />
            </div>
            <p className="pri-micro mt-3">
              {num(gitStats.privateContributions)} private ·{" "}
              {num(gitStats.publicCommits)} public commits across{" "}
              {gitStats.publicRepoCount} repositories
            </p>
          </div>

          {/* Streak */}
          <div className="lg:col-span-3">
            <span className="pri-eyebrow">Current streak</span>
            <div className="mt-3 flex items-baseline gap-1.5">
              <span className="pri-stat">{gitStats.currentStreakDays}</span>
              <span className="pri-label">days</span>
            </div>
            <p className="pri-micro mt-3">Unbroken since {shortDate(streakStart)}</p>
          </div>

          {/* Languages */}
          <div className="lg:col-span-4">
            <span className="pri-eyebrow">Languages</span>
            <div className="pri-meter-split mt-3.5">
              {languages.map((lang, i) => (
                <span
                  key={lang.name}
                  className="pri-seg"
                  style={{ width: `${lang.pct}%`, background: LANG_FILL[i] }}
                />
              ))}
            </div>
            <ul className="mt-3.5 flex flex-wrap gap-x-4 gap-y-2">
              {languages.map((lang, i) => (
                <li key={lang.name} className="pri-micro flex items-center gap-1.5">
                  <span
                    className="block h-[7px] w-[7px] rounded-full"
                    style={{ background: LANG_FILL[i] }}
                    aria-hidden="true"
                  />
                  {lang.name}
                  <span className="pri-tnum pri-ink-2">{lang.pct}%</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
