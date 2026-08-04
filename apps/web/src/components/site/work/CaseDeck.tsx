import type { CSSProperties } from "react";

import { DeckHead, Panel } from "@/components/site/Panel";
import { num, pct } from "@/components/site/format";
import type { WorkDerived } from "@/lib/derive";
import { pad2 } from "@/lib/derive";
import type { AiUsage, Project } from "@/lib/snapshot";

/**
 * Deck zone. Everything below the horizon is a readout: the outcomes list, the
 * agent-effort instrument panel and the stack manifest.
 *
 * The outcomes are the snapshot's own strings, one per row, numbered and
 * ticked — a list, never a paragraph, because each line is meant to be checked
 * against reality one at a time.
 *
 * Prop-fed, and the three build figures are threaded through rather than
 * re-derived here: `buildRank`, `peakBuildSessions` and `buildProjects` are all
 * measured across the *whole* project list, so this panel says "3 of 4" and
 * "against the busiest platform on record" about the same set of platforms the
 * /work ledger does.
 */

/** The instrument panel's slice of `deriveWork()` — every platform, not this one. */
type BuildContext = Pick<
  WorkDerived,
  "buildProjects" | "buildRank" | "peakBuildSessions"
>;

function Outcomes({ outcomes }: { outcomes: string[] }) {
  return (
    <Panel
      label="What changed"
      meta={`${pad2(outcomes.length)} delivered`}
      padded={false}
      delay={40}
    >
      <ul>
        {outcomes.map((outcome, i) => (
          <li key={outcome} className="work-out">
            <span className="hor-label work-out-idx">{pad2(i + 1)}</span>
            <span className="work-out-tick" aria-hidden="true" />
            <span className="hor-body" style={{ color: "var(--hor-ink)" }}>
              {outcome}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function BuildStats({
  project,
  aiUsage,
  buildProjects,
  buildRank,
  peakBuildSessions,
}: { project: Project; aiUsage: AiUsage } & BuildContext) {
  const stats = project.aiBuildStats;
  if (!stats) return null;

  const minutes =
    stats.sessions === 0 ? 0 : Math.round((stats.hours * 60) / stats.sessions);
  const rank = buildRank(project.slug);
  const share =
    peakBuildSessions === 0
      ? 0
      : Math.round((stats.sessions / peakBuildSessions) * 100);

  const ROWS = [
    { label: "Average session", value: `${minutes} min` },
    {
      label: "Share of all sessions",
      value: `${pct(stats.sessions, aiUsage.totalSessions)}%`,
    },
    {
      label: "Rank by effort",
      value: rank === 0 ? "—" : `${rank} of ${buildProjects.length}`,
    },
  ];

  return (
    <Panel label="Built with agents in the loop" meta="Measured" delay={100}>
      <div className="flex flex-wrap gap-x-10 gap-y-6">
        <div>
          <div className="hor-readout">{num(stats.sessions)}</div>
          <div className="hor-label mt-2.5">Agent sessions</div>
        </div>
        <div>
          <div className="hor-readout">{num(stats.hours)}</div>
          <div className="hor-label mt-2.5">Hours at the desk</div>
        </div>
      </div>

      <div className="hor-track mt-6">
        <span
          className="hor-fill"
          data-hot={rank === 1 ? "1" : "0"}
          style={
            { width: `${share}%`, "--hor-delay": "420ms" } as CSSProperties
          }
        />
      </div>
      <p className="hor-micro mt-2.5">
        Against the busiest platform on record ({num(peakBuildSessions)}{" "}
        sessions)
      </p>

      <div className="mt-5 border-t border-[var(--hor-line-soft)] pt-1">
        {ROWS.map((row) => (
          <div key={row.label} className="hor-row">
            <span className="hor-label">{row.label}</span>
            <span
              className="hor-mono hor-micro"
              style={{ color: "var(--hor-ink)" }}
            >
              {row.value}
            </span>
          </div>
        ))}
      </div>

      <p className="hor-micro mt-4 border-t border-[var(--hor-line-soft)] pt-3.5">
        Hours are wall clock with an agent in the loop — specifying, reviewing
        and correcting, not just generating.
      </p>
    </Panel>
  );
}

function Stack({ project }: { project: Project }) {
  return (
    <Panel
      label="Stack"
      meta={`${pad2(project.stack.length)} components`}
      delay={150}
    >
      <ul className="flex flex-wrap gap-1.5">
        {project.stack.map((tech) => (
          <li key={tech} className="hor-chip">
            {tech}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function CaseDeck({
  project,
  aiUsage,
  buildProjects,
  buildRank,
  peakBuildSessions,
}: { project: Project; aiUsage: AiUsage } & BuildContext) {
  const outcomes = project.outcomes ?? [];
  const hasOutcomes = outcomes.length > 0;

  return (
    <section>
      <DeckHead
        index="03"
        title="Outcomes"
        meta={
          project.aiBuildStats
            ? `${num(project.aiBuildStats.sessions)} sessions · ${num(
                project.aiBuildStats.hours,
              )} hours`
            : "Measured after delivery"
        }
      />

      {/* The outcomes list and the stack manifest are both descriptions of the
          thing; the instrument panel is the evidence. Hence the split, and the
          7/5 weighting that keeps the two columns close to the same depth. */}
      <div className="grid gap-3 lg:grid-cols-12">
        <div
          className={`flex flex-col gap-3 ${
            project.aiBuildStats ? "lg:col-span-7" : "lg:col-span-12"
          }`}
        >
          {hasOutcomes ? <Outcomes outcomes={outcomes} /> : null}
          <Stack project={project} />
        </div>

        {project.aiBuildStats ? (
          <div className="lg:col-span-5">
            <BuildStats
              project={project}
              aiUsage={aiUsage}
              buildProjects={buildProjects}
              buildRank={buildRank}
              peakBuildSessions={peakBuildSessions}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}
