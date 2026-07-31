import { snapshot } from "@/lib/snapshot";

import { StatRail, type RailCell } from "./StatRail";
import { delay, num } from "./format";

const { identity, gitStats, aiUsage, projects } = snapshot;

/** The five-second read: the four numbers that make the case, in one rail. */
const RAIL: RailCell[] = [
  {
    value: num(gitStats.totalContributionsYear),
    label: "Contributions",
    sub: "Last 12 months",
  },
  {
    value: num(aiUsage.totalSessions),
    label: "Agent sessions",
    sub: `${num(aiUsage.totalHours)} hours paired`,
  },
  {
    value: String(projects.length),
    label: "Platforms shipped",
    sub: identity.company,
  },
  {
    value: String(gitStats.currentStreakDays),
    unit: "days",
    label: "Current streak",
    sub: "Unbroken",
  },
];

export function Hero() {
  return (
    <header className="pt-8 pb-14 sm:pt-12 sm:pb-20 lg:pt-16 lg:pb-24">
      <div className="noc-rise" style={delay(60)}>
        <span className="noc-pill">
          <span className="noc-dot" />
          {identity.availability}
        </span>
      </div>

      <h1
        className="noc-display noc-rise mt-7 max-w-[14ch] text-balance"
        style={delay(130)}
      >
        {identity.name}
      </h1>

      <div
        className="noc-rise mt-6 flex flex-wrap items-center gap-x-3 gap-y-2"
        style={delay(200)}
      >
        <span className="text-[15px] font-medium tracking-[-0.015em]">
          {identity.role}
        </span>
        <span
          className="h-3 w-px bg-[var(--noc-hair)]"
          aria-hidden="true"
        />
        <span className="noc-label text-[15px]">{identity.company}</span>
        <span
          className="h-3 w-px bg-[var(--noc-hair)]"
          aria-hidden="true"
        />
        <span className="noc-label text-[15px]">{identity.location}</span>
      </div>

      <p
        className="noc-lede noc-rise mt-6 max-w-[52ch] text-pretty"
        style={delay(260)}
      >
        I build the platforms teams depend on — document automation,
        compliance, real-time infrastructure — and I ship them with agents in
        the loop, every day.
      </p>

      <div
        className="noc-rise mt-9 flex flex-wrap items-center gap-3"
        style={delay(320)}
      >
        <a className="noc-btn" href={`mailto:${identity.email}`}>
          Get in touch
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
            <path
              d="M2.6 6.5h7.8M7.2 3.3l3.2 3.2-3.2 3.2"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </a>
        <a
          className="noc-btn noc-btn-ghost"
          href={`https://github.com/${identity.github}`}
          rel="noreferrer"
        >
          github.com/{identity.github}
        </a>
      </div>

      <div className="noc-rise mt-12 sm:mt-14" style={delay(380)}>
        <StatRail cells={RAIL} className="noc-card" />
      </div>
    </header>
  );
}
