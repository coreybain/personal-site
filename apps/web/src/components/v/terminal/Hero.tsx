import type { Snapshot } from "@/lib/snapshot";
import { group, isoToClock } from "./format";

type Kpi = { label: string; value: string; unit?: string };

export function Hero({ snapshot }: { snapshot: Snapshot }) {
  const { identity, gitStats, aiUsage, projects, computedAt } = snapshot;

  const kpis: Kpi[] = [
    {
      label: "Contributions · 12 mo",
      value: group(gitStats.totalContributionsYear),
    },
    { label: "Agent sessions", value: group(aiUsage.totalSessions) },
    { label: "Agent hours", value: group(aiUsage.totalHours), unit: "hrs" },
    { label: "Platforms in production", value: String(projects.length) },
  ];

  return (
    <header className="obs-shell">
      <div className="obs-hero">
        <div className="obs-rise" style={{ ["--d" as string]: "60ms" }}>
          <div className="obs-eyebrow">
            <span className="obs-label">{identity.company}</span>
            <span className="obs-dotsep" aria-hidden="true" />
            <span className="obs-label">{identity.location}</span>
          </div>

          <h1 className="obs-name">{identity.name}</h1>

          <p className="obs-role">
            {identity.role}
            <span className="obs-role-line" aria-hidden="true" />
          </p>

          <p className="obs-lede">
            I build the platforms other engineers build on — document
            automation, real-time auctions, compliance graphs — and I run them{" "}
            <strong>at enterprise scale with agents in the loop</strong>. This
            page is generated from live telemetry, not a résumé.
          </p>
        </div>

        <div
          className="obs-panel obs-rise"
          style={{ ["--d" as string]: "180ms" }}
        >
          <div className="obs-panel-body" style={{ paddingBlock: "0.5rem" }}>
            <div className="obs-status-row">
              <span className="obs-label">Status</span>
              <span className="obs-status-val">
                <span
                  className="obs-dot obs-dot-teal"
                  style={{ marginRight: 8 }}
                  aria-hidden="true"
                />
                Available
              </span>
            </div>
            <div className="obs-status-row">
              <span className="obs-label">Seeking</span>
              <span className="obs-status-val">{identity.role}</span>
            </div>
            <div className="obs-status-row">
              <span className="obs-label">Based</span>
              <span className="obs-status-val">{identity.location}</span>
            </div>
            <div className="obs-status-row">
              <span className="obs-label">GitHub</span>
              <a
                className="obs-status-val"
                href={`https://github.com/${identity.github}`}
                rel="noreferrer noopener"
              >
                @{identity.github}
              </a>
            </div>
            <div className="obs-status-row">
              <span className="obs-label">Computed</span>
              <span className="obs-status-val" style={{ color: "var(--obs-faint)" }}>
                {isoToClock(computedAt)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="obs-kpi">
        {kpis.map((k, i) => (
          <div
            key={k.label}
            className="obs-kpi-cell obs-rise"
            style={{ ["--d" as string]: `${300 + i * 70}ms` }}
          >
            <span className="obs-label">{k.label}</span>
            <span className="obs-kpi-val">
              {k.value}
              {k.unit ? <span className="obs-kpi-unit">{k.unit}</span> : null}
            </span>
          </div>
        ))}
      </div>
    </header>
  );
}
