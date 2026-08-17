import type { Lab } from "@/lib/snapshot";

/** Editorial launch data used until the matching Convex row reaches production. */
export const PATHWAY_LAB: Lab = {
  slug: "pathway",
  title: "Pathway",
  summary:
    "A Business Agentic OS for startups: one operating surface for AI agents, projects, issues, source control, schedules and the plugin-powered tools a growing company needs.",
  repoFullName: "coreybain/pathway",
  language: "TypeScript",
  links: { live: "https://app.spiritdevs.com/" },
  liveStats: { stars: 0, forks: 0, commitsYear: 2985, lastPushDaysAgo: 0 },
  featured: true,
};

/**
 * Keep the public Labs catalogue aligned with the current editorial selection.
 * A live Pathway row replaces the launch fallback automatically.
 */
export function curateLabs(labs: readonly Lab[]): Lab[] {
  const pathway = labs.find((lab) => lab.slug === PATHWAY_LAB.slug) ?? PATHWAY_LAB;

  return [
    pathway,
    ...labs.filter((lab) => lab.slug !== PATHWAY_LAB.slug && lab.slug !== "statline"),
  ];
}
