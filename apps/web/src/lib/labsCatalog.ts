import type { Lab } from "@/lib/snapshot";

/**
 * Keep the public Labs catalogue aligned with the current editorial selection.
 * Only published backend rows may appear; a fallback would undo unpublishing.
 */
export function curateLabs(labs: readonly Lab[]): Lab[] {
  const pathway = labs.find((lab) => lab.slug === "pathway");

  return [
    ...(pathway ? [pathway] : []),
    ...labs.filter((lab) => lab.slug !== "pathway" && lab.slug !== "statline"),
  ];
}
