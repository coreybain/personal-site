import { snapshot } from "@/lib/snapshot";

import styles from "./aurora.module.css";
import { SectionHeading } from "./SectionHeading";
import { num, pct } from "./format";

const { aiUsage } = snapshot;

const WEEKS_PER_YEAR = snapshot.gitStats.calendar.length;

const sessionsPerWeek = Math.round(aiUsage.totalSessions / WEEKS_PER_YEAR);
const avgMinutes = Math.round((aiUsage.totalHours * 60) / aiUsage.totalSessions);
const hoursPerWeek = Math.round(aiUsage.totalHours / WEEKS_PER_YEAR);

const agentTotal = aiUsage.agents.reduce((sum, agent) => sum + agent.sessions, 0);
const projectPeak = Math.max(...aiUsage.topProjects.map((p) => p.sessions));

const AGENT_FILL = ["var(--aur-lv4)", "var(--aur-lv2)"] as const;

const DERIVED = [
  { label: "Sessions a week", value: String(sessionsPerWeek) },
  { label: "Average session", value: `${avgMinutes} min` },
  { label: "Hours a week", value: String(hoursPerWeek) },
];

export function AiSignal() {
  return (
    <section
      id="ai"
      className={`${styles.rise} scroll-mt-16`}
      style={{ "--aur-delay": "500ms" } as React.CSSProperties}
    >
      <SectionHeading
        index="03"
        eyebrow="AI-native delivery"
        title={
          <>
            {num(aiUsage.totalSessions)} agent sessions.{" "}
            {num(aiUsage.totalHours)} hours.
          </>
        }
        lede="Not an experiment on the side — this is the delivery method, measured over a full year of production work."
      />

      <div className={`${styles.cardTint} p-5 sm:p-7`}>
        <div className="grid gap-8 lg:grid-cols-12 lg:gap-10">
          {/* Headline volume */}
          <div className="lg:col-span-5">
            <div className="flex flex-wrap gap-x-10 gap-y-6">
              <div>
                <div className={styles.stat}>{num(aiUsage.totalSessions)}</div>
                <div className={`${styles.eyebrow} mt-2`}>Sessions</div>
              </div>
              <div>
                <div className={styles.stat}>{num(aiUsage.totalHours)}</div>
                <div className={`${styles.eyebrow} mt-2`}>Hours</div>
              </div>
            </div>

            <dl className={`${styles.hairline} mt-6 pt-1`}>
              {DERIVED.map((item) => (
                <div
                  key={item.label}
                  className={`${styles.rowRule} flex items-center justify-between gap-4 py-2.5`}
                >
                  <dt className={styles.label}>{item.label}</dt>
                  <dd className={`${styles.label} ${styles.tnum} font-medium`} style={{ color: "var(--aur-ink)" }}>
                    {item.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Agent split + where the hours went */}
          <div className="lg:col-span-7">
            <span className={styles.eyebrow}>Agents in rotation</span>
            <div className={`${styles.meterSplit} mt-3.5`}>
              {aiUsage.agents.map((agent, i) => (
                <span
                  key={agent.name}
                  className={styles.meterSeg}
                  style={{
                    width: `${pct(agent.sessions, agentTotal)}%`,
                    background: AGENT_FILL[i % AGENT_FILL.length],
                  }}
                />
              ))}
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
              {aiUsage.agents.map((agent, i) => (
                <li key={agent.name} className={`${styles.micro} flex items-center gap-1.5`}>
                  <span
                    className="block h-[7px] w-[7px] rounded-full"
                    style={{ background: AGENT_FILL[i % AGENT_FILL.length] }}
                    aria-hidden="true"
                  />
                  <span style={{ color: "var(--aur-ink-2)" }}>{agent.name}</span>
                  <span className={styles.tnum}>
                    {num(agent.sessions)} · {pct(agent.sessions, agentTotal)}%
                  </span>
                </li>
              ))}
            </ul>

            <div className={`${styles.hairline} mt-6 pt-6`}>
              <span className={styles.eyebrow}>Where the sessions landed</span>
              <ul className="mt-4 grid gap-3.5">
                {aiUsage.topProjects.map((project) => (
                  <li key={project.name} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2">
                    <span className="text-[13px] font-medium tracking-[-0.012em]">
                      {project.name}
                    </span>
                    <span className={`${styles.label} ${styles.tnum}`}>
                      {num(project.sessions)}
                    </span>
                    <div className={`${styles.bar} col-span-2`}>
                      <div
                        className={styles.barFill}
                        style={{ width: `${Math.round((project.sessions / projectPeak) * 100)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
