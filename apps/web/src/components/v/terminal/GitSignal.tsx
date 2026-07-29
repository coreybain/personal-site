import type { GitStats } from "@/lib/snapshot";
import { Heatmap } from "./Heatmap";
import { Panel, SectionHead } from "./Panel";
import { group, pctOf } from "./format";

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

  const privatePct = pctOf(privateContributions, totalContributionsYear);
  /** How many of every 100 contributions land in a private repo. */
  const privateSquares = Math.round(
    (privateContributions / totalContributionsYear) * 100,
  );
  const activeDays = calendar.flat().filter((d) => d.count > 0).length;
  const busiest = calendar
    .flat()
    .reduce((a, b) => (b.count > a.count ? b : a));
  const perActiveDay = (totalContributionsYear / activeDays).toFixed(1);

  const substats = [
    {
      label: "Private share",
      value: `${privatePct}%`,
      sub: `${group(privateContributions)} of ${group(totalContributionsYear)}`,
    },
    {
      label: "Current streak",
      value: `${currentStreakDays} d`,
      sub: "unbroken, through today",
    },
    {
      label: "Active days",
      value: group(activeDays),
      sub: `≈ ${perActiveDay} per active day`,
    },
    {
      label: "Public surface",
      value: group(publicCommits),
      sub: `commits across ${publicRepoCount} repos`,
    },
  ];

  return (
    <section className="obs-sec obs-shell">
      <SectionHead
        index="01"
        title="Git signal"
        meta="Trailing 52 weeks · Sun → Sat"
      />

      <Panel
        label="Contribution matrix"
        meta={
          <>
            <span style={{ color: "var(--obs-amber)" }}>
              {group(totalContributionsYear)}
            </span>{" "}
            total · peak {busiest.count} / day
          </>
        }
        padded={false}
      >
        <div className="obs-panel-body">
          <Heatmap weeks={calendar} total={totalContributionsYear} />
        </div>

        <div className="obs-substats">
          {substats.map((s) => (
            <div key={s.label} className="obs-substat">
              <span className="obs-label">{s.label}</span>
              <span className="obs-substat-val">{s.value}</span>
              <span className="obs-substat-sub">{s.sub}</span>
            </div>
          ))}
        </div>
      </Panel>

      <div className="obs-row obs-row-5-7">
        <Panel
          label="Where the work lands"
          meta="Per 100 contributions"
          delay={80}
        >
          <div
            style={{
              display: "flex",
              gap: "1.4rem",
              alignItems: "flex-start",
              flexWrap: "wrap",
            }}
          >
            <div className="obs-dots" aria-hidden="true">
              {Array.from({ length: 100 }, (_, i) => (
                <i
                  key={i}
                  data-k={i >= privateSquares ? "pub" : "priv"}
                  style={{ ["--c" as string]: i }}
                />
              ))}
            </div>
            <div style={{ flex: "1 1 180px", minWidth: 0 }}>
              <p className="obs-note" style={{ marginBottom: "1rem" }}>
                {privatePct}% of the year happens inside private repositories —
                client platforms, not portfolio pieces. The public trace is the
                remainder.
              </p>
              <div className="obs-status-row" style={{ paddingTop: 0 }}>
                <span className="obs-label">
                  <span
                    className="obs-legend-sw"
                    style={{
                      display: "inline-block",
                      background: "var(--obs-l2)",
                      marginRight: 7,
                      verticalAlign: -1,
                    }}
                  />
                  Private
                </span>
                <span className="obs-status-val">
                  {group(privateContributions)}
                </span>
              </div>
              <div className="obs-status-row">
                <span className="obs-label">
                  <span
                    className="obs-legend-sw"
                    style={{
                      display: "inline-block",
                      background: "var(--obs-teal)",
                      marginRight: 7,
                      verticalAlign: -1,
                    }}
                  />
                  Public
                </span>
                <span className="obs-status-val">
                  {group(totalContributionsYear - privateContributions)}
                </span>
              </div>
            </div>
          </div>
        </Panel>

        <Panel
          label="Language distribution"
          meta="Share of tracked code"
          delay={140}
        >
          {languages.map((l, i) => (
            <div key={l.name} className="obs-lang">
              <span className="obs-lang-name">{l.name}</span>
              <span className="obs-track">
                <span
                  className="obs-fill"
                  data-hot={i === 0 ? "1" : "0"}
                  style={{
                    ["--w" as string]: `${l.pct}%`,
                    ["--d" as string]: `${240 + i * 80}ms`,
                    opacity: i === 0 ? 1 : 0.92 - i * 0.13,
                  }}
                />
              </span>
              <span className="obs-lang-pct">{l.pct}%</span>
            </div>
          ))}
        </Panel>
      </div>
    </section>
  );
}
