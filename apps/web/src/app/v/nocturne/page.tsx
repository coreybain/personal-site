import { ThemeScope } from "@/components/theme/ThemeScope";
import { AiSignal } from "@/components/v/nocturne/AiSignal";
import { Backdrop } from "@/components/v/nocturne/Backdrop";
import { FeaturedWork } from "@/components/v/nocturne/FeaturedWork";
import { Footer } from "@/components/v/nocturne/Footer";
import { GitSignal } from "@/components/v/nocturne/GitSignal";
import { Hero } from "@/components/v/nocturne/Hero";
import { LifeStrip } from "@/components/v/nocturne/LifeStrip";
import { TopBar } from "@/components/v/nocturne/TopBar";

/**
 * Nocturne — the /v/nocturne homepage.
 *
 * Soft Depth translated to night: an ink-navy canvas, slow aurora light behind
 * frosted glass whose hairline borders catch it, violet-blue accent throughout.
 *
 * Server-rendered end to end. The only client code on the page is <ThemeScope>
 * (wrapper div + pre-paint boot script + context) and the <ThemeToggle> inside
 * <TopBar>. Every number comes from `@/lib/snapshot`; every colour comes from a
 * `--noc-*` custom property declared in nocturne.css. Motion is CSS only.
 *
 * `defaultTheme="dark"` because dark is this variant's design pole — that is
 * what a client with JavaScript disabled gets. Everyone else is corrected to
 * their stored or system preference before the first paint.
 */
export default function NocturnePage() {
  return (
    <ThemeScope className="noc" defaultTheme="dark">
      <Backdrop />

      <div className="noc-page">
        <div className="noc-shell">
          <TopBar />

          <main>
            <Hero />
            <div className="noc-sections">
              <GitSignal />
              <FeaturedWork />
              <AiSignal />
              <LifeStrip />
            </div>
          </main>

          <div className="mt-20 sm:mt-24 lg:mt-28">
            <Footer />
          </div>
        </div>
      </div>
    </ThemeScope>
  );
}
