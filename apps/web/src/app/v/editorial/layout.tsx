import type { Metadata } from "next";
import { Archivo, Fraunces } from "next/font/google";

import { num } from "@/components/v/editorial/format";
import { snapshot } from "@/lib/snapshot";

import "./editorial.css";

/**
 * Display serif. `opsz` is requested explicitly so headlines can call for the
 * 144pt display cut while captions stay on the 14pt text cut; `WONK` gives the
 * hero its editorial swash forms.
 */
const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  style: ["normal", "italic"],
  axes: ["SOFT", "WONK", "opsz"],
  variable: "--ed-serif",
});

/** Grotesk for body copy, labels and every figure on the page. */
const archivo = Archivo({
  subsets: ["latin"],
  display: "swap",
  variable: "--ed-sans",
});

export const metadata: Metadata = {
  title: `${snapshot.identity.name} — ${snapshot.identity.role}`,
  description: `Editorial Ink: a typeset annual report on one engineer. ${num(
    snapshot.gitStats.totalContributionsYear,
  )} contributions, ${snapshot.projects.length} platforms, ${num(
    snapshot.aiUsage.totalSessions,
  )} agent sessions.`,
};

export default function EditorialLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`${fraunces.variable} ${archivo.variable} w-full flex-1`}>
      {children}
    </div>
  );
}
