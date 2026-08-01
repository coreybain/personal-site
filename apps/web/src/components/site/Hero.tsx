import type { CSSProperties } from "react";

import type { AiUsage, GitStats, Identity, Project } from "@/lib/snapshot";

import { ContactSheetTrigger } from "./contact/ContactSheet";
import { PersonalCard } from "./PersonalCard";
import { num } from "./format";

function delay(ms: number): CSSProperties {
  return { "--hor-delay": `${ms}ms` } as CSSProperties;
}

/**
 * Sky zone. Generous whitespace, one soft wash behind, quiet display type.
 *
 * The three numbers along the bottom edge are set in the *sans* face — they are
 * the last calm thing before the horizon. Below the rule the same class of
 * number switches to IBM Plex Mono, and that face change is the zone change.
 *
 * `SKYLINE` used to be a module constant folded from the mock at import time.
 * It is built per render now for the reason `@/lib/derive` exists: a
 * module-scope reduction is computed once per process and can never see a
 * Convex row. Three `Intl` formats is not a cost worth caching.
 *
 * `projects` is taken whole rather than as a count so the hero's third readout
 * and the tile grid below the horizon can never disagree about how many
 * platforms there are.
 */
export function Hero({
  identity,
  gitStats,
  aiUsage,
  projects,
}: {
  identity: Identity;
  gitStats: GitStats;
  aiUsage: AiUsage;
  projects: Project[];
}) {
  const SKYLINE = [
    {
      value: num(gitStats.totalContributionsYear),
      label: "Contributions, 12 mo",
    },
    { value: num(aiUsage.totalSessions), label: "Agent sessions" },
    { value: String(projects.length), label: "Platforms in production" },
  ];

  return (
    <header className="pt-24 pb-16 sm:pt-28 sm:pb-20 lg:pt-36 lg:pb-24">
      <div className="flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-center lg:gap-x-14 xl:gap-x-20">
        <div className="order-last lg:order-none">
          {identity.availabilityVisible ? (
            <div className="hor-rise" style={delay(40)}>
              <span className="hor-pill">
                <span className="hor-live" aria-hidden="true" />
                {identity.availability}
              </span>
            </div>
          ) : null}

          <h1
            className={`hor-display hor-rise text-balance ${
              identity.availabilityVisible ? "mt-8 sm:mt-10" : "mt-0"
            }`}
            style={delay(110)}
          >
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

          <p
            className="hor-lede hor-rise mt-7 max-w-[48ch] text-pretty"
            style={delay(240)}
          >
            I build the platforms teams depend on — document automation,
            compliance, real-time infrastructure — and I ship them with agents
            in the loop, every day. Everything below this line is measured, not
            claimed.
          </p>

          <div
            className="hor-rise mt-9 flex flex-wrap items-center gap-3"
            style={delay(300)}
          >
            <ContactSheetTrigger className="hor-btn">
              Get in touch
              <svg
                width="13"
                height="13"
                viewBox="0 0 13 13"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M2.6 6.5h7.8M7.2 3.3l3.2 3.2-3.2 3.2"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </ContactSheetTrigger>
            <a
              className="hor-btn hor-btn-ghost"
              href={`https://github.com/${identity.github}`}
              rel="noreferrer noopener"
            >
              github.com/{identity.github}
            </a>
          </div>
        </div>

        <div
          className="hor-rise order-first mb-14 w-full lg:order-none lg:mb-0 lg:justify-self-end"
          style={delay(70)}
        >
          <PersonalCard identity={identity} />
        </div>
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
