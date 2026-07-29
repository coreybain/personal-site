import type { Metadata } from "next";
import Link from "next/link";

import { snapshot } from "@/lib/snapshot";
import { GridRules } from "@/components/v/swiss/grid-rules";
import { SectionHead } from "@/components/v/swiss/section-head";
import { Heatmap, HeatmapLegend } from "@/components/v/swiss/heatmap";
import { ProjectCard } from "@/components/v/swiss/project-card";
import { LanguageBar } from "@/components/v/swiss/language-bar";
import { Ledger } from "@/components/v/swiss/ledger";
import { LifeCard } from "@/components/v/swiss/life-strip";
import { group, pct, stampUtc } from "@/components/v/swiss/format";

const { identity, gitStats, aiUsage, projects, funEntries } = snapshot;

export const metadata: Metadata = {
  title: `${identity.name} — ${identity.role}`,
  description: `${identity.role} in ${identity.location}. ${group(
    gitStats.totalContributionsYear,
  )} contributions in the last twelve months, ${projects.length} platforms shipped, built with agents at scale.`,
};

const WEEKS = gitStats.calendar.length;
const privateShare = pct(
  gitStats.privateContributions,
  gitStats.totalContributionsYear,
);
const dailyAverage = Math.round(
  gitStats.totalContributionsYear / (WEEKS * 7),
);
const agentTotal = aiUsage.agents.reduce((sum, a) => sum + a.sessions, 0);
const projectTotal = aiUsage.topProjects.reduce((sum, p) => sum + p.sessions, 0);
const sessionsPerWeek = Math.round(aiUsage.totalSessions / WEEKS);
const hoursPerWeek = Math.round(aiUsage.totalHours / WEEKS);
const avgSessionMinutes = Math.round(
  (aiUsage.totalHours * 60) / aiUsage.totalSessions,
);
const [firstName, ...restName] = identity.name.split(" ");

