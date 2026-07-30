import type { AiUsage } from "@/lib/snapshot";

import { DeckHead, Meter, Panel } from "./Panel";
import { num, pct } from "./format";

const AGENT_FILL = ["var(--hor-l4)", "var(--hor-l2)"] as const;

/**
 * Deck zone, panel 02 — how the work actually gets made.
 *
 * `weeks` is `gitStats.calendar.length`, passed in rather than reached for, and
 * that is the point of the prop: every "a week" figure on this panel is divided
 * by the *same* window the heatmap above it draws, so the two panels cannot
 * disagree about how long "the year" was. The page reads it once from the one
 * `Snapshot` it fetched and hands it to both.
 *
 * As in `GitSignal`, the reductions live in the body: folded at module scope
 * they would be computed once per process and could never see a Convex row.
 */
export function AiSignal({
  aiUsage,
  weeks,
}: {
  aiUsage: AiUsage;
  /** Weeks in the contribution window — `gitStats.calendar.length`. */
  weeks: number;
}) {
  const sessionsPerWeek = Math.round(aiUsage.totalSessions / weeks);
  const hoursPerWeek = Math.round(aiUsage.totalHours / weeks);
  const avgMinutes = Math.round((aiUsage.totalHours * 60) / aiUsage.totalSessions);

  const agentTotal = aiUsage.agents.reduce((sum, a) => sum + a.sessions, 0);
  const projectPeak = Math.max(...aiUsage.topProjects.map((p) => p.sessions));
  const inTopThree = aiUsage.topProjects.reduce((sum, p) => sum + p.sessions, 0);

  const CADENCE = [
    { label: "Sessions a week", value: num(sessionsPerWeek) },
    { label: "Hours a week", value: num(hoursPerWeek) },
    { label: "Average session", value: `${avgMinutes} min` },
    { label: "Agents in rotation", value: String(aiUsage.agents.length) },
  ];

  return (
    <section id="ai" className="mt-14 scroll-mt-20 sm:mt-16">
      <DeckHead
        index="02"
        title="AI-native delivery"
        meta="Same 52 weeks · measured, not estimated"
      />

      <div className="grid gap-3 lg:grid-cols-12">
        <Panel
          label="Throughput"
          meta="Agent sessions · hours"
          className="lg:col-span-5"
          delay={40}
        >
          <div className="flex flex-wrap gap-x-10 gap-y-6">
            <div>
              <div className="hor-readout">{num(aiUsage.totalSessions)}</div>
              <div className="hor-label mt-2.5">Sessions</div>
            </div>
            <div>
              <div className="hor-readout">{num(aiUsage.totalHours)}</div>
              <div className="hor-label mt-2.5">Hours at the desk</div>
            </div>
          </div>

          <p className="hor-micro mt-5 max-w-[46ch]">
            Not a side experiment. Agents are the delivery method: every platform
            below was specified, reviewed and shipped with one in the loop.
          </p>

          <div className="mt-5 border-t border-[var(--hor-line-soft)] pt-1">
            {CADENCE.map((item) => (
              <div key={item.label} className="hor-row">
                <span className="hor-label">{item.label}</span>
                <span className="hor-mono hor-micro" style={{ color: "var(--hor-ink)" }}>
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          label="Agent mix"
          meta={`${num(agentTotal)} sessions`}
          className="lg:col-span-3"
          delay={100}
        >
          <div className="hor-split">
            {aiUsage.agents.map((agent, i) => (
              <span
                key={agent.name}
                style={{
                  width: `${pct(agent.sessions, agentTotal)}%`,
                  background: AGENT_FILL[i % AGENT_FILL.length],
                }}
              />
            ))}
          </div>

          <ul className="mt-4 grid gap-3">
            {aiUsage.agents.map((agent, i) => (
              <li key={agent.name}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="hor-body flex items-center gap-2" style={{ color: "var(--hor-ink)" }}>
                    <span
                      className="hor-swatch"
                      style={{ background: AGENT_FILL[i % AGENT_FILL.length], width: 7, height: 7 }}
                      aria-hidden="true"
                    />
                    {agent.name}
                  </span>
                  <span className="hor-mono hor-micro" style={{ color: "var(--hor-ink-2)" }}>
                    {pct(agent.sessions, agentTotal)}%
                  </span>
                </div>
                <p className="hor-micro mt-1">{num(agent.sessions)} sessions</p>
              </li>
            ))}
          </ul>

          <div className="mt-5 border-t border-[var(--hor-line-soft)] pt-1">
            <div className="hor-row">
              <span className="hor-label">Combined per week</span>
              <span className="hor-mono hor-micro" style={{ color: "var(--hor-ink)" }}>
                {num(Math.round(agentTotal / weeks))}
              </span>
            </div>
          </div>
        </Panel>

        <Panel
          label="Where the sessions landed"
          meta={`Top ${aiUsage.topProjects.length} · ${pct(
            inTopThree,
            aiUsage.totalSessions,
          )}% of all sessions`}
          className="lg:col-span-4"
          delay={150}
        >
          <div className="grid gap-3.5">
            {aiUsage.topProjects.map((project, i) => (
              <Meter
                key={project.name}
                name={project.name}
                value={`${num(project.sessions)} · ${pct(
                  project.sessions,
                  aiUsage.totalSessions,
                )}%`}
                share={Math.round((project.sessions / projectPeak) * 100)}
                hot={i === 0}
                delay={320 + i * 80}
              />
            ))}
          </div>

          <p className="hor-micro mt-5 border-t border-[var(--hor-line-soft)] pt-3.5">
            Bars are scaled to the busiest platform ({num(projectPeak)} sessions);
            percentages are of the full {num(aiUsage.totalSessions)}.
          </p>
        </Panel>
      </div>
    </section>
  );
}
