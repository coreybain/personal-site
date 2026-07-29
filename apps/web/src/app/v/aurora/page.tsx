import { AiSignal } from "@/components/v/aurora/AiSignal";
import { FeaturedWork } from "@/components/v/aurora/FeaturedWork";
import { Footer } from "@/components/v/aurora/Footer";
import { GitSignal } from "@/components/v/aurora/GitSignal";
import { Hero } from "@/components/v/aurora/Hero";
import { LifeStrip } from "@/components/v/aurora/LifeStrip";
import { TopBar } from "@/components/v/aurora/TopBar";
import styles from "@/components/v/aurora/aurora.module.css";

/**
 * Soft Depth — the /v/aurora homepage.
 *
 * Fully server-rendered: no client components, no hydration, no chart library.
 * Every number on this page comes from `@/lib/snapshot`.
 */
export default function AuroraVariant() {
  return (
    <div className={styles.shell}>
      <TopBar />

      <main>
        <Hero />
        <div className="flex flex-col gap-20 sm:gap-24 lg:gap-32">
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
  );
}