export default function SwissVariant() {
  return (
    <main className="sw-shell">
      <GridRules />

      <div className="sw-layer">
        {/* ---------------------------------------------- masthead */}
        <div className="flex items-center justify-between gap-4 border-b border-[var(--sw-hair)] py-3.5">
          <span className="sw-mono">coreybaines.com</span>
          <span className="sw-mono sw-mute hidden md:block">
            Engineering snapshot — auto-computed
          </span>
          <span className="sw-mono sw-mute">
            {stampUtc(snapshot.computedAt)}
          </span>
        </div>

        {/* ---------------------------------------------- 00 · hero */}
        <header className="pt-[clamp(36px,6vw,88px)] pb-[clamp(40px,6vw,80px)]">
          <div className="grid grid-cols-4 md:grid-cols-12">
            <div className="sw-cell col-span-4 md:col-span-9">
              <h1 className="sw-name sw-in">
                {firstName}
                <br />
                {restName.join(" ")}
              </h1>
              <p
                className="sw-role sw-in mt-[clamp(14px,1.6vw,26px)]"
                style={{ "--d": "90ms" } as React.CSSProperties}
              >
                {identity.role}
              </p>
            </div>

            <dl
              className="sw-cell sw-in col-span-4 mt-10 md:col-span-3 md:mt-2"
              style={{ "--d": "180ms" } as React.CSSProperties}
            >
              {[
                { k: "Location", v: identity.location },
                { k: "Current", v: identity.company },
                {
                  k: "Signal",
                  v: `${group(gitStats.totalContributionsYear)} contributions / 12 mo`,
                },
                { k: "GitHub", v: `@${identity.github}` },
              ].map((row) => (
                <div
                  key={row.k}
                  className="border-t border-[var(--sw-hair)] py-3 first:border-[var(--sw-ink)]"
                >
                  <dt className="sw-mono sw-mute">{row.k}</dt>
                  <dd className="sw-body mt-1.5 font-medium">{row.v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </header>

        {/* availability band — the loud accent, used once and without apology */}
        <div
          className="sw-in flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5 bg-[var(--sw-red)] px-3 py-4 text-[var(--sw-ink)] md:px-5"
          style={{ "--d": "260ms" } as React.CSSProperties}
        >
          <span className="sw-mono">{identity.availability}</span>
          <a
            className="sw-mono underline decoration-1 underline-offset-[3px]"
            href={`mailto:${identity.email}`}
          >
            {identity.email}
          </a>
        </div>

        <div className="h-[clamp(56px,8vw,116px)]" />

        {/* ---------------------------------------------- 01 · git */}
        <section className="sw-sec">
          <SectionHead
            index="01"
            label="Git signal"
            note={`GitHub · trailing ${WEEKS} weeks`}
          />

          <div className="grid grid-cols-4 md:grid-cols-12">
            <div className="sw-cell col-span-4 md:col-span-7">
              <span className="sw-huge">
                {group(gitStats.totalContributionsYear)}
              </span>
              <p className="sw-mono mt-5 border-t border-[var(--sw-ink)] pt-3">
                Contributions — last twelve months
              </p>
              <p className="sw-body sw-mute mt-4 max-w-[44ch]">
                Most of it is private, client-facing work. The public tail is
                only the part that can be shown.
              </p>
            </div>

            <dl className="sw-cell col-span-4 mt-10 md:col-span-5 md:mt-0">
              {[
                {
                  k: "Private work",
                  v: group(gitStats.privateContributions),
                  s: `${privateShare}% of total`,
                },
                {
                  k: "Public commits",
                  v: group(gitStats.publicCommits),
                  s: `${gitStats.publicRepoCount} public repositories`,
                },
                {
                  k: "Current streak",
                  v: group(gitStats.currentStreakDays),
                  s: "consecutive days",
                },
                {
                  k: "Daily average",
                  v: group(dailyAverage),
                  s: "contributions per day",
                },
              ].map((row) => (
                <div
                  key={row.k}
                  className="flex items-baseline justify-between gap-4 border-t border-[var(--sw-hair)] py-3.5 first:border-[var(--sw-ink)]"
                >
                  <dt className="sw-mono max-w-[13ch]">{row.k}</dt>
                  <dd className="text-right">
                    <span className="sw-stat-num block">{row.v}</span>
                    <span className="sw-mono sw-mute mt-2 block">{row.s}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {/* the calendar, as a graphic element in the grid */}
          <div className="mt-[clamp(44px,6vw,88px)]">
            <div className="mb-3.5 flex items-end justify-between gap-4 border-b border-[var(--sw-ink)] pb-3">
              <span className="sw-mono">Contribution calendar</span>
              <HeatmapLegend />
            </div>
            <Heatmap
              weeks={gitStats.calendar}
              total={gitStats.totalContributionsYear}
            />
          </div>

          <div className="mt-[clamp(40px,5vw,76px)] grid grid-cols-4 md:grid-cols-12">
            <div className="sw-cell col-span-4 md:col-span-8">
              <p className="sw-mono mb-3.5 border-b border-[var(--sw-ink)] pb-3">
                Language mix — tracked code
              </p>
              <LanguageBar languages={gitStats.languages} />
            </div>
          </div>
        </section>

        {/* ---------------------------------------------- 02 · work */}
        <section className="sw-sec">
          <SectionHead
            index="02"
            label="Selected work"
            note={`${projects.length} platforms · ${identity.company}`}
          />

          <div className="grid grid-cols-4 gap-y-[clamp(44px,6vw,80px)] md:grid-cols-12">
            {projects.map((project, i) => (
              <div
                key={project.slug}
                className="sw-cell col-span-4 md:col-span-6"
              >
                <ProjectCard project={project} index={i} />
              </div>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------- 03 · agents */}
        <section className="sw-sec">
          <SectionHead
            index="03"
            label="Built with agents"
            note="Measured, not claimed"
          />

          <div className="grid grid-cols-4 gap-y-10 md:grid-cols-12 md:gap-y-0">
            {[
              { v: group(aiUsage.totalSessions), u: "", k: "Agent sessions" },
              { v: group(aiUsage.totalHours), u: "hrs", k: "Hours paired" },
              {
                v: String(avgSessionMinutes),
                u: "min",
                k: "Average session",
              },
            ].map((stat) => (
              <div key={stat.k} className="sw-cell col-span-4 md:col-span-4">
                <span className="flex items-baseline gap-2">
                  <span className="sw-huge-sm">{stat.v}</span>
                  {stat.u ? (
                    <span className="sw-mono sw-mute">{stat.u}</span>
                  ) : null}
                </span>
                <p className="sw-mono mt-4 border-t border-[var(--sw-ink)] pt-3">
                  {stat.k}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-[clamp(32px,4vw,60px)] flex flex-wrap items-center gap-x-8 gap-y-2 bg-[var(--sw-ink)] px-3 py-4 text-white md:px-5">
            <span className="sw-mono">{sessionsPerWeek} sessions / week</span>
            <span className="sw-mono">{hoursPerWeek} hours / week</span>
            <span className="sw-mono opacity-60">
              Sustained across {WEEKS} weeks
            </span>
          </div>

          <div className="mt-[clamp(36px,5vw,72px)] grid grid-cols-4 gap-y-12 md:grid-cols-12 md:gap-y-0">
            <div className="sw-cell col-span-4 md:col-span-6">
              <p className="sw-mono sw-mute mb-3.5">By agent</p>
              <Ledger
                rows={aiUsage.agents.map((agent, i) => ({
                  label: agent.name,
                  value: agent.sessions,
                  share: agent.sessions / agentTotal,
                  unit: "sessions",
                  lead: i === 0,
                }))}
              />
            </div>

            <div className="sw-cell col-span-4 md:col-span-6">
              <p className="sw-mono sw-mute mb-3.5">Where they ran</p>
              <Ledger
                rows={aiUsage.topProjects.map((project) => ({
                  label: project.name,
                  value: project.sessions,
                  share: project.sessions / projectTotal,
                  unit: "sessions",
                }))}
              />
            </div>
          </div>
        </section>

        {/* ---------------------------------------------- 04 · life */}
        <section className="sw-sec">
          <SectionHead index="04" label="Off the clock" note="Recently" />

          <div className="grid grid-cols-4 gap-y-10 md:grid-cols-12 md:gap-y-0">
            {funEntries.map((entry) => (
              <div
                key={entry.title}
                className="sw-cell col-span-4 md:col-span-3"
              >
                <LifeCard entry={entry} />
              </div>
            ))}

            {/* Columns 10–12 stay empty on purpose — the grid is the picture. */}
            <p className="sw-cell sw-mono sw-note sw-mute col-span-4 mt-4 hidden md:col-span-3 md:mt-0 md:block md:self-end">
              Logged by the same collector that counts the commits. Beer and
              coffee are not KPIs.
            </p>
          </div>
        </section>

        {/* ---------------------------------------------- footer */}
        <footer className="sw-rule-heavy pt-[clamp(28px,4vw,52px)] pb-[clamp(44px,5vw,76px)]">
          <div className="grid grid-cols-4 md:grid-cols-12">
            <div className="sw-cell col-span-4 md:col-span-8">
              <p className="sw-mono sw-red">{identity.availability}</p>
              <a
                className="sw-mail sw-link mt-4 inline-block"
                href={`mailto:${identity.email}`}
              >
                {identity.email}
              </a>
              <p className="mt-6">
                <a
                  className="sw-mono sw-link"
                  href={`https://github.com/${identity.github}`}
                  rel="noreferrer"
                >
                  github.com/{identity.github}
                </a>
              </p>
            </div>

            <div className="sw-cell col-span-4 mt-10 md:col-span-4 md:mt-0 md:text-right">
              <p className="sw-mono">{identity.name}</p>
              <p className="sw-mono sw-mute mt-2.5">{identity.location}</p>
              <p className="sw-mono sw-mute mt-2.5">{identity.company}</p>
              <p className="sw-mono sw-mute mt-7">
                Snapshot {stampUtc(snapshot.computedAt)}
              </p>
              <p className="mt-2.5">
                <Link className="sw-mono sw-link" href="/">
                  ← All variants
                </Link>
              </p>
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}
