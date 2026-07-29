import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter, Geist_Mono } from "next/font/google";

import { num } from "@/components/v/nocturne/format";
import { snapshot } from "@/lib/snapshot";

import "./nocturne.css";

/*
 * Fonts are declared here and nowhere else. next/font self-hosts them, so the
 * page makes no external request. Inter carries the SF-calm display voice;
 * Geist Mono is used only for indices, date ranges and timestamps.
 */
const sans = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--noc-font-sans",
});

const mono = Geist_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--noc-font-mono",
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
 * The route layout owns exactly two things: the font variables and the scoped
 * stylesheet. Everything themed lives below <ThemeScope> in page.tsx — the
 * scope's div is what carries `data-theme`, and the aurora backdrop has to be
 * inside it to read `--noc-blob-*`.
 */
export default function NocturneLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <div className={`${sans.variable} ${mono.variable} flex flex-1 flex-col`}>
      {children}
    </div>
  );
}
