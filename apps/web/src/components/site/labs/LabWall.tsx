import { DeckHead } from "@/components/site/Panel";

import { LabCard } from "./LabCard";
import { featuredCount, labs, languages } from "./data";

/**
 * The wall — every lab as its own instrument panel, ordered by last push, so
 * the grid itself is a recency ranking. Two columns from `md` up; one column
 * below that, where a two-up panel would crush the readouts.
 */
export function LabWall() {
  return (
    <section id="repositories" className="mt-14 scroll-mt-20 sm:mt-16">
      <DeckHead
        index="02"
        title="Repositories"
        meta={`${featuredCount} featured · ${languages.join(" · ")}`}
      />

      <div className="grid gap-3 md:grid-cols-2">
        {labs.map((lab, i) => (
          <LabCard key={lab.slug} lab={lab} index={i} />
        ))}
      </div>
    </section>
  );
}
