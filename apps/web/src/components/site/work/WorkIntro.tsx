import type { CSSProperties } from "react";

import { num } from "@/components/site/format";
import { snapshot } from "@/lib/snapshot";

import { buildHours, countWord, stackUnion } from "./data";

const { identity, gitStats, projects } = snapshot;

/**
 * Sky zone. The page opens the way the homepage does — one wash, quiet display
 * type, sans numerals — but says something the homepage does not: the *shape*
 * of the work, and what it cost to build.
 *
 * The three numerals along the bottom are the last calm figures before the
 * horizon; below the rule the same class of number switches to mono.
 */
const SKYLINE = [
  {
    value: String(projects.length),
    label: "Platforms in production",
  },
  {
    value: num(gitStats.totalContributionsYear),
    label: "Contributions, 12 months",
  },
  {
    value: String(stackUnion.length),
    label: `Technologies across the ${countWord(projects.length).toLowerCase()}`,
  },
];

function delay(ms: number): CSSProperties {
  return { "--hor-delay": `${ms}ms` } as CSSProperties;
}

export function WorkIntro() {
  return (
    <header className="pt-24 pb-14 sm:pt-28 sm:pb-16 lg:pt-32 lg:pb-20">
      <div className="hor-rise" style={delay(40)}>
        <span className="hor-eyebrow">
          <span className="hor-mono">01</span>
          <span className="hor-tick" aria-hidden="true" />
          Selected work
        </span>
      </div>

      <h1
        className="hor-display hor-rise mt-7 max-w-[17ch] text-balance sm:mt-9"
        style={delay(110)}
      >
        Documents, risk, and real time.
      </h1>

      <p
        className="hor-lede hor-rise mt-7 max-w-[62ch] text-pretty"
        style={delay(180)}
      >
        {countWord(projects.length)} production platforms at {identity.company},
        each one owned end to end as {identity.role.toLowerCase()} — the
        architecture, the delivery and the team around both. They are where the{" "}
        {num(gitStats.totalContributionsYear)} contributions behind this site
        were spent, and {num(buildHours)} hours of that work had an agent in the
        loop.
      </p>

      <div className="hor-rise mt-12 sm:mt-14 lg:mt-16" style={delay(250)}>
        <div className="hor-rule" />
        <dl className="grid grid-cols-1 gap-y-7 pt-7 sm:grid-cols-3 sm:gap-x-8">
          {SKYLINE.map((item) => (
            /* dt before dd keeps the <dl> grouping valid; column-reverse puts
               the numeral back on top. */
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
