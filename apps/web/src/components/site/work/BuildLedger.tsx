import { DeckHead, Meter, Panel } from "@/components/site/Panel";
import { num, pct } from "@/components/site/format";
import { snapshot } from "@/lib/snapshot";

import {
  avgBuildMinutes,
  buildHours,
  buildProjects,
  buildSessions,
  peakBuildSessions,
} from "./data";

const { aiUsage, projects } = snapshot;

/**
 * Deck zone. Below the horizon the page stops talking and starts reading out.
 *
 * The homepage's AI panel ranks the top three projects by session count; this
 * is the full ledger — every client platform, with the desk hours beside the
 * sessions. Bars are scaled to the busiest platform, percentages are of the
 * complete session total, and both facts are stated in the footnote rather
 * than left for the reader to guess.
 */
const SUBSTATS = [
  {
    label: "Sessions logged",
    value: num(buildSessions),
    sub: `${pct(buildSessions, aiUsage.totalSessions)}% of every session on record`,
  },
  {
    label: "Hours in build",
    value: num(buildHours),
    sub: `≈ ${num(Math.round(buildHours / Math.max(buildProjects.length, 1)))} per platform`,
  },
  {
    label: "Average session",
    value: `${avgBuildMinutes} min`,
    sub: "specify, review, ship, repeat",
  },
  {
    label: "Agents in rotation",
    value: String(aiUsage.agents.length),
    sub: aiUsage.agents.map((a) => a.name).join(" · "),
  },
];

export function BuildLedger() {
  return (
    <section className="pt-2">
      <DeckHead
        index="02"
        title="Build ledger"
        meta={`${buildProjects.length} of ${projects.length} platforms · measured, not estimated`}
      />

      <Panel
        label="Agent effort by platform"
        meta={
          <>
            <span className="hor-hot">{num(buildSessions)}</span> sessions ·{" "}
            {num(buildHours)} hours
          </>
        }
        padded={false}
        delay={40}
      >
        <div className="hor-panel-body">
          <div className="grid gap-3.5">
            {buildProjects.map((project, i) => (
              <Meter
                key={project.slug}
                name={project.title}
                value={`${num(project.aiBuildStats.sessions)} · ${num(
                  project.aiBuildStats.hours,
                )} h`}
                share={
                  peakBuildSessions === 0
                    ? 0
                    : Math.round(
                        (project.aiBuildStats.sessions / peakBuildSessions) * 100,
                      )
                }
                hot={project.aiBuildStats.sessions === peakBuildSessions}
                delay={260 + i * 80}
              />
            ))}
          </div>

          <p className="hor-micro mt-5 max-w-[64ch] border-t border-[var(--hor-line-soft)] pt-3.5">
            Bars are scaled to the busiest platform ({num(peakBuildSessions)}{" "}
            sessions). Hours are wall clock at the desk with an agent in the
            loop — the specification, the review and the correction, not just
            the generation.
          </p>
        </div>

        <div className="hor-substats">
          {SUBSTATS.map((s) => (
            <div key={s.label} className="hor-substat">
              <span className="hor-label">{s.label}</span>
              <div className="hor-readout-sm mt-2.5">{s.value}</div>
              <p className="hor-micro mt-1.5 truncate">{s.sub}</p>
            </div>
          ))}
        </div>
      </Panel>
    </section>
  );
}
