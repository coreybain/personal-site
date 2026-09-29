import type { ResumeDocument } from "@home/types";

/** Curated personal work, shared by the résumé page and PDF download. */
export const resumeProjects = [
  {
    name: "Pathway",
    description:
      "An open-source agentic workspace with desktop, web and iOS clients. Brings coding agents, projects, issues, source control and scheduled work into one application.",
    url: "https://github.com/SpiritDevs/pathway",
  },
  {
    name: "Uploadfile",
    description:
      "A developer file upload and hosting service I'm building. Files go to regional S3 storage and out through a CloudFront CDN, with signed uploads and access checks at the edge. Custom sync and billing engines handle accounts, tenant permissions, quotas and usage.",
    url: "https://www.uploadfile.dev",
  },
] as const;

export const moreProjectsUrl = "https://spiritdevs.com/labs";

/**
 * Project details now have their own section, so the SpiritDevs role shows only
 * its title and a pointer to the smaller projects. The stored summary stays
 * (the schema requires one); an empty string here tells the page and PDF to skip it.
 */
export function resumeWithProjectSection(resume: ResumeDocument): ResumeDocument {
  return {
    ...resume,
    experience: resume.experience.map((role) =>
      role.company === "SpiritDevs"
        ? {
            ...role,
            summary: "",
            highlights: [
              "Additional projects include PartyBooth, a private event photo and video platform, and Pintlog, a Swift app for logging beers and where I tried them.",
            ],
          }
        : role,
    ),
  };
}
