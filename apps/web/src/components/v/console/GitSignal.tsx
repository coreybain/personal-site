import type { GitStats } from "@/lib/snapshot";

import { Heatmap } from "./Heatmap";
import { Panel, SectionHead } from "./Panel";
import { group, isoToStamp, pctOf } from "./format";

export function GitSignal({ gitStats }: { gitStats: GitStats }) {
  const {
    totalContributionsYear,
    privateContributions,
    publicCommits,
    publicRepoCount,
    currentStreakDays,
    calendar,
    languages,
  } = gitStats;

  const days = calendar.flat();
  const activeDays = days.filter((d) => d.count > 0).length;
  const busiest = days.reduce((a, b) => (b.count > a.count ? b : a));
  const perActiveDay = (totalContributionsYear / activeDays).toFixed(1);

  const privatePct = pctOf(privateContributions, totalContributionsYear);
  const publicContributions = totalContributionsYear - privateContributions;

  const stats = [
    {
      label: "Private share",
      value: `${privatePct}%`,
      sub: `${group(privateContributions)} of ${group(totalContributionsYear)}`,
    },
    {
      label: "Current streak",
      value: `${currentStreakDays} d`,
      sub: "Unbroken, through today",
    },
    {
      label: "Active days",
      value: group(activeDays),
      sub: `≈ ${perActiveDay} contributions each`,
    },
    {
      label: "Busiest day",
      value: group(busiest.count),
      sub: `Peak single day, ${isoToStamp(busiest.date)}`,
    },
  ];

  return (
    <section className="con-sec con-shell">
      <SectionHead
        index="01"
        title="Git signal"
        meta="Trailing 52 weeks · Sun → Sat"
      />

      <Panel
        label="Contribution matrix"
        meta={
          <>
            <span className="con-hi">{group(totalContributionsYear)}</span>{" "}
            total · peak {busiest.count}/day
          </>
        }
      >
        <Heatmap weeks={calendar} total={totalContributionsYear} />
      </Panel>

      <div className="con-stats">
        {stats.map((s) => (
          <div key={s.label} className="con-panel con-stat">
            <span className="con-label">{s.label}</span>
            <span className="con-stat-val">{s.value}</span>
            <span className="con-stat-sub">{s.sub}</span>
          </div>
        ))}
      </div>

      <div className="con-row-grid con-cols-5-7">
        <Panel label="Where the work lands" meta="Public vs private">
          <div className="con-split">
            <div className="con-ring-wrap">
              <span
                className="con-ring"
                aria-hidden="true"
                style={{ ["--p" as string]: `${privatePct}%` }}
              />
              <div className="con-ring-core">
                <span className="con-ring-num">{privatePct}%</span>
                <span className="con-label">Private</span>
              </div>
            </div>

            <div className="con-split-side">
              <p className="con-note con-note-below">
                Most of the year happens inside private repositories — client
                platforms, not portfolio pieces. The public trace is what&rsquo;s
                left over.
              </p>
              <div className="con-row con-row-flush">
                <span className="con-label">
                  <span
                    className="con-sw con-sw-inline con-sw-a"
                    aria-hidden="true"
                  />
                  Private
                </span>
                <span className="con-row-val">
                  {group(privateContributions)}
                </span>
              </div>
              <div className="con-row">
                <span className="con-label">
                  <span
                    className="con-sw con-sw-inline con-sw-b"
                    aria-hidden="true"
                  />
                  Public
                </span>
                <span className="con-row-val">
                  {group(publicContributions)}
                </span>
              </div>
              <div className="con-row">
                <span className="con-label">Open surface</span>
                <span className="con-row-val con-row-val-dim">
                  {group(publicCommits)} commits · {publicRepoCount} repos
                </span>
              </div>
            </div>
          </div>
        </Panel>

        <Panel label="Language distribution" meta="Share of tracked code">
          {languages.map((l, i) => (
            <div key={l.name} className="con-lang">
              <span className="con-lang-name">{l.name}</span>
              <span className="con-track">
                <span
                  className="con-fill"
                  data-hot={i === 0 ? "1" : "0"}
                  style={{
                    ["--w" as string]: `${l.pct}%`,
                    opacity: i === 0 ? 1 : 0.94 - i * 0.11,
                  }}
                />
              </span>
              <span className="con-lang-pct">{l.pct}%</span>
            </div>
          ))}
        </Panel>
      </div>
    </section>
  );
}
