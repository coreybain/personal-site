import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";

import { snapshot } from "@/lib/snapshot";

import styles from "@/components/v/aurora/aurora.module.css";
import { num } from "@/components/v/aurora/format";

const sans = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-aurora-sans",
});

const mono = Geist_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-aurora-mono",
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

export default function AuroraLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className={`${sans.variable} ${mono.variable} ${styles.root}`}>
      <div className={styles.backdrop} aria-hidden="true">
        <div className={`${styles.blob} ${styles.blob1}`} />
        <div className={`${styles.blob} ${styles.blob2}`} />
        <div className={`${styles.blob} ${styles.blob3}`} />
        <div className={`${styles.blob} ${styles.blob4}`} />
        <div className={styles.grain} />
      </div>
      <div className={styles.page}>{children}</div>
    </div>
  );
}
