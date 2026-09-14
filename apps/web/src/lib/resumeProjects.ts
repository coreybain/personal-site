import type { ResumeDocument } from "@home/types";

/** Curated personal work, shared by the résumé page and PDF download. */
export const resumeProjects = [
  {
    name: "Public profile website",
    description:
      "Built my public portfolio with project case studies, live Git activity, agent usage and publishing, supported by browser and native administration.",
    url: "https://spiritdevs.com/",
  },
  {
    name: "Pathway",
    description:
      "An open-source agentic workspace with desktop, web and iOS clients. Brings coding agents, projects, issues, source control and scheduled work into one application.",
    url: "https://github.com/SpiritDevs/pathway",
  },
  {
    name: "Boca",
    description:
      "A catalogue and quoting product built for a hardware retailer in Niterói, Brazil.",
    url: "https://spiritdevs.com/labs",
  },
] as const;

export const moreProjectsUrl = "https://spiritdevs.com/labs";

/** Project details now have their own section; keep the role focused on scope. */
export function resumeWithProjectSection(resume: ResumeDocument): ResumeDocument {
  return {
    ...resume,
    experience: resume.experience.map((role) =>
      role.company === "SpiritDevs"
        ? {
            ...role,
            highlights: [
              "Additional projects include PartyBooth, a private event photo and video platform, and Pintlog, a Swift app for logging beers and where I tried them.",
            ],
          }
        : role,
    ),
  };
}
