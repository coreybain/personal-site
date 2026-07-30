import type { CSSProperties } from "react";

import { SkyHead } from "@/components/site/Panel";
import type { GitStats, ResumeDocument } from "@/lib/snapshot";

/**
 * Capabilities — a ledger, not a tag cloud. Two columns of hairline rows with
 * mono indices, which is the closest this page gets to the deck's instrument
 * grammar without leaving the sky.
 *
 * The pill quotes the top tracked language. `gitStats.languages` is passed
 * straight through by `getSiteData()` and may legitimately be empty on a
 * half-seeded deployment, so the pill is conditional rather than indexing
 * blindly into `[0]` the way the module-scope version did.
 */
export function Capabilities({
  languages,
  capabilities,
}: {
  languages: GitStats["languages"];
  capabilities: ResumeDocument["capabilities"];
}) {
  const topLanguage = languages[0];

  return (
    <section id="capabilities" className="res-section scroll-mt-20 pt-16 sm:pt-20">
      <SkyHead
        index="04"
        eyebrow="Capabilities"
        title="What I bring on the first day."
        lede="Listed in the order they tend to matter on a new platform — the architecture first, the leadership last, and everything in between load-bearing."
        aside={
          topLanguage ? (
            <span className="hor-pill">
              <span
                className="block h-[7px] w-[7px] rounded-full"
                style={{ background: "var(--hor-accent)" }}
                aria-hidden="true"
              />
              {topLanguage.name} · {topLanguage.pct}% of tracked code
            </span>
          ) : undefined
        }
      />

      <ul className="res-caps" role="list">
        {capabilities.map((capability, i) => (
          <li
            key={capability}
            className="res-cap hor-rise"
            style={{ "--hor-delay": `${60 + i * 40}ms` } as CSSProperties}
          >
            <span className="res-cap-idx" aria-hidden="true">
              {String(i + 1).padStart(2, "0")}
            </span>
            {capability}
          </li>
        ))}
      </ul>
    </section>
  );
}
