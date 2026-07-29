import { Inter_Tight, JetBrains_Mono } from "next/font/google";
import "./swiss.css";

/**
 * Swiss Poster — International Typographic Style.
 *
 * Fonts are loaded here and here only. Everything visual is namespaced under
 * the `.sw` wrapper class so no rule can reach a sibling variant.
 */

/* Both are variable fonts — omitting `weight` ships one file per family and
 * gives the whole axis, which the poster type scale leans on. */
const display = Inter_Tight({
  subsets: ["latin"],
  variable: "--sw-font-display",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--sw-font-mono",
  display: "swap",
});

export default function SwissLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className={`${display.variable} ${mono.variable} sw`}>{children}</div>
  );
}
