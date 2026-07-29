import { snapshot } from "@/lib/snapshot";

import { LEVEL_VAR } from "./Heatmap";
import { SectionHeading } from "./SectionHeading";
import { StatRail, type RailCell } from "./StatRail";
import { delay, num, pct } from "./format";

const { aiUsage } = snapshot;

const WEEKS = snapshot.gitStats.calendar.length;

const sessionsPerWeek = Math.round(aiUsage.totalSessions / WEEKS);
const hoursPerWeek = Math.round(aiUsage.totalHours / WEEKS);
const avgMinutes = Math.round((aiUsage.totalHours * 60) / aiUsage.totalSessions);
const hoursPerDay = Math.round((aiUsage.totalHours / (WEEKS * 7)) * 10) / 10;

const agentTotal = aiUsage.agents.reduce((sum, agent) => sum + agent.sessions, 0);
const projectPeak = Math.max(...aiUsage.topProjects.map((p) => p.sessions));

/** Two steps of the shared sequential ramp — never two arbitrary hues. */
const AGENT_FILL = [LEVEL_VAR[4], LEVEL_VAR[2]] as const;

/* Donut geometry. Fixed numbers, computed once — the box is 148 × 148 in both
 * themes, so a theme flip cannot move a pixel of it. */
const R = 62;
const STROKE = 12;
const CIRCUMFERENCE = 2 * Math.PI * R;
/* Visible gap between segments. Round linecaps extend STROKE / 2 past each
 * dash end, so each dash is inset by (SEG_GAP + STROKE) in total — half at
 * each end — for a SEG_GAP-wide gap to survive the caps. */
const SEG_GAP = 4;
const CAP_INSET = SEG_GAP + STROKE;

const segments = aiUsage.agents.map((agent, i) => {
  const share = agent.sessions / agentTotal;
  const offsetShare = aiUsage.agents
    .slice(0, i)
    .reduce((sum, a) => sum + a.sessions / agentTotal, 0);
  const length = Math.max(share * CIRCUMFERENCE - CAP_INSET, 1);
  return {
    name: agent.name,
    sessions: agent.sessions,
    share: pct(agent.sessions, agentTotal),
    fill: AGENT_FILL[i % AGENT_FILL.length],
    length,
    offset: offsetShare * CIRCUMFERENCE + CAP_INSET / 2,
  };
});

const RAIL: RailCell[] = [
  {
    value: String(sessionsPerWeek),
    label: "Sessions a week",
    sub: "Averaged over 52 weeks",
  },
  {
    value: String(avgMinutes),
    unit: "min",
    label: "Average session",
    sub: `${num(aiUsage.totalHours)} hours in total`,
  },
  {
    value: String(hoursPerWeek),
    unit: "hrs",
    label: "Paired each week",
    sub: `About ${hoursPerDay} hours a day`,
  },
  {
    value: String(aiUsage.agents.length),
    label: "Agents in rotation",
    sub: aiUsage.agents.map((a) => a.name).join(" · "),
  },
];

export function AiSignal() {
  return (
    <section id="ai" className="noc-rise scroll-mt-16" style={delay(520)}>
      <SectionHeading
        index="03"
        eyebrow="AI-native delivery"
        title={
          <>
            {num(aiUsage.totalSessions)} agent sessions. {num(aiUsage.totalHours)}{" "}
            hours.
          </>
        }
        lede="Not a side experiment — this is the delivery method, measured across a full year of production work."
      />

      <div className="noc-card noc-card-tint overflow-hidden">
        <div className="grid gap-9 p-5 sm:p-7 lg:grid-cols-12 lg:gap-10">
          {/* Agent split — hand-built donut, no chart library */}
          <div className="lg:col-span-5">
            <span className="noc-eyebrow">Split by agent</span>

            <div className="mt-5 flex flex-wrap items-center gap-6">
              <div className="noc-donut">
                <svg
                  className="noc-donut-svg"
                  viewBox="0 0 148 148"
                  role="img"
                  aria-label={segments
                    .map((s) => `${s.name}: ${num(s.sessions)} sessions, ${s.share}%`)
                    .join(". ")}
                >
                  <circle
                    className="noc-donut-track"
                    cx="74"
                    cy="74"
                    r={R}
                    fill="none"
                    strokeWidth={STROKE}
                  />
                  {segments.map((seg) => (
                    <circle
                      key={seg.name}
                      cx="74"
                      cy="74"
                      r={R}
                      fill="none"
                      stroke={seg.fill}
                      strokeWidth={STROKE}
                      strokeLinecap="round"
                      strokeDasharray={`${seg.length} ${CIRCUMFERENCE - seg.length}`}
                      strokeDashoffset={-seg.offset}
                    />
                  ))}
                </svg>
                <div className="noc-donut-center" aria-hidden="true">
                  <span className="noc-stat-sm">{num(aiUsage.totalSessions)}</span>
                  <span className="noc-micro">sessions</span>
                </div>
              </div>

              <ul className="flex min-w-[9rem] flex-col gap-3.5">
                {segments.map((seg) => (
                  <li key={seg.name}>
                    <div className="flex items-center gap-2">
                      <span
                        className="noc-swatch"
                        style={{ background: seg.fill }}
                        aria-hidden="true"
                      />
                      <span className="text-[13px] font-medium tracking-[-0.012em]">
                        {seg.name}
                      </span>
                    </div>
                    <p className="noc-micro noc-tnum mt-1 pl-[15px]">
                      {num(seg.sessions)} · {seg.share}%
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Where the hours actually went */}
          <div className="lg:col-span-7">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <span className="noc-eyebrow">Where the sessions landed</span>
              <span className="noc-micro noc-mono">Top {aiUsage.topProjects.length}</span>
            </div>

            <ul className="mt-5 grid gap-4">
              {aiUsage.topProjects.map((project) => (
                <li
                  key={project.name}
                  className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2"
                >
                  <span className="text-[13px] font-medium tracking-[-0.012em]">
                    {project.name}
                  </span>
                  <span className="noc-label noc-tnum">{num(project.sessions)}</span>
                  <div className="noc-bar-track col-span-2">
                    <div
                      className="noc-bar-fill"
                      style={{
                        width: `${Math.round((project.sessions / projectPeak) * 100)}%`,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>

            <p className="noc-label mt-6 max-w-[46ch] text-pretty">
              Agents draft, refactor and test alongside me; I own the
              architecture, the review and what ships. The number that matters
              is not how many sessions — it is that the platforms above were
              delivered this way.
            </p>
          </div>
        </div>

        <StatRail cells={RAIL} className="noc-hair" />
      </div>
    </section>
  );
}
