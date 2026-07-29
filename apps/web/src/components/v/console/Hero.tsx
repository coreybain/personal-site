import type { Snapshot } from "@/lib/snapshot";

import { group, isoToClock } from "./format";

type Kpi = {
  label: string;
  value: string;
  unit?: string;
  sub: string;
  hot?: boolean;
};

/**
 * The five-second read: who, what, where, whether he's available — then four
 * numbers that back it up. Everything comes out of `snapshot`.
 */
export function Hero({ snapshot }: { snapshot: Snapshot }) {
  const { identity, gitStats, aiUsage, projects, computedAt } = snapshot;

  const kpis: Kpi[] = [
    {
      label: "Contributions · 12 mo",
      value: group(gitStats.totalContributionsYear),
      sub: `${gitStats.currentStreakDays}-day streak, unbroken`,
      hot: true,
    },
    {
      label: "Agent sessions",
      value: group(aiUsage.totalSessions),
      sub: `${group(aiUsage.totalHours)} hours paired`,
    },
    {
      label: "Platforms in production",
      value: String(projects.length),
      sub: `Shipped at ${identity.company}`,
    },
    {
      label: "Public commits",
      value: group(gitStats.publicCommits),
      sub: `Across ${gitStats.publicRepoCount} repositories`,
    },
  ];

  return (
    <header className="con-shell">
      <div className="con-hero">
        <div>
          <span className="con-pill">
            <span className="con-dot" aria-hidden="true" />
            {identity.availability}
          </span>

          <h1 className="con-name">{identity.name}</h1>

          <div className="con-role">
            <span className="con-role-key">{identity.role}</span>
            <span className="con-role-rule" aria-hidden="true" />
            <span className="con-role-loc">{identity.location}</span>
          </div>

          <p className="con-lede">
            I build the platforms other engineers build on — document
            automation, real-time auctions, compliance graphs — and I keep them
            running{" "}
            <strong>at enterprise scale with agents in the loop</strong>. This
            page is a readout of the last twelve months, not a résumé.
          </p>

          <div className="con-cta">
            <a className="con-btn con-btn-primary" href={`mailto:${identity.email}`}>
              Start a conversation
            </a>
            <a
              className="con-btn"
              href={`https://github.com/${identity.github}`}
              rel="noreferrer noopener"
            >
              GitHub · @{identity.github}
            </a>
          </div>
        </div>

        <aside className="con-panel">
          <header className="con-panel-head">
            <div className="con-panel-head-title">
              <h2 className="con-label">Status</h2>
            </div>
            <div className="con-panel-meta con-live-tag">
              <span className="con-dot" aria-hidden="true" />
              <span className="con-label con-label-hi">Live</span>
            </div>
          </header>

          <div className="con-readout-body">
            <div className="con-row">
              <span className="con-label">Availability</span>
              <span className="con-row-val con-hi">Open</span>
            </div>
            <div className="con-row">
              <span className="con-label">Seeking</span>
              <span className="con-row-val">{identity.role}</span>
            </div>
            <div className="con-row">
              <span className="con-label">Based</span>
              <span className="con-row-val">{identity.location}</span>
            </div>
            <div className="con-row">
              <span className="con-label">Currently</span>
              <span className="con-row-val">{identity.company}</span>
            </div>
            <div className="con-row">
              <span className="con-label">GitHub</span>
              <a
                className="con-row-val"
                href={`https://github.com/${identity.github}`}
                rel="noreferrer noopener"
              >
                @{identity.github}
              </a>
            </div>
            <div className="con-row">
              <span className="con-label">Snapshot</span>
              <span className="con-row-val con-row-val-dim">
                {isoToClock(computedAt)}
              </span>
            </div>
          </div>
        </aside>
      </div>

      <div className="con-kpi">
        {kpis.map((k) => (
          <div
            key={k.label}
            className="con-panel con-kpi-card"
            data-hot={k.hot ? "1" : "0"}
          >
            <span className="con-label">{k.label}</span>
            <span className="con-kpi-val">
              {k.value}
              {k.unit ? <span className="con-kpi-unit">{k.unit}</span> : null}
            </span>
            <span className="con-kpi-sub">{k.sub}</span>
          </div>
        ))}
      </div>
    </header>
  );
}
