import { ThemeScope } from "@/components/theme/ThemeScope";
import { snapshot } from "@/lib/snapshot";

import { AiSignal } from "@/components/v/console/AiSignal";
import { FeaturedWork } from "@/components/v/console/FeaturedWork";
import { Footer } from "@/components/v/console/Footer";
import { GitSignal } from "@/components/v/console/GitSignal";
import { Hero } from "@/components/v/console/Hero";
import { LifeStrip } from "@/components/v/console/LifeStrip";
import { TopBar } from "@/components/v/console/TopBar";

/**
 * Console — Observatory's discipline in Aurora's materials.
 *
 * Server-rendered end to end. The only client code on the page is
 * <ThemeScope> (wrapper + pre-paint boot script + context) and the
 * <ThemeToggle> that <TopBar> renders inside it. Every number comes from
 * `snapshot`; every colour comes from `--con-*`, which is declared in exactly
 * two places — `.con[data-theme="light"]` and `.con[data-theme="dark"]`.
 *
 * Motion budget: the live pulse dot, hover on cards and buttons, and the
 * theme-change colour transition. Nothing else moves, and every data widget has
 * a fixed size, so toggling the theme cannot shift a single pixel of layout.
 */
export default function ConsolePage() {
  const { identity, gitStats, aiUsage, projects, funEntries, computedAt } =
    snapshot;

  return (
    <ThemeScope className="con">
      <div className="con-backdrop" aria-hidden="true" />

      <div className="con-page">
        <TopBar identity={identity} computedAt={computedAt} />

        <main>
          <Hero snapshot={snapshot} />
          <GitSignal gitStats={gitStats} />
          <FeaturedWork projects={projects} />
          <AiSignal aiUsage={aiUsage} />
          <LifeStrip entries={funEntries} />
        </main>

        <Footer identity={identity} computedAt={computedAt} />
      </div>
    </ThemeScope>
  );
}
