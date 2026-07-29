import { ThemeScope } from "@/components/theme/ThemeScope";
import { AiSignal } from "@/components/site/AiSignal";
import { Boundary } from "@/components/site/Boundary";
import { Footer, NavPill } from "@/components/site/Chrome";
import { FeaturedWork } from "@/components/site/FeaturedWork";
import { GitSignal } from "@/components/site/GitSignal";
import { Hero } from "@/components/site/Hero";
import { LifeStrip } from "@/components/site/LifeStrip";
import { stampTime } from "@/components/site/format";
import { snapshot } from "@/lib/snapshot";

/**
 * Horizon — the /v/horizon homepage.
 *
 * Aurora above, Observatory below. The page opens as a calm sky: one soft
 * gradient wash, quiet display type, sans numerals. It crosses a literal
 * horizon rule into a telemetry deck — graph-paper ground, hairline instrument
 * panels, mono readouts — and then surfaces again for the work tiles and the
 * life strip. One accent family (dusk violet, with the ramp's sun at its hot
 * end) runs through both zones so the page reads as one system.
 *
 * Server component end to end. The only client code is <ThemeScope> (wrapper +
 * pre-paint boot script + context) and the <ThemeToggle> in the nav pill. Every
 * colour below the scope resolves from `--hor-*`, so flipping `data-theme`
 * re-skins the page without moving a pixel.
 *
 * Every number is read from `@/lib/snapshot` or derived from it in place.
 */
export default function HorizonPage() {
  return (
    <ThemeScope className="hor" defaultTheme="dark">
      <NavPill />

      <main>
        {/* ── above the horizon: calm ───────────────────────────────── */}
        <section className="hor-sky">
          <div className="hor-wash" aria-hidden="true" />
          <div className="hor-shell">
            <Hero />
          </div>
        </section>

        <Boundary label={`Telemetry · ${stampTime(snapshot.computedAt)}`} />

        {/* ── below the horizon: dense ──────────────────────────────── */}
        <div className="hor-deck-zone">
          <div className="hor-deck-grid" aria-hidden="true" />
          <div className="hor-shell pb-16 sm:pb-20">
            <GitSignal />
            <AiSignal />
          </div>
        </div>

        <Boundary direction="out" />

        {/* ── back above the horizon: calm again ────────────────────── */}
        <section className="hor-sky">
          <div className="hor-shell">
            <FeaturedWork />
            <LifeStrip />
          </div>
        </section>
      </main>

      <Footer />
    </ThemeScope>
  );
}
