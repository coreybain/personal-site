import type { CSSProperties } from "react";

import type { LabsDerived } from "@/lib/derive";
import type { GitStats, Identity } from "@/lib/snapshot";

/**
 * The page surfaces one last time. Sky material — rounded glass, sans face — so
 * the closing note reads as an aside rather than another instrument.
 *
 * Prop-fed: active and total repository counts come from the same hourly GitHub
 * snapshot, while `labs.length` is the smaller editorial set written up here.
 */
export function LabsCoda({
  identity,
  gitStats,
  labs,
}: { identity: Identity; gitStats: GitStats } & Pick<LabsDerived, "labs">) {
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
            {gitStats.publicRepoCount} of {gitStats.totalPublicRepoCount} public
            repositories were active in the last 12 months. {labs.length} are
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
