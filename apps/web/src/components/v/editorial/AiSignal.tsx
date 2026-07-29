import { snapshot } from "@/lib/snapshot";
import { SectionHeader } from "./SectionHeader";
import { longDate, num } from "./format";

const { aiUsage, gitStats } = snapshot;

const weeks = gitStats.calendar.length;
const avgSessionMinutes = Math.round((aiUsage.totalHours * 60) / aiUsage.totalSessions);
const sessionsPerWeek = Math.round(aiUsage.totalSessions / weeks);
const hoursPerWeek = Math.round(aiUsage.totalHours / weeks);
const agentTotal = aiUsage.agents.reduce((sum, a) => sum + a.sessions, 0);
const projectMax = Math.max(...aiUsage.topProjects.map((p) => p.sessions));

const leadAgent = aiUsage.agents[0];
const leadShare = Math.round((leadAgent.sessions / agentTotal) * 100);
const restNames = aiUsage.agents
  .slice(1)
  .map((a) => a.name)
  .join(" and ");

const figures = [
  {
    value: num(aiUsage.totalSessions),
    label: "Agent sessions",
    note: `About ${num(sessionsPerWeek)} a week, every week, for a year.`,
  },
  {
    value: num(aiUsage.totalHours),
    label: "Hours in session",
    note: `Roughly ${num(hoursPerWeek)} hours a week of supervised machine work.`,
  },
  {
    value: num(avgSessionMinutes),
    label: "Minutes per session",
    note: "Short, scoped units of work — not one long conversation.",
  },
  {
    value: String(aiUsage.agents.length),
    label: "Agents in rotation",
    note: restNames
      ? `${leadAgent.name} carries ${leadShare}% of it; the rest goes to ${restNames}.`
      : `${leadAgent.name} carries all of it.`,
  },
];

export function AiSignal() {
  return (
    <section className="ed-wrap ed-band" id="agents">
      <SectionHeader
        index="03"
        label="Working With Agents"
        meta="Twelve months, measured"
        thesis={
          <>
            <em className="ed-hl ed-num">{num(aiUsage.totalSessions)}</em> agent
            sessions. <em className="ed-hl ed-num">{num(aiUsage.totalHours)}</em>{" "}
            hours. Not a demo &mdash; the way the work gets done.
          </>
        }
      />

      <div className="ed-figs ed-rise">
        {figures.map((fig) => (
          <div className="ed-fig" key={fig.label}>
            <p className="ed-fig-val ed-num">{fig.value}</p>
            <p className="ed-caps ed-fig-label">{fig.label}</p>
            <p className="ed-fig-note">{fig.note}</p>
          </div>
        ))}
      </div>

      <div className="ed-ai">
        <div className="ed-rise">
          <p className="ed-pull">
            Agents didn&rsquo;t replace the engineering. They raised the ceiling on
            how much of it fits in a year.
          </p>
          <p className="ed-footnote">
            Counted from local agent session logs, not self-report &mdash; twelve
            months to {longDate(snapshot.computedAt.slice(0, 10))}. Sessions are
            attributed to the repository they ran against.
          </p>
        </div>

        <div className="ed-bar-groups ed-rise">
          <div>
            <p className="ed-caps ed-bars-label">Sessions by agent</p>
            <div className="ed-bars">
              {aiUsage.agents.map((agent, i) => {
                const pct = Math.round((agent.sessions / agentTotal) * 100);
                return (
                  <div key={agent.name}>
                    <div className="ed-bar-head">
                      <span className="ed-bar-name">{agent.name}</span>
                      <span className="ed-caps ed-bar-val">
                        {num(agent.sessions)} &middot; {pct}%
                      </span>
                    </div>
                    <div className="ed-bar-track">
                      <div
                        className="ed-bar-fill"
                        data-lead={i === 0}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <p className="ed-caps ed-bars-label">Where the sessions went</p>
            <div className="ed-bars">
              {aiUsage.topProjects.map((project) => (
                <div key={project.name}>
                  <div className="ed-bar-head">
                    <span className="ed-bar-name">{project.name}</span>
                    <span className="ed-caps ed-bar-val">
                      {num(project.sessions)}
                    </span>
                  </div>
                  <div className="ed-bar-track">
                    <div
                      className="ed-bar-fill ed-bar-fill--muted"
                      style={{
                        width: `${Math.round((project.sessions / projectMax) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default AiSignal;
