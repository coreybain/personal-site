import type { CSSProperties } from "react";

import { Panel } from "@/components/site/Panel";
import { num, pct } from "@/components/site/format";
import type { Lab } from "@/lib/snapshot";

import { activePhrase, band, cadence, maxCommits, repoUrl } from "./data";

/**
 * One lab, as an instrument panel.
 *
 * The hierarchy is deliberate: the two readouts that get the mono face are
 * *recency* and *cadence* — the two numbers that actually say whether a
 * personal repo is alive. Commits sit under a comparative track (scaled against
 * the busiest lab, not against some imagined absolute), and stars and forks are
 * demoted to one micro line at the foot, where they belong at this scale.
 */

function ArrowOut() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path
        d="M3 7L7 3M7 3H3.6M7 3v3.4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LabCard({ lab, index }: { lab: Lab; index: number }) {
  const { stars, forks, commitsYear, lastPushDaysAgo } = lab.liveStats;
  const share = pct(commitsYear, maxCommits);
  const isBusiest = commitsYear === maxCommits;

  return (
    <Panel
      label={lab.language}
      meta={lab.featured ? <span className="hor-accented">Featured</span> : undefined}
      padded={false}
      className="labs-card"
      delay={80 + index * 60}
    >
      {lab.featured ? <span className="labs-edge" aria-hidden="true" /> : null}

      <div className="hor-panel-body">
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="hor-h3">{lab.title}</h3>
          <span className="hor-label">{String(index + 1).padStart(2, "0")}</span>
        </div>
        <p className="hor-body mt-3 text-pretty">{lab.summary}</p>
      </div>

      <div className="labs-duo">
        <div className="labs-duo-cell">
          <span className="hor-label flex items-center gap-2">
            <i className={`labs-seed labs-band-${band(lastPushDaysAgo)}`} aria-hidden="true" />
            Last push
          </span>
          <div className="hor-readout-sm mt-2.5">{lastPushDaysAgo}d</div>
          <p className="hor-micro mt-1.5 truncate">{activePhrase(lastPushDaysAgo)}</p>
        </div>

        <div className="labs-duo-cell">
          <span className="hor-label">Cadence</span>
          <div className="hor-readout-sm mt-2.5">{cadence(lab).toFixed(1)}</div>
          <p className="hor-micro mt-1.5 truncate">commits a week</p>
        </div>
      </div>

      <div className="labs-foot">
        <div className="flex items-baseline justify-between gap-3">
          <span className="hor-label">Commits, 12 mo</span>
          <span className="hor-mono hor-micro" style={{ color: "var(--hor-ink)" }}>
            {num(commitsYear)}
          </span>
        </div>

        <div className="hor-track mt-2.5">
          <span
            className="hor-fill"
            data-hot={isBusiest ? "1" : "0"}
            style={
              {
                width: `${share}%`,
                "--hor-delay": `${360 + index * 70}ms`,
              } as CSSProperties
            }
          />
        </div>

        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <span className="hor-micro">
            {num(stars)} star{stars === 1 ? "" : "s"} · {num(forks)} fork
            {forks === 1 ? "" : "s"}
          </span>
          <a
            className="hor-link labs-repo"
            href={repoUrl(lab)}
            rel="noreferrer noopener"
          >
            github.com/{lab.repoFullName}
            <ArrowOut />
          </a>
        </div>
      </div>
    </Panel>
  );
}
