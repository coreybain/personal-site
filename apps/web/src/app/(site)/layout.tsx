import type { Metadata } from "next";
import type { ReactNode } from "react";
import { IBM_Plex_Mono, Inter } from "next/font/google";

import { MotionProvider } from "@/components/motion";
import { Footer, NavPill } from "@/components/site/Chrome";
import { num } from "@/components/site/format";
import { ThemeScope } from "@/components/theme/ThemeScope";
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

/**
 * Shared chrome for every page under `(site)`.
 *
 *   fonts wrapper  — carries the two font variables into the scope
 *   ThemeScope     — the `.hor` element that owns `data-theme`; the only
 *                    client boundary in the shell that renders DOM (wrapper +
 *                    pre-paint script)
 *   MotionProvider — LazyMotion + MotionConfig (ADR 013). Renders no DOM, and
 *                    sits *inside* ThemeScope so the pre-paint boot script
 *                    stays the scope's first child
 *   NavPill        — floating glyph nav, persists across route changes
 *   {children}     — the page's own zones (sky / deck / sky)
 *   Footer         — contact block + theme picker, persists across routes
 *
 * Pages below this layout render *only* their sections. Because the scope and
 * the chrome now live in the layout, a client-side navigation between site
 * routes swaps `{children}` and leaves the theme, the pill and the footer
 * mounted — no re-boot, no flash.
 */
export default function SiteLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <div className={`hor-fonts ${horSans.variable} ${horMono.variable}`}>
      <ThemeScope className="hor" defaultTheme="dark">
        <MotionProvider>
          <NavPill />
          {children}
          <Footer />
        </MotionProvider>
      </ThemeScope>
    </div>
  );
}
