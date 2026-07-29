import type { Metadata } from "next";
import type { ReactNode } from "react";
import { IBM_Plex_Mono, Inter } from "next/font/google";

import { num } from "@/components/v/horizon/format";
import { snapshot } from "@/lib/snapshot";

import "./horizon.css";

/**
 * Fonts are loaded here and nowhere else. They are exposed as CSS variables
 * consumed only by rules scoped under `.hor` in horizon.css:
 *
 *   Inter          — the sky. Quiet display type, sans numerals.
 *   IBM Plex Mono  — the deck. Instrument labels and machined readouts.
 *
 * The face change at the horizon is doing real work: it is how the page tells
 * you it has moved from the calm zone into the telemetry zone.
 */
const horSans = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-hor-sans",
});

const horMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-hor-mono",
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

export default function HorizonLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <div className={`hor-fonts ${horSans.variable} ${horMono.variable}`}>
      {children}
    </div>
  );
}
