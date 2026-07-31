/**
 * WorkJsonLd — CollectionPage + ItemList, on `/work`.
 *
 * `/work` is a page *about* a set of other pages, which is precisely what
 * `CollectionPage` means. The set itself is an `ItemList` of `ListItem`s in the
 * grid's own order, so a consumer that surfaces the collection surfaces the case
 * studies in the sequence the admin chose (`by_published_sortOrder`) rather than
 * in whatever order it happened to crawl them.
 *
 * ── What each item does and does not claim ─────────────────────────────────
 *
 * A `ListItem` carries `position`, `url` and `name` and stops there. It
 * deliberately does **not** promote each case study to a `CreativeWork` with an
 * author and a date:
 *
 *   - ADR 008 and the Attribution glossary entry are explicit that CI work is
 *     the client's. Marking up a QuoteCloud case study as a work Corey *authored*
 *     would be a machine-readable overclaim, on the one axis where this site has
 *     been careful to be exact.
 *   - The case studies carry no published or modified date in the `Project`
 *     contract, so any `datePublished` would be invented.
 *
 * `about` points at the Person: the collection is about the engineer's work,
 * and that link is what ties /work into the same graph as / and /resume.
 *
 * Server component, no client JS. The page passes data it has already read.
 */

import { absoluteUrl } from "@/lib/seo";
import type { Identity, Project } from "@/lib/snapshot";

import { JsonLd } from "./JsonLd";
import { graph, personStub, websiteStub } from "./schema";
import type { JsonLdNode } from "./schema";

export function WorkJsonLd({
  identity,
  projects,
}: {
  identity: Identity;
  projects: readonly Project[];
}) {
  const items: JsonLdNode[] = projects.map((project, index) => ({
    "@type": "ListItem",
    // 1-based, as the vocabulary requires. `pad2`-style display numbering on the
    // page is a presentation choice; this is the ordinal.
    position: index + 1,
    url: absoluteUrl(`/work/${project.slug}`),
    name: project.title,
  }));

  return (
    <JsonLd
      data={graph({
        "@type": "CollectionPage",
        "@id": `${absoluteUrl("/work")}#page`,
        url: absoluteUrl("/work"),
        name: `Work — ${identity.name}`,
        description: `${projects.length} production platforms built as ${identity.role} at ${identity.company}, each attributed to its client and shown with the evidence of how it was built.`,
        inLanguage: "en-AU",
        // Stubs rather than bare `@id`s — this page declares neither node, so a
        // reference with no `name` would resolve to nothing for a consumer
        // reading one page at a time. Same `@id`s as the full declarations on /.
        isPartOf: websiteStub(identity),
        about: personStub(identity),
        mainEntity: {
          "@type": "ItemList",
          numberOfItems: projects.length,
          itemListOrder: "https://schema.org/ItemListOrderAscending",
          itemListElement: items,
        },
      })}
    />
  );
}
