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

/** The independent-work role, shown beside the Personal projects heading instead of in Experience. */
const PROJECTS_COMPANY = "SpiritDevs";

/**
 * Project details have their own section, so the SpiritDevs role is not
 * repeated as an Experience entry. The stored role stays: it still counts
 * towards the years of work experience, and `personalProjectsMeta` prints its
 * company and dates beside the Personal projects heading.
 */
export function resumeWithProjectSection(resume: ResumeDocument): ResumeDocument {
  return {
    ...resume,
    experience: resume.experience.filter((role) => role.company !== PROJECTS_COMPANY),
  };
}

/** "SpiritDevs · 2016 — Present", or nothing if the role is not on the resume. */
export function personalProjectsMeta(resume: ResumeDocument): string | undefined {
  const role = resume.experience.find((entry) => entry.company === PROJECTS_COMPANY);
  return role ? `${role.company} · ${role.start} — ${role.end}` : undefined;
}
