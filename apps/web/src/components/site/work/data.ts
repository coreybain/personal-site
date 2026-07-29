/**
 * Derived figures for /work and /work/[slug].
 *
 * Nothing here is a literal — every number falls out of `snapshot`. Computed
 * once at module load, because the snapshot is a frozen document and these
 * reductions have no business running per render.
 */

import type { Project } from "@/lib/snapshot";
import { snapshot } from "@/lib/snapshot";

const { projects } = snapshot;

/** A project that carries agent-effort figures. `aiBuildStats` is optional. */
export type BuiltProject = Project & {
  aiBuildStats: NonNullable<Project["aiBuildStats"]>;
};

export function hasBuildStats(project: Project): project is BuiltProject {
  return project.aiBuildStats !== undefined;
}

/** The platforms with measured agent effort behind them. */
export const buildProjects: BuiltProject[] = projects.filter(hasBuildStats);

export const buildSessions = buildProjects.reduce(
  (sum, p) => sum + p.aiBuildStats.sessions,
  0,
);

export const buildHours = buildProjects.reduce(
  (sum, p) => sum + p.aiBuildStats.hours,
  0,
);

/** Busiest platform by agent sessions — the scale every ledger bar is drawn to. */
export const peakBuildSessions = buildProjects.reduce(
  (max, p) => Math.max(max, p.aiBuildStats.sessions),
  0,
);

/** Mean session length across the client platforms, in whole minutes. */
export const avgBuildMinutes =
  buildSessions === 0 ? 0 : Math.round((buildHours * 60) / buildSessions);

/** Distinct technologies across every platform, first-appearance order. */
export const stackUnion: string[] = Array.from(
  new Set(projects.flatMap((p) => p.stack)),
);

/** Sessions, descending — used for the "rank among platforms" readout. */
const bySessions = [...buildProjects].sort(
  (a, b) => b.aiBuildStats.sessions - a.aiBuildStats.sessions,
);

/** 1-based rank of a platform by agent sessions, or 0 if it has no figures. */
export function buildRank(slug: string): number {
  return bySessions.findIndex((p) => p.slug === slug) + 1;
}

/** Position of a project in the canonical order, or -1. */
export function projectIndex(slug: string): number {
  return projects.findIndex((p) => p.slug === slug);
}

/**
 * The two projects either side of `index`, wrapping at both ends so a case
 * study always has somewhere to go next. With four platforms the pair is
 * always distinct from each other and from the current page.
 */
export function neighbours(index: number): { prev: Project; next: Project } {
  const n = projects.length;
  return {
    prev: projects[(index - 1 + n) % n],
    next: projects[(index + 1) % n],
  };
}

/** `1` → `01`. Instrument numbering. */
export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

const COUNT_WORDS = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
] as const;

/** `4` → `Four`, falling back to the digits past ten. */
export function countWord(n: number): string {
  return COUNT_WORDS[n] ?? String(n);
}
