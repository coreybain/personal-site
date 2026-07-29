import type { ReactNode } from "react";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import "./observatory.css";

/**
 * Fonts are loaded here and nowhere else — they are exposed as CSS variables
 * consumed only by rules scoped under `.obs` in observatory.css.
 */
const obsSans = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--obs-font-sans",
});

const obsMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--obs-font-mono",
});

export default function ObservatoryLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <div className={`obs ${obsSans.variable} ${obsMono.variable}`}>
      {children}
    </div>
  );
}
