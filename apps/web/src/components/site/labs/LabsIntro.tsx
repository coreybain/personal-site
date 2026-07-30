import type { CSSProperties } from "react";

import { num } from "@/components/site/format";
import type { LabsDerived } from "@/lib/derive";
import { activePhrase } from "@/lib/derive";
import type { Identity } from "@/lib/snapshot";

/**
 * Sky zone. One calm paragraph whose only job is to say *these are not client
 * platforms* before the page drops below the horizon into the telemetry.
 *
 * The three numerals along the bottom edge are set in the sans face — the same
 * "last calm thing before the horizon" the homepage hero uses. Below the rule
 * the same class of number switches to IBM Plex Mono.
 *
 * Prop-fed. `labCount` and `SKYLINE` were module constants folded from the mock
 * at import time; both are now per render, because a module-scope constant is
 * computed once per *process* and can never see a Convex row.
 */

const COUNT_WORDS = [
  "No",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
] as const;

type LabsIntroProps = { identity: Identity } & Pick<
  LabsDerived,
  "freshest" | "labs" | "totalCommits"
>;

function delay(ms: number): CSSProperties {
  return { "--hor-delay": `${ms}ms` } as CSSProperties;
}

export function LabsIntro({
  identity,
  freshest,
  labs,
  totalCommits,
}: LabsIntroProps) {
  const labCount = COUNT_WORDS[labs.length] ?? String(labs.length);

  const skyline = [
    { value: num(totalCommits), label: "Commits, 12 mo" },
    { value: String(labs.length), label: "Personal repositories" },
    {
      value:
        freshest.liveStats.lastPushDaysAgo <= 0
          ? "Today"
          : `${freshest.liveStats.lastPushDaysAgo}d`,
      label: "Newest push",
    },
  ];

  return (
    <header className="pt-24 pb-14 sm:pt-28 sm:pb-16 lg:pt-32 lg:pb-20">
      <div className="hor-rise" style={delay(40)}>
        <span className="hor-pill">
          <span className="hor-live" aria-hidden="true" />
          {freshest.title} — {activePhrase(freshest.liveStats.lastPushDaysAgo)}
        </span>
      </div>

      <h1 className="hor-display hor-rise mt-8 sm:mt-10" style={delay(110)}>
        Labs
      </h1>

      <div className="hor-rise mt-6 sm:mt-7" style={delay(180)}>
        <p className="hor-h2 text-balance">
          {labCount} repositories with nobody&rsquo;s name on the invoice.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="hor-body" style={{ color: "var(--hor-ink)" }}>
            Personal work
          </span>
          <span className="hor-vrule" aria-hidden="true" />
          <span className="hor-body">Built in public</span>
          <span className="hor-vrule" aria-hidden="true" />
          <span className="hor-body">{identity.github} on GitHub</span>
        </div>
      </div>

      <p className="hor-lede hor-rise mt-7 max-w-[52ch] text-pretty" style={delay(240)}>
        These are experiments, not engagements — the things I build when nobody
        is paying me to. Some stay deliberately small; others grow into products
        worth showing properly. The captures tell those stories, while the
        repository telemetry keeps every project honest about its cadence and
        how recently it moved.
      </p>

      <div className="hor-rise mt-12 sm:mt-14" style={delay(320)}>
        <div className="hor-rule" />
        <dl className="grid grid-cols-1 gap-y-7 pt-7 sm:grid-cols-3 sm:gap-x-8">
          {skyline.map((item) => (
            /* dt before dd keeps the <dl> grouping valid; column-reverse puts
               the numeral back on top visually. */
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
