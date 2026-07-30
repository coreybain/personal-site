import { DeckHead } from "@/components/site/Panel";
import type { LabsDerived } from "@/lib/derive";

import { LabCard } from "./LabCard";

/**
 * The wall — every lab as its own instrument panel, ordered by last push, so
 * the grid itself is a recency ranking. Two columns from `md` up; one column
 * below that, where a two-up panel would crush the readouts.
 *
 * `maxCommits` is threaded through to every card: each commit track is scaled
 * against the busiest repo on the wall, not against itself, so the bars are
 * comparable across the grid.
 */
export function LabWall({
  labs,
  featuredCount,
  languages,
  maxCommits,
}: Pick<LabsDerived, "labs" | "featuredCount" | "languages" | "maxCommits">) {
  return (
    <section id="repositories" className="mt-14 scroll-mt-20 sm:mt-16">
      <DeckHead
        index="03"
        title="Repositories"
        meta={`${featuredCount} featured · ${languages.join(" · ")}`}
      />

      <div className="grid gap-3 md:grid-cols-2">
        {labs.map((lab, i) => (
          <LabCard key={lab.slug} lab={lab} index={i} maxCommits={maxCommits} />
        ))}
      </div>
    </section>
  );
}
