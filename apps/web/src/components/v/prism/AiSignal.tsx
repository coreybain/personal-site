import type { CSSProperties } from "react";

import { snapshot } from "@/lib/snapshot";

import { SectionHead, delay } from "./SectionHead";
import { num, pct } from "./format";

const { aiUsage, gitStats } = snapshot;

const WEEKS = gitStats.calendar.length;

const sessionsPerWeek = Math.round(aiUsage.totalSessions / WEEKS);
const hoursPerWeek = Math.round(aiUsage.totalHours / WEEKS);
const avgMinutes = Math.round((aiUsage.totalHours * 60) / aiUsage.totalSessions);

const agentTotal = aiUsage.agents.reduce((sum, agent) => sum + agent.sessions, 0);
const projectPeak = Math.max(...aiUsage.topProjects.map((p) => p.sessions));

const AGENT_FILL = ["var(--pri-s1)", "var(--pri-s3)"] as const;

const DERIVED = [
  { label: "Sessions a week", value: String(sessionsPerWeek) },
  { label: "Hours a week", value: String(hoursPerWeek) },
  { label: "Average session", value: `${avgMinutes} min` },
];

export function AiSignal() {
  return (
    <section id="ai" className="pri-shell pri-rise scroll-mt-8" style={delay(520)}>
      <SectionHead
        index="03"
        eyebrow="AI-native delivery"
        title={
          <>
            {num(aiUsage.totalSessions)} agent sessions. {num(aiUsage.totalHours)}{" "}
            hours.
          </>
        }
        lede="Not a side experiment. This is the delivery method, measured across a full year of production work on the platforms above."
      />

      <div className="pri-card p-5 sm:p-7">
        <div className="grid gap-8 lg:grid-cols-12 lg:gap-12">
          {/* Volume */}
          <div className="lg:col-span-5">
            <div className="flex flex-wrap gap-x-12 gap-y-6">
              <div>
                <div className="pri-stat">{num(aiUsage.totalSessions)}</div>
                <div className="pri-eyebrow mt-2.5">Sessions</div>
              </div>
              <div>
                <div className="pri-stat">{num(aiUsage.totalHours)}</div>
                <div className="pri-eyebrow mt-2.5">Hours</div>
              </div>
            </div>

            <dl className="pri-rule mt-7 pt-1">
              {DERIVED.map((item) => (
                <div
                  key={item.label}
                  className="pri-row flex items-center justify-between gap-4 py-2.5"
                >
                  <dt className="pri-label">{item.label}</dt>
                  <dd className="pri-label pri-tnum font-semibold pri-ink">
                    {item.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Split and destination */}
          <div className="lg:col-span-7">
            <span className="pri-eyebrow">Agents in rotation</span>
            <div className="pri-meter-split mt-3.5">
              {aiUsage.agents.map((agent, i) => (
                <span
                  key={agent.name}
                  className="pri-seg"
                  style={{
                    width: `${pct(agent.sessions, agentTotal)}%`,
                    background: AGENT_FILL[i % AGENT_FILL.length],
                  }}
                />
              ))}
            </div>
            <ul className="mt-3.5 flex flex-wrap gap-x-6 gap-y-2">
              {aiUsage.agents.map((agent, i) => (
                <li key={agent.name} className="pri-micro flex items-center gap-1.5">
                  <span
                    className="block h-[7px] w-[7px] rounded-full"
                    style={{ background: AGENT_FILL[i % AGENT_FILL.length] }}
                    aria-hidden="true"
                  />
                  <span className="pri-ink-2">{agent.name}</span>
                  <span className="pri-tnum">
                    {num(agent.sessions)} · {pct(agent.sessions, agentTotal)}%
                  </span>
                </li>
              ))}
            </ul>

            <div className="pri-rule mt-7 pt-6">
              <span className="pri-eyebrow">Where the sessions landed</span>
              <ul className="mt-4 grid gap-4">
                {aiUsage.topProjects.map((project) => {
                  // Clamped to >=1 so `--pri-bar-span` below can never divide
                  // by zero if a future snapshot ships a near-empty project.
                  const share = Math.max(
                    1,
                    Math.round((project.sessions / projectPeak) * 100),
                  );
                  return (
                    <li
                      key={project.name}
                      className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2"
                    >
                      <span className="text-[0.8125rem] font-semibold tracking-[-0.014em]">
                        {project.name}
                      </span>
                      <span className="pri-label pri-tnum">{num(project.sessions)}</span>
                      <div className="pri-bar col-span-2">
                        <div
                          className="pri-bar-fill"
                          style={
                            {
                              width: `${share}%`,
                              // Stretch the spectrum across the whole track, not
                              // just this bar, so the three read as one scale.
                              "--pri-bar-span": `${((100 / share) * 100).toFixed(2)}%`,
                            } as CSSProperties
                          }
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
