import type { CSSProperties } from "react";

import { snapshot } from "@/lib/snapshot";

import { num } from "./format";

const { identity, gitStats, aiUsage, projects } = snapshot;

/**
 * Sky zone. Generous whitespace, one soft wash behind, quiet display type.
 *
 * The three numbers along the bottom edge are set in the *sans* face — they are
 * the last calm thing before the horizon. Below the rule the same class of
 * number switches to IBM Plex Mono, and that face change is the zone change.
 */
const SKYLINE = [
  { value: num(gitStats.totalContributionsYear), label: "Contributions, 12 mo" },
  { value: num(aiUsage.totalSessions), label: "Agent sessions" },
  { value: String(projects.length), label: "Platforms in production" },
];

function delay(ms: number): CSSProperties {
  return { "--hor-delay": `${ms}ms` } as CSSProperties;
}

export function Hero() {
  return (
    <header className="pt-14 pb-16 sm:pt-20 sm:pb-20 lg:pt-28 lg:pb-24">
      <div className="hor-rise" style={delay(40)}>
        <span className="hor-pill">
          <span className="hor-live" aria-hidden="true" />
          {identity.availability}
        </span>
      </div>

      <h1 className="hor-display hor-rise mt-8 text-balance sm:mt-10" style={delay(110)}>
        {identity.name}
      </h1>

      <div className="hor-rise mt-6 sm:mt-7" style={delay(180)}>
        <p className="hor-h2">{identity.role}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="hor-body" style={{ color: "var(--hor-ink)" }}>
            {identity.company}
          </span>
          <span className="hor-vrule" aria-hidden="true" />
          <span className="hor-body">{identity.location}</span>
          <span className="hor-vrule" aria-hidden="true" />
          <span className="hor-body">
            {gitStats.currentStreakDays}-day streak, unbroken
          </span>
        </div>
      </div>

      <p className="hor-lede hor-rise mt-7 max-w-[48ch] text-pretty" style={delay(240)}>
        I build the platforms other teams depend on — document automation,
        compliance, real-time auctions — and I ship them with agents in the loop,
        every day. Everything below this line is measured, not claimed.
      </p>

      <div className="hor-rise mt-9 flex flex-wrap items-center gap-3" style={delay(300)}>
        <a className="hor-btn" href={`mailto:${identity.email}`}>
          Get in touch
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
            <path
              d="M2.6 6.5h7.8M7.2 3.3l3.2 3.2-3.2 3.2"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </a>
        <a
          className="hor-btn hor-btn-ghost"
          href={`https://github.com/${identity.github}`}
          rel="noreferrer noopener"
        >
          github.com/{identity.github}
        </a>
      </div>

      <div className="hor-rise mt-14 sm:mt-16 lg:mt-20" style={delay(380)}>
        <div className="hor-rule" />
        <dl className="grid grid-cols-1 gap-y-7 pt-7 sm:grid-cols-3 sm:gap-x-8">
          {SKYLINE.map((item) => (
            /* dt must precede dd for valid <dl> grouping; column-reverse keeps
               the numeral visually on top. */
            <div key={item.label} className="flex flex-col-reverse">
              <dt className="hor-eyebrow mt-2.5">{item.label}</dt>
              <dd className="hor-stat-sky">{item.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </header>
  );
}
