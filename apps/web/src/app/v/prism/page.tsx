import { ThemeScope } from "@/components/theme/ThemeScope";

import { AiSignal } from "@/components/v/prism/AiSignal";
import { FeaturedWork } from "@/components/v/prism/FeaturedWork";
import { Footer } from "@/components/v/prism/Footer";
import { GitSignal } from "@/components/v/prism/GitSignal";
import { Hero } from "@/components/v/prism/Hero";
import { LifeStrip } from "@/components/v/prism/LifeStrip";
import { TopBar } from "@/components/v/prism/TopBar";

/**
 * Prism — the /v/prism homepage.
 *
 * Soft Depth's structure with a confident chromatic identity: one signature
 * spectrum (violet → blue → cyan → warm) carries the display type, the
 * contribution grid, the artwork edges and the data bars, and nothing else on
 * the page is coloured at all.
 *
 * Server-rendered end to end. The only client code below is <ThemeScope>
 * (wrapper + pre-paint boot script + context) and the <ThemeToggle> in the top
 * bar; every colour resolves from `--pri-*` under `.pri[data-theme="…"]`.
 * Every number comes from `@/lib/snapshot`.
 */
export default function PrismPage() {
  return (
    <ThemeScope className="pri">
      <div className="pri-backdrop" aria-hidden="true">
        <div className="pri-bloom pri-bloom-1" />
        <div className="pri-bloom pri-bloom-2" />
        <div className="pri-bloom pri-bloom-3" />
        <div className="pri-grain" />
      </div>

      <div className="pri-page">
        <div className="pri-edge" aria-hidden="true" />
        <TopBar />

        <main>
          <Hero />
          <div className="pri-sections mt-[clamp(4rem,8vw,7rem)]">
            <GitSignal />
            <FeaturedWork />
            <AiSignal />
            <LifeStrip />
          </div>
        </main>

        <div className="mt-[clamp(4.5rem,9vw,8rem)]">
          <Footer />
        </div>
      </div>
    </ThemeScope>
  );
}
