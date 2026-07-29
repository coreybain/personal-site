import type { AiUsage } from "@/lib/snapshot";
import { Meter, Panel, SectionHead } from "./Panel";
import { group, pctOf } from "./format";

export function AiSignal({ aiUsage }: { aiUsage: AiUsage }) {
  const { totalSessions, totalHours, agents, topProjects } = aiUsage;

  // Derived, not invented — everything below comes out of the two totals.
  const avgSessionMins = Math.round((totalHours / totalSessions) * 60);
  const sessionsPerWeek = (totalSessions / 52).toFixed(0);
  const hoursPerWeek = (totalHours / 52).toFixed(0);
  const agentTotal = agents.reduce((sum, a) => sum + a.sessions, 0);
  const projectMax = Math.max(...topProjects.map((p) => p.sessions));

  return (
    <section className="obs-sec obs-shell">
      <SectionHead
        index="03"
        title="Agent telemetry"
        meta="Rolling 12 months · all repos"
      />

      <Panel
        label="AI-native delivery"
        meta={`${group(totalSessions)} sessions · ${group(totalHours)} hours`}
      >
        <div className="obs-ai">
          <div>
            <span className="obs-label">Sessions driven</span>
            <div className="obs-ai-big" style={{ marginTop: "0.6rem" }}>
              <span className="obs-ai-num">{group(totalSessions)}</span>
              <span className="obs-label">
                {group(totalHours)} hrs paired
              </span>
            </div>
            <p className="obs-note" style={{ marginTop: "1.15rem" }}>
              Roughly <strong style={{ color: "var(--obs-fg)" }}>
                {sessionsPerWeek} sessions
              </strong>{" "}
              and {hoursPerWeek} hours a week, every week, at an average of{" "}
              {avgSessionMins} minutes a session. Agents aren&rsquo;t a
              demo here — they are the delivery pipeline, reviewed and owned
              like any other engineer&rsquo;s output.
            </p>
          </div>

          <div className="obs-vrule" aria-hidden="true" />

          <div>
            <span className="obs-label" style={{ display: "block", marginBottom: "1rem" }}>
              Agent split
            </span>
            {agents.map((a, i) => (
              <Meter
                key={a.name}
                name={a.name}
                value={`${group(a.sessions)} · ${pctOf(a.sessions, agentTotal, 0)}%`}
                pct={(a.sessions / agentTotal) * 100}
                hot={i === 0}
                delay={260 + i * 90}
              />
            ))}
            <p
              className="obs-label"
              style={{ marginTop: "0.35rem", lineHeight: 1.5 }}
            >
              Two harnesses, one workflow —<br />
              whichever tool fits the task.
            </p>
          </div>

          <div className="obs-vrule" aria-hidden="true" />

          <div>
            <span className="obs-label" style={{ display: "block", marginBottom: "1rem" }}>
              Highest agent load
            </span>
            {topProjects.map((p, i) => (
              <Meter
                key={p.name}
                name={p.name}
                value={`${group(p.sessions)}`}
                pct={(p.sessions / projectMax) * 100}
                hot={i === 0}
                delay={340 + i * 90}
              />
            ))}
            <p
              className="obs-label"
              style={{ marginTop: "0.35rem", lineHeight: 1.5 }}
            >
              Production platforms, not toys.
            </p>
          </div>
        </div>
      </Panel>
    </section>
  );
}
