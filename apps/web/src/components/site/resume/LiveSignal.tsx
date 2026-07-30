import { DeckHead, Panel } from "@/components/site/Panel";
import { longDate, num, stamp, stampTime } from "@/components/site/format";
import type { ResumeDerived } from "@/lib/derive";
import type { AiUsage, GitStats } from "@/lib/snapshot";

import { Cadence } from "./Cadence";

/**
 * The live strip — deck zone, and the reason this résumé is a web page.
 *
 * A PDF quotes numbers from whenever it was exported. This section reads the
 * same snapshot document the homepage reads, stamps it, and says where each
 * figure came from. `embedGitStats` is the switch that puts it here rather than
 * in prose; the page checks it before rendering this section.
 *
 * ── Props, not module state ────────────────────────────────────────────────
 *
 * Everything here came out of `./data` — the mock, reduced once per process.
 * `derived` is the page's single `deriveResume(site)` result, passed whole
 * because this one component reads a dozen of its fields; the raw snapshot
 * blocks it prints alongside them arrive beside it.
 */
export function LiveSignal({
  gitStats,
  aiUsage,
  embedGitStats,
  computedAt,
  derived,
}: {
  gitStats: GitStats;
  aiUsage: AiUsage;
  /** `resumeDocument.embedGitStats`, echoed in the provenance table. */
  embedGitStats: boolean;
  computedAt: string;
  derived: ResumeDerived;
}) {
  const {
    activeDays,
    avgSessionMinutes,
    coveragePct,
    days,
    firstDay,
    lastDay,
    peakWeekStart,
    peakWeekTotal,
    perWeek,
    privatePct,
    sessionsPerWeek,
    weekCount,
    weeklyTotals,
  } = derived;

  const snapshotDate = computedAt.slice(0, 10);

  const stats = [
    {
      label: "Contributions · 12 mo",
      value: num(gitStats.totalContributionsYear),
      unit: null,
      sub: `≈ ${num(perWeek)} a week · ${privatePct}% private`,
    },
    {
      label: "Agent sessions",
      value: num(aiUsage.totalSessions),
      unit: null,
      sub: `${num(aiUsage.totalHours)} h at the desk · ${avgSessionMinutes} min average`,
    },
    {
      label: "Current streak",
      value: String(gitStats.currentStreakDays),
      unit: "days",
      sub: `unbroken through ${stamp(snapshotDate)}`,
    },
    {
      label: "Active days",
      value: num(activeDays),
      unit: `of ${num(days.length)}`,
      sub: `${coveragePct}% coverage · ${num(sessionsPerWeek)} sessions a week`,
    },
  ];

  const provenance = [
    { label: "Git activity", value: `${gitStats.publicRepoCount} public repos` },
    {
      label: "Agents",
      value: aiUsage.agents.map((agent) => agent.name).join(" · "),
    },
    { label: "Weeks tracked", value: String(weekCount) },
    {
      label: "Embedded",
      value: embedGitStats ? "live" : "static",
    },
  ];

  return (
    <section id="signal" className="res-section scroll-mt-20">
      <DeckHead
        index="02"
        title="Live signal"
        meta={`${stamp(firstDay)} — ${stamp(lastDay)} · ${weekCount} weeks`}
      />

      <div className="grid gap-3 lg:grid-cols-12">
        <Panel
          label="Weekly cadence"
          meta={
            <>
              <span className="hor-hot">{num(peakWeekTotal)}</span> peak week ·{" "}
              {num(gitStats.totalContributionsYear)} total
            </>
          }
          padded={false}
          className="lg:col-span-8"
          delay={40}
        >
          <div className="hor-panel-body">
            <div className="res-cadence-scroll">
              <div className="res-cadence-floor">
                <Cadence
                  calendar={gitStats.calendar}
                  weeklyTotals={weeklyTotals}
                  peakWeekTotal={peakWeekTotal}
                />
              </div>
            </div>

            <div className="mt-3.5 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
              <span className="hor-label">
                One bar per week · final column is the week to date
              </span>
              <span className="hor-micro">
                Busiest week began {longDate(peakWeekStart)}
              </span>
            </div>
          </div>

          <div className="hor-substats">
            {stats.map((item) => (
              <div key={item.label} className="hor-substat res-stat">
                <span className="hor-label">{item.label}</span>
                <div className="hor-readout-sm mt-2.5">
                  {item.value}
                  {item.unit ? (
                    <span className="res-stat-unit"> {item.unit}</span>
                  ) : null}
                </div>
                <p className="hor-micro mt-1.5">{item.sub}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          label="Provenance"
          meta="One snapshot document"
          className="lg:col-span-4"
          delay={100}
        >
          <div className="res-stamp">
            <span className="hor-live" aria-hidden="true" />
            <span className="hor-label">Snapshot</span>
          </div>

          <div className="hor-readout mt-3">{stamp(snapshotDate)}</div>
          <p className="hor-micro mt-2">{stampTime(computedAt)}</p>

          <div className="mt-5 border-t border-[var(--hor-line-soft)] pt-1">
            {provenance.map((row) => (
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

          <p className="hor-micro res-note">
            Every figure above is read from the same document the homepage
            reads, at build time. Nothing on this résumé is a number typed in by
            hand — which is the point of publishing it as a page rather than a
            file.
          </p>
        </Panel>
      </div>
    </section>
  );
}
