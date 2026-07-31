/**
 * HomeJsonLd — Person + WebSite, on `/` only.
 *
 * The homepage is where the site says who it is about, so it is where the full
 * Person node is declared. Every other page in the graph — /resume's
 * ProfilePage, /work's CollectionPage, each Article — refers back to the same
 * `@id` instead of restating it, which is what makes six pages describe one
 * engineer rather than six.
 *
 * ── The description is the page's own argument ─────────────────────────────
 *
 * It quotes the same three figures the hero prints, from the same snapshot,
 * because structured data that disagrees with the visible page is worse than no
 * structured data at all — Google's own guidance treats it as a reason to
 * distrust the markup entirely. Everything here is a restatement of something
 * rendered above it.
 *
 * Server component. No props are read from a client boundary and no JavaScript
 * ships; the page hands it the snapshot it already has, so this costs zero
 * additional reads.
 */

import { num } from "@/components/site/format";
import type { AiUsage, GitStats, Identity, Project } from "@/lib/snapshot";

import { JsonLd } from "./JsonLd";
import { graph, personNode, websiteNode } from "./schema";

export function HomeJsonLd({
  identity,
  gitStats,
  aiUsage,
  projects,
}: {
  identity: Identity;
  gitStats: GitStats;
  aiUsage: AiUsage;
  projects: readonly Project[];
}) {
  const description = `${identity.role} in ${identity.location}. ${num(
    gitStats.totalContributionsYear,
  )} contributions in the last year, ${projects.length} platforms shipped for ${
    identity.company
  }, ${num(aiUsage.totalSessions)} agent sessions.`;

  return (
    <JsonLd
      data={graph(
        personNode(identity, description),
        websiteNode(identity, description),
      )}
    />
  );
}
