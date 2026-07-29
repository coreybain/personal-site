import { snapshot } from "@/lib/snapshot";

import { Heatmap, HeatmapLegend, LEVEL_VAR } from "./Heatmap";
import { SectionHeading } from "./SectionHeading";
import { StatRail, type RailCell } from "./StatRail";
import { delay, num, pct, shortDate } from "./format";

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

/** Sequential ramp, darkest step for the largest share — same family as the grid. */
const LANG_FILL = [
  LEVEL_VAR[4],
  LEVEL_VAR[3],
  LEVEL_VAR[2],
  LEVEL_VAR[1],
  LEVEL_VAR[0],
] as const;

const RAIL: RailCell[] = [
  {
    value: `${privateShare}%`,
    label: "Private work",
    sub: `${num(gitStats.privateContributions)} contributions`,
  },
  {
    value: num(gitStats.publicCommits),
    label: "Public commits",
    sub: `Across ${gitStats.publicRepoCount} repositories`,
  },
  {
    value: String(perDay),
    unit: "/ day",
    label: "Sustained rate",
    sub: "Averaged over 52 weeks",
  },
  {
    value: String(gitStats.currentStreakDays),
    unit: "days",
    label: "Current streak",
    sub: `Since ${shortDate(streakStart)}`,
  },
];

export function GitSignal() {
  return (
    <section id="signal" className="noc-rise scroll-mt-16" style={delay(440)}>
      <SectionHeading
        index="01"
        eyebrow="Git signal"
        title={
          <>{num(gitStats.totalContributionsYear)} contributions in the last year.</>
        }
        lede={
          <>
            Roughly {perDay} a day, every day — across private product work and
            public repositories.
          </>
        }
      />

      <div className="noc-card overflow-hidden">
        <div className="p-5 sm:p-7">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
            <div>
              <div className="noc-stat-xl">
                {num(gitStats.totalContributionsYear)}
              </div>
              <div className="noc-eyebrow mt-3">Contributions · 12 months</div>
            </div>
            <div className="flex flex-col items-start gap-2.5 sm:items-end">
              <span className="noc-micro noc-mono">
                {shortDate(firstDay)} → {shortDate(lastDay)}
              </span>
              <HeatmapLegend />
            </div>
          </div>

          <div className="noc-heat-scroll">
            <div className="noc-heat-floor">
              <div className="noc-heat-glow" aria-hidden="true" />
              <Heatmap weeks={calendar} total={gitStats.totalContributionsYear} />
            </div>
          </div>
        </div>

        <StatRail cells={RAIL} className="noc-hair" />

        <div className="noc-hair p-5 sm:p-7">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
            <span className="noc-eyebrow">Languages, by share of tracked code</span>
            <span className="noc-micro noc-mono">{languages.length} tracked</span>
          </div>

          <div className="noc-meter noc-meter-split mt-4">
            {languages.map((lang, i) => (
              <span
                key={lang.name}
                className="noc-meter-seg"
                style={{ width: `${lang.pct}%`, background: LANG_FILL[i] }}
              />
            ))}
          </div>

          <ul className="mt-3.5 flex flex-wrap gap-x-5 gap-y-2">
            {languages.map((lang, i) => (
              <li key={lang.name} className="noc-micro flex items-center gap-1.5">
                <span
                  className="noc-swatch"
                  style={{ background: LANG_FILL[i] }}
                  aria-hidden="true"
                />
                <span className="noc-dim">{lang.name}</span>
                <span className="noc-tnum">{lang.pct}%</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
