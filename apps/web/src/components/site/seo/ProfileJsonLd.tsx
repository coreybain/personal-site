/**
 * ProfileJsonLd — ProfilePage wrapping the Person, on `/resume`.
 *
 * `ProfilePage` is the schema.org type for "a page about one person or
 * organisation", and a resume is the canonical case. The Person is declared in
 * full here rather than referenced, because /resume is the second page (with the
 * homepage) that is genuinely *about* Corey rather than about something Corey
 * made — and both declarations carry the same `@id`, so a consumer merges them
 * into one node instead of seeing two people.
 *
 * ── `dateModified` is the snapshot's, and that is the point ────────────────
 *
 * ADR 012: the resume embeds live git stats, which is "a differentiator no
 * static PDF has". `dateModified: computedAt` is that claim made machine
 * readable — the document really did change when the cron last ran, and the
 * page prints the same stamp in its own live-signal header. It is deliberately
 * not `new Date()`: a page that claims to have been modified at the instant it
 * was crawled is claiming nothing.
 *
 * `hasOccupation` is the one place the graph says more than the Person node
 * does. `Occupation` with `occupationLocation` and `estimatedSalary` omitted is
 * still useful: it names the role and its skill set as an occupation rather than
 * as a job title string, which is what a hiring-side consumer reads.
 *
 * Server component, no client JS.
 */

import { num } from "@/components/site/format";
import { absoluteUrl } from "@/lib/seo";
import type { AiUsage, GitStats, Identity } from "@/lib/snapshot";

import { JsonLd } from "./JsonLd";
import { graph, idRef, personNode, PERSON_ID, websiteStub } from "./schema";

export function ProfileJsonLd({
  identity,
  gitStats,
  aiUsage,
  capabilities,
  yearsShipping,
  computedAt,
}: {
  identity: Identity;
  gitStats: GitStats;
  aiUsage: AiUsage;
  capabilities: readonly string[];
  yearsShipping: number;
  computedAt: string;
}) {
  const description = `${identity.role} in ${identity.location}, ${yearsShipping} years shipping platforms. ${num(
    gitStats.totalContributionsYear,
  )} contributions and ${num(
    aiUsage.totalSessions,
  )} agent sessions in the last twelve months.`;

  const person = personNode(identity, description);

  return (
    <JsonLd
      data={graph(
        {
          "@type": "ProfilePage",
          "@id": `${absoluteUrl("/resume")}#page`,
          url: absoluteUrl("/resume"),
          // The page's own `<title>` verbatim: `Résumé, {role}` from the page's
          // metadata, plus the `— {name}` suffix the (site) layout's
          // `title.template` appends. A WebPage's `name` that disagrees with
          // the title it describes is the cheapest kind of wrong.
          name: `Résumé, ${identity.role} — ${identity.name}`,
          description,
          inLanguage: "en-AU",
          isPartOf: websiteStub(identity),
          // Bare `@id`s are correct here and only here: the Person node is
          // declared in full in this same graph, immediately below.
          about: idRef(PERSON_ID),
          mainEntity: idRef(PERSON_ID),
          dateModified: computedAt,
        },
        {
          ...person,
          hasOccupation: {
            "@type": "Occupation",
            name: identity.role,
            // The capabilities the Resume Document itself lists — the same
            // strings the page renders, not a second opinion about them.
            skills: [...capabilities],
          },
        },
      )}
    />
  );
}
