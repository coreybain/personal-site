import { AiSignal } from "@/components/site/AiSignal";
import { Boundary } from "@/components/site/Boundary";
import { FeaturedWork } from "@/components/site/FeaturedWork";
import { GitSignal } from "@/components/site/GitSignal";
import { Hero } from "@/components/site/Hero";
import { LifeStrip } from "@/components/site/LifeStrip";
import { stampTime } from "@/components/site/format";
import { getSiteData } from "@/lib/data";

/**
 * ISR — five minutes, the same window every `(site)` route declares. Written as
 * a literal because Next requires the value to be statically analysable; see the
 * header of `@/lib/data` for why 300 and not 60 or 3600.
 */
export const revalidate = 300;

/**
 * Horizon — the homepage.
 *
 * Aurora above, Observatory below. The page opens as a calm sky: one soft
 * gradient wash, quiet display type, sans numerals. It crosses a literal
 * horizon rule into a telemetry deck — graph-paper ground, hairline instrument
 * panels, mono readouts — and then surfaces again for the work tiles and the
 * life strip. One accent family (dusk violet, with the ramp's sun at its hot
 * end) runs through both zones so the page reads as one system.
 *
 * The theme scope, the nav pill and the footer live in `layout.tsx` and are
 * shared by every page under `(site)`. What stays here is only this page's own
 * zone structure — sky, boundary, deck, boundary, sky.
 *
 * Server component end to end. The only client code in the shell is
 * <ThemeScope> (wrapper + pre-paint boot script + context) and the footer's
 * theme picker. Every colour below the scope resolves from `--hor-*`, so
 * changing `data-theme` re-skins the page without moving a pixel.
 *
 * ── Where the numbers come from ────────────────────────────────────────────
 *
 * `getSiteData()` — Convex where there is a row, the mock per domain where
 * there is not, one `Snapshot` either way. It is read **once, here**, and passed
 * down as props; no section below reaches for data itself. That rule is the
 * whole reason the sections take props at all, and it is what keeps a homepage
 * request at one round of queries no matter how many panels get added.
 *
 * The read is shared with the layout and with `generateMetadata` through
 * React's `cache()`, so the footer's snapshot stamp and the deck's telemetry are
 * measured against the same `computedAt` — a page that contradicts itself is the
 * failure mode a per-component fetch produces.
 *
 * PHASE 4 (ADR 004) — the target is *one* document read. It is six today because
 * the denormalising cron does not exist yet: the snapshot row already embeds
 * `identity` and `latestFunEntry`, and the same cron is what will let this page
 * stop reaching for projects, labs, fun entries and the resume separately. When
 * it lands the extra queries collapse into the singleton inside `@/lib/data`,
 * and nothing on this page changes.
 */
export default async function HomePage() {
  const { identity, gitStats, aiUsage, projects, funEntries, computedAt } =
    await getSiteData();

  return (
    <main>
      {/* ── above the horizon: calm ───────────────────────────────── */}
      <section className="hor-sky">
        <div className="hor-wash" aria-hidden="true" />
        <div className="hor-shell">
          <Hero
            identity={identity}
            gitStats={gitStats}
            aiUsage={aiUsage}
            projects={projects}
          />
        </div>
      </section>

      <Boundary label={`Telemetry · ${stampTime(computedAt)}`} />

      {/* ── below the horizon: dense ──────────────────────────────── */}
      <div className="hor-deck-zone">
        <div className="hor-deck-grid" aria-hidden="true" />
        <div className="hor-shell pb-16 sm:pb-20">
          <GitSignal gitStats={gitStats} />
          {/* The cadence figures divide by the same window the heatmap
              draws, so the week count is read once and handed to both. */}
          <AiSignal aiUsage={aiUsage} weeks={gitStats.calendar.length} />
        </div>
      </div>

      <Boundary direction="out" />

      {/* ── back above the horizon: calm again ────────────────────── */}
      <section className="hor-sky">
        <div className="hor-shell">
          <FeaturedWork projects={projects} />
          <LifeStrip entries={funEntries} location={identity.location} />
        </div>
      </section>
    </main>
  );
}
