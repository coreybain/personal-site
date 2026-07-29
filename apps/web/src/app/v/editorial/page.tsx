import { AiSignal } from "@/components/v/editorial/AiSignal";
import { Colophon } from "@/components/v/editorial/Colophon";
import { FeaturedWork } from "@/components/v/editorial/FeaturedWork";
import { GitSignal } from "@/components/v/editorial/GitSignal";
import { Hero } from "@/components/v/editorial/Hero";
import { LifeStrip } from "@/components/v/editorial/LifeStrip";
import { RunningHead } from "@/components/v/editorial/RunningHead";

/**
 * Editorial Ink — warm paper, one vermillion ink, everything typeset.
 *
 * Fully server-rendered: no client components, no hydration. The only motion is
 * CSS (a staggered hero fade, plus scroll-driven section entrances behind an
 * `@supports` guard), and all of it is disabled under `prefers-reduced-motion`.
 */
export default function EditorialVariant() {
  return (
    <div className="ed">
      <RunningHead />
      <main>
        <Hero />
        <GitSignal />
        <FeaturedWork />
        <AiSignal />
        <LifeStrip />
      </main>
      <Colophon />
    </div>
  );
}
