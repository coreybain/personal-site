import type { Metadata } from "next";

import { AiSignal } from "@/components/site/AiSignal";
import { Boundary } from "@/components/site/Boundary";
import { FeaturedWork } from "@/components/site/FeaturedWork";
import { GitSignal } from "@/components/site/GitSignal";
import { Hero } from "@/components/site/Hero";
import { LifeStrip } from "@/components/site/LifeStrip";
import { HomeJsonLd } from "@/components/site/seo";
import { stampTime } from "@/components/site/format";
import { getSiteData } from "@/lib/data";

/**
 * ISR — five minutes, the same window every `(site)` route declares. Written as
 * a literal because Next requires the value to be statically analysable; see the
 * header of `@/lib/data` for why 300 and not 60 or 3600.
 */
export const revalidate = 300;

/**
 * The homepage's metadata is **only** a canonical link.
 *
 * Title and description are inherited from `(site)/layout.tsx`, where
 * `title.default` is deliberately the full "Corey Baines — Principal Engineer"
 * statement rather than a section name. Declaring a `title` here would be worse
 * than redundant: a page-level title is run through the layout's
 * `%s — Corey Baines` template, so it would come out doubled. Saying nothing is
 * how a page opts into the default.
 *
 * The canonical is absolute against `metadataBase` (ADR 017), which is what
 * makes a preview deployment point at the production homepage rather than
 * compete with it for the same query.
 *
 * A `metadata` constant rather than a `generateMetadata` function, uniquely on
 * this page: there is nothing here that depends on a read, and the rule the rest
 * of the site follows ("use the function, a module-scope object freezes the
 * mock's figures into every head") does not apply to a value that is one
 * literal path.
 */
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

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
 * `getSiteData()` assembles live Convex rows only. It is read **once, here**,
 * and passed down as props; no section below reaches for data itself. That rule
 * is the whole reason the sections take props at all, and it keeps a homepage
 * request at one round of queries no matter how many panels get added.
 *
 * The read is shared with the layout and with `generateMetadata` through
 * React's `cache()`, so the footer's snapshot stamp and the deck's telemetry are
 * measured against the same `computedAt` — a page that contradicts itself is the
 * failure mode a per-component fetch produces.
 *
 * The hourly denormalising cron supplies telemetry in the Snapshot singleton;
 * published content remains separate live reads assembled coherently here.
 */
export default async function HomePage() {
  const {
    identity,
    gitStats,
    aiUsage,
    healthStats,
    projects,
    labs,
    favoriteLabSlug,
    computedAt,
  } = await getSiteData();

  return (
    <main>
      {/* Person + WebSite, rendered server-side from the snapshot this page
          already holds. The homepage is where the graph declares who the site
          is about; every other page refers back to the same `@id`. Zero extra
          reads, zero client JS — see components/site/seo. */}
      <HomeJsonLd
        identity={identity}
        gitStats={gitStats}
        aiUsage={aiUsage}
        projects={projects}
      />

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
          <LifeStrip
            labs={labs}
            favoriteLabSlug={favoriteLabSlug}
            healthStats={healthStats}
            computedAt={computedAt}
            location={identity.location}
          />
        </div>
      </section>
    </main>
  );
}
