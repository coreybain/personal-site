import type { Metadata } from "next";
import { snapshot } from "@/lib/snapshot";
import { AiSignal } from "@/components/v/terminal/AiSignal";
import { Footer, TopBar } from "@/components/v/terminal/Chrome";
import { FeaturedWork } from "@/components/v/terminal/FeaturedWork";
import { GitSignal } from "@/components/v/terminal/GitSignal";
import { Hero } from "@/components/v/terminal/Hero";
import { LifeStrip } from "@/components/v/terminal/LifeStrip";

export const metadata: Metadata = {
  title: "Observatory — Corey Baines, Principal Engineer",
  description:
    "A principal engineer's control room: 52 weeks of contribution telemetry, agent throughput and platform work, computed from one snapshot.",
};

/**
 * Observatory — the living-dashboard direction.
 *
 * Fully server-rendered: no client components, no hooks, no effects. Every
 * number on this page is read from `snapshot` or derived from it in place;
 * motion is CSS-only and touches opacity/transform exclusively, so nothing here
 * can shift layout after paint.
 */
export default function TerminalVariant() {
  const { identity, gitStats, aiUsage, projects, funEntries, computedAt } =
    snapshot;

  return (
    <>
      <TopBar computedAt={computedAt} />

      <main>
        <Hero snapshot={snapshot} />
        <GitSignal gitStats={gitStats} />
        <FeaturedWork projects={projects} />
        <AiSignal aiUsage={aiUsage} />
        <LifeStrip entries={funEntries} />
      </main>

      <Footer identity={identity} computedAt={computedAt} />
    </>
  );
}
