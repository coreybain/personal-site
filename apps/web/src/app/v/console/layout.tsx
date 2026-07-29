import type { Metadata } from "next";
import type { ReactNode } from "react";
import { IBM_Plex_Mono, Inter } from "next/font/google";

import { snapshot } from "@/lib/snapshot";
import { group } from "@/components/v/console/format";

import "./console.css";

/**
 * Fonts are loaded here and nowhere else. They are exposed as CSS variables
 * consumed only by rules scoped under `.con` (and `.con-frame`) in console.css.
 *
 * Inter for the interface, IBM Plex Mono for every numeral, label and readout —
 * the instrument voice this direction inherits from Observatory.
 */
const conSans = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--con-font-sans",
});

const conMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--con-font-mono",
});

const { identity, gitStats, aiUsage, projects } = snapshot;

export const metadata: Metadata = {
  title: `${identity.name} — ${identity.role}`,
  description: `${identity.role} in ${identity.location}. ${group(
    gitStats.totalContributionsYear,
  )} contributions in the last year, ${projects.length} platforms shipped for ${
    identity.company
  }, ${group(
    aiUsage.totalSessions,
  )} agent sessions. A living dashboard, light and dark.`,
};

/**
 * The frame sits ABOVE the <ThemeScope> the page renders, so it carries the
 * font variables and nothing else — no colour is decided here.
 */
export default function ConsoleLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <div className={`con-frame ${conSans.variable} ${conMono.variable}`}>
      {children}
    </div>
  );
}
