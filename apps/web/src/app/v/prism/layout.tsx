import type { Metadata } from "next";
import type { ReactNode } from "react";
import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";

import { snapshot } from "@/lib/snapshot";
import { num } from "@/components/v/prism/format";

import "./prism.css";

/**
 * Fonts are loaded here and nowhere else. They are exposed as CSS variables
 * that only rules scoped under `.pri` in prism.css ever read.
 *
 * Plus Jakarta Sans carries the display voice — geometric, confident, and it
 * holds up at 800 where Inter starts to feel generic. JetBrains Mono handles
 * eyebrows and instrument labels.
 */
/* Both are variable fonts — omitting `weight` ships one file per family and
   gives the whole 400–800 range the page uses. */
const priSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-pri-sans",
});

const priMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-pri-mono",
});

const { identity, gitStats, aiUsage, projects } = snapshot;

export const metadata: Metadata = {
  title: `${identity.name} — ${identity.role}`,
  description: `${identity.role} in ${identity.location}. ${num(
    gitStats.totalContributionsYear,
  )} contributions in the last year, ${projects.length} platforms shipped for ${
    identity.company
  }, ${num(aiUsage.totalSessions)} agent sessions.`,
};

/**
 * The layout only supplies fonts and a flex column for the page to fill —
 * the themed wrapper is <ThemeScope> inside page.tsx, because everything that
 * carries colour (including the backdrop) has to live below `data-theme`.
 */
export default function PrismLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <div
      className={`${priSans.variable} ${priMono.variable} flex flex-1 flex-col`}
    >
      {children}
    </div>
  );
}
