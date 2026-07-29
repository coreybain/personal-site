import type { AiUsage } from "@/lib/snapshot";

import { Meter, Panel, SectionHead } from "./Panel";
import { group, pctOf } from "./format";

/**
 * Agents as evidence rather than novelty: volume, cadence, which harness, and
 * which production platform absorbs the load. Every figure is either read from
 * `aiUsage` or derived from its two totals — nothing here is invented.
 */
export function AiSignal({ aiUsage }: { aiUsage: AiUsage }) {
  const { totalSessions, totalHours, agents, topProjects } = aiUsage;

  const avgSessionMins = Math.round((totalHours / totalSessions) * 60);
  const sessionsPerWeek = Math.round(totalSessions / 52);
  const hoursPerWeek = Math.round(totalHours / 52);
  const agentTotal = agents.reduce((sum, a) => sum + a.sessions, 0);
  const projectMax = Math.max(...topProjects.map((p) => p.sessions));

  return (
    <section className="con-sec con-shell">
      <SectionHead
        index="03"
        title="AI-native delivery"
        meta="Rolling 12 months · all repos"
      />

      <div className="con-row-grid con-row-grid-flush con-cols-3">
        <Panel label="Throughput" meta={`${group(totalHours)} hrs`}>
          <span className="con-label">Sessions driven</span>
          <div className="con-big">
            <span className="con-big-num">{group(totalSessions)}</span>
          </div>

          <div className="con-cadence">
            <div>
              <span className="con-label">Per wk</span>
              <span className="con-cadence-val">{sessionsPerWeek}</span>
            </div>
            <div>
              <span className="con-label">Hrs / wk</span>
              <span className="con-cadence-val">{hoursPerWeek}</span>
            </div>
            <div>
              <span className="con-label">Avg</span>
              <span className="con-cadence-val">{avgSessionMins}m</span>
            </div>
          </div>

          <p className="con-note con-note-above">
            <strong>
              {sessionsPerWeek} sessions and {hoursPerWeek} hours a week
            </strong>
            , every week. Agents are the delivery pipeline here, reviewed and
            owned like any other engineer&rsquo;s output.
          </p>
        </Panel>

        <Panel label="Harness split" meta={`${group(agentTotal)} sessions`}>
          {agents.map((a, i) => (
            <Meter
              key={a.name}
              name={a.name}
              value={`${group(a.sessions)} · ${pctOf(a.sessions, agentTotal, 0)}%`}
              pct={(a.sessions / agentTotal) * 100}
              hot={i === 0}
            />
          ))}
          <p className="con-note con-note-above">
            Two harnesses, one workflow — whichever tool fits the task, with the
            review discipline held constant across both.
          </p>
        </Panel>

        <Panel label="Highest agent load" meta="Sessions by platform">
          {topProjects.map((p, i) => (
            <Meter
              key={p.name}
              name={p.name}
              value={group(p.sessions)}
              pct={(p.sessions / projectMax) * 100}
              hot={i === 0}
            />
          ))}
          <p className="con-note con-note-above">
            Production platforms with paying customers, not sandboxes — the load
            tracks where the hardest problems live.
          </p>
        </Panel>
      </div>
    </section>
  );
}
