import type { CSSProperties } from "react";

import { snapshot } from "@/lib/snapshot";

import { labs } from "./data";

const { identity, gitStats } = snapshot;

/**
 * The page surfaces one last time. Sky material — rounded glass, sans face — so
 * the closing note reads as an aside rather than another instrument.
 */
export function LabsCoda() {
  return (
    <section className="pt-16 pb-16 sm:pt-20 sm:pb-20">
      <div
        className="hor-card hor-rise flex flex-wrap items-end justify-between gap-x-10 gap-y-7 p-6 sm:p-8"
        style={{ "--hor-delay": "560ms" } as CSSProperties}
      >
        <div>
          <span className="hor-eyebrow">Everything else</span>
          <p className="hor-h3 mt-3.5 text-balance">
            The rest of the shelf is public too.
          </p>
          <p className="hor-body mt-3 max-w-[54ch] text-pretty">
            {labs.length} of {gitStats.publicRepoCount} public repositories are
            written up here — the ones with something to say. The remainder are
            forks, spikes and half-finished ideas, and they are all on GitHub in
            the same state I left them.
          </p>
        </div>

        <a
          className="hor-btn hor-btn-ghost"
          href={`https://github.com/${identity.github}`}
          rel="noreferrer noopener"
        >
          github.com/{identity.github}
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
      </div>
    </section>
  );
}
