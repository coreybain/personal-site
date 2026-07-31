import type { Metadata } from "next";

import { Boundary } from "@/components/site/Boundary";
import { num, stampTime } from "@/components/site/format";
import { BuildLedger } from "@/components/site/work/BuildLedger";
import { WorkGrid } from "@/components/site/work/WorkGrid";
import { WorkIntro } from "@/components/site/work/WorkIntro";
import { WorkScrollRestoration } from "@/components/site/work/WorkScrollRestoration";
import { WorkJsonLd } from "@/components/site/seo";
import { getSiteData } from "@/lib/data";
import { deriveWork } from "@/lib/derive";

import "./work.css";

/**
 * ISR, five minutes. The literal is written out rather than imported from
 * `REVALIDATE_SECONDS` because Next requires this value to be statically
 * analysable — see the ISR section of `@/lib/data`'s header for the reasoning
 * behind the number, and why an uncached Convex `fetch` still prerenders.
 */
export const revalidate = 300;

/**
 * `generateMetadata` rather than a `metadata` constant: the description quotes
 * live figures, and a module-scope object is built once per process.
 *
 * It calls `getSiteData()` a second time on purpose. The assembler is wrapped in
 * React's `cache()`, and metadata generation shares a request scope with the
 * render below, so this is the same six queries — not twelve.
 *
 * The title is **bare**. `(site)/layout.tsx` declares
 * `title.template: "%s — Corey Baines"` and the suffix is applied there, from
 * live identity; spelling it out here would produce "Work — Corey Baines —
 * Corey Baines".
 */
export async function generateMetadata(): Promise<Metadata> {
  const { identity, projects, gitStats } = await getSiteData();
  const { buildSessions, buildHours } = deriveWork(projects);

  return {
    title: "Work",
    description: `${projects.length} production platforms built as ${identity.role} at ${
      identity.company
    }: document automation, travel operations, compliance and real-time auctions. ${num(
      gitStats.totalContributionsYear,
    )} contributions in twelve months, ${num(buildSessions)} agent sessions and ${num(
      buildHours,
    )} hours logged against them.`,
    alternates: { canonical: "/work" },
  };
}

/**
 * /work — the case-study index.
 *
 * Same zone structure as the homepage, because it is the same site: a calm sky
 * states the shape of the work, the page crosses the horizon into a telemetry
 * deck for the build ledger, then surfaces again for the image-led grid. The
 * shell (ThemeScope, nav pill, footer) comes from the `(site)` layout; what
 * lives here is only this page's own zones.
 *
 * Every figure on the page is read from Convex by `@/lib/data` — with the mock
 * as a per-domain fallback — and derived by `deriveWork()`. Nothing is typed in
 * by hand, and nothing is fetched below this function: the snapshot is read
 * **once** here and passed down as props, which is what keeps a three-component
 * page at one round of queries.
 */
export default async function WorkPage() {
  const { identity, projects, gitStats, aiUsage, computedAt } =
    await getSiteData();
  const work = deriveWork(projects);

  return (
    <main>
      <WorkScrollRestoration />

      {/* CollectionPage + ItemList, in the grid's own order. The items are
          ListItems and nothing more — ADR 008 makes CI work the client's, so
          the graph names the case studies without claiming authorship of them.
          See components/site/seo/WorkJsonLd.tsx. */}
      <WorkJsonLd identity={identity} projects={projects} />

      {/* ── above the horizon: the shape of the work ──────────────── */}
      <section className="hor-sky">
        <div className="hor-wash" aria-hidden="true" />
        <div className="hor-shell">
          <WorkIntro
            identity={identity}
            gitStats={gitStats}
            projects={projects}
            {...work}
          />
        </div>
      </section>

      <Boundary label={`Build ledger · ${stampTime(computedAt)}`} />

      {/* ── below the horizon: what it cost to build ──────────────── */}
      <div className="hor-deck-zone">
        <div className="hor-deck-grid" aria-hidden="true" />
        <div className="hor-shell pb-16 sm:pb-20">
          <BuildLedger aiUsage={aiUsage} projects={projects} {...work} />
        </div>
      </div>

      <Boundary direction="out" />

      {/* ── back above the horizon: the platforms themselves ──────── */}
      <section className="hor-sky">
        <div className="hor-shell">
          <WorkGrid projects={projects} />
        </div>
      </section>
    </main>
  );
}
