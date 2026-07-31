import { snapshot } from "@/lib/snapshot";

import { delay } from "./SectionHead";
import { num } from "./format";

const { identity, gitStats, aiUsage, projects } = snapshot;

/** The five-second read: four numbers, no interpretation required. */
const RAIL: { value: string; unit?: string; label: string; note: string }[] = [
  {
    value: num(gitStats.totalContributionsYear),
    label: "Contributions",
    note: "Last 12 months",
  },
  {
    value: num(aiUsage.totalSessions),
    label: "Agent sessions",
    note: `${num(aiUsage.totalHours)} hours paired`,
  },
  {
    value: String(projects.length),
    label: "Platforms shipped",
    note: identity.company,
  },
  {
    value: String(gitStats.currentStreakDays),
    unit: "days",
    label: "Current streak",
    note: "Unbroken",
  },
];

export function Hero() {
  return (
    <section className="pri-shell pri-hero">
      <div className="pri-rise" style={delay(60)}>
        <span className="pri-pill">
          <span className="pri-dot" aria-hidden="true" />
          {identity.availability}
        </span>
      </div>

      <h1
        className="pri-display pri-grad-text pri-rise mt-7 text-balance"
        style={delay(120)}
      >
        {identity.name}
      </h1>

      <div
        className="pri-meta pri-rise mt-6"
        style={delay(190)}
      >
        <span className="font-semibold pri-ink">{identity.role}</span>
        <span className="pri-meta-sep" aria-hidden="true" />
        <span>{identity.company}</span>
        <span className="pri-meta-sep" aria-hidden="true" />
        <span>{identity.location}</span>
      </div>

      <p className="pri-lede pri-rise mt-6 max-w-[52ch] text-pretty" style={delay(250)}>
        I build the platforms teams depend on — document automation,
        compliance, real-time infrastructure — and I ship them with agents in the
        loop, every single day.
      </p>

      <div className="pri-rise mt-9 flex flex-wrap items-center gap-3" style={delay(310)}>
        <a className="pri-btn" href={`mailto:${identity.email}`}>
          Get in touch
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
            <path
              d="M2.6 6.5h7.8M7.2 3.3l3.2 3.2-3.2 3.2"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </a>
        <a
          className="pri-btn-ghost"
          href={`https://github.com/${identity.github}`}
          rel="noreferrer"
        >
          github.com/{identity.github}
        </a>
      </div>

      <div className="pri-card pri-rise mt-12 sm:mt-14" style={delay(380)}>
        <div className="pri-rail">
          {RAIL.map((cell) => (
            <div key={cell.label} className="pri-rail-cell">
              <div className="pri-stat-sm flex items-baseline gap-1.5">
                {cell.value}
                {cell.unit ? (
                  <span className="pri-micro font-normal">{cell.unit}</span>
                ) : null}
              </div>
              <div>
                <div className="text-[0.8125rem] font-semibold tracking-[-0.014em]">
                  {cell.label}
                </div>
                <div className="pri-micro mt-1">{cell.note}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
