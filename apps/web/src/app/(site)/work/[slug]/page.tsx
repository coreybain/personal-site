import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Boundary } from "@/components/site/Boundary";
import { stampTime } from "@/components/site/format";
import { CaseDeck } from "@/components/site/work/CaseDeck";
import { CaseHero } from "@/components/site/work/CaseHero";
import { CaseNarrative } from "@/components/site/work/CaseNarrative";
import { CaseNav } from "@/components/site/work/CaseNav";
import { getProjects, getSiteData } from "@/lib/data";
import { deriveWork, pad2 } from "@/lib/derive";

import "../work.css";

type CaseParams = { slug: string };

/**
 * ISR, five minutes — the same window every `(site)` page declares. See the ISR
 * section of `@/lib/data`'s header; the literal is required to be statically
 * analysable, so it is written out rather than imported.
 */
export const revalidate = 300;

/**
 * The published platforms, prerendered at build time.
 *
 * The empty-list guard this needs already lives in the read layer, and lives
 * there only once: `getSiteData()` substitutes `mock.projects` whenever the
 * Convex `projects` query is empty or fails, so `getProjects()` cannot return an
 * empty array and leave the whole route unprerendered. Repeating the fallback
 * here would be a second copy of the per-domain rule that could drift from the
 * first — the read layer owns it.
 *
 * This is the *build-time* list, not the whole list. `generateStaticParams` is
 * not re-run by ISR (it runs during `next build` only), so anything published
 * after the last deploy is covered by `dynamicParams` below rather than here.
 */
export async function generateStaticParams(): Promise<CaseParams[]> {
  const projects = await getProjects();

  return projects.map((project) => ({ slug: project.slug }));
}

/**
 * Slugs not prerendered above are rendered on demand, then cached for the same
 * 300s window as everything else.
 *
 * This used to be `false`, which was correct while `projects` was a frozen mock
 * — the build-time list *was* the complete list, so "not prerendered" really did
 * mean "not a case study". With `projects.list` live that stopped being true: a
 * case study published from the admin appears in the /work grid on the grid's
 * next revalidation (≤300s), but `false` would 404 its detail page until the
 * next deploy. The grid and the detail route would disagree about the same
 * legitimately authored content, which is the one failure a reader would read as
 * the site being broken.
 *
 * `true` costs nothing in correctness because the page below already 404s on its
 * own: `deriveWork(projects).projectIndex(slug)` returns -1 for anything
 * `getSiteData()` did not return, and `projects.list` never returns a draft. So
 * a draft slug and a nonexistent slug both still get `notFound()` — a real 404,
 * generated once and cached, not a rendered page.
 */
export const dynamicParams = true;

export async function generateMetadata({
  params,
}: {
  params: Promise<CaseParams>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { identity, projects } = await getSiteData();
  const project = projects.find((p) => p.slug === slug);

  if (!project) {
    return { title: `Work — ${identity.name}` };
  }

  return {
    title: `${project.title} — ${identity.name}`,
    description: `${project.role} at ${project.client}. ${project.summary}`,
  };
}

/**
 * /work/[slug] — one case study.
 *
 * Sky for the head and the narrative, deck for the outcomes and the agent
 * instrumentation, sky again for the prev/next pair. The same three-zone
 * grammar as the homepage, because a case study is the same site making a more
 * specific claim.
 *
 * Prose (`problem`, `approach`, `outcomes`) is draft copy carried on the
 * snapshot; every figure is measured data from the same document. Both are
 * optional on the type, so each block renders only when its field exists.
 *
 * One read for the whole page: the project, its index, its neighbours and the
 * cross-platform build figures all come out of a single `getSiteData()`, so the
 * `03 / 04` in the hero, the `Case 03` on the boundary and the rank in the
 * instrument panel cannot disagree with each other.
 */
export default async function CaseStudyPage({
  params,
}: {
  params: Promise<CaseParams>;
}) {
  const { slug } = await params;
  const { identity, projects, aiUsage, computedAt } = await getSiteData();
  const work = deriveWork(projects);

  const index = work.projectIndex(slug);

  if (index === -1) notFound();

  const project = projects[index];
  const { prev, next } = work.neighbours(index);

  return (
    <main>
      {/* ── above the horizon: what it is, and what was wrong ─────── */}
      <section className="hor-sky">
        <div className="hor-wash" aria-hidden="true" />
        <div className="hor-shell">
          <CaseHero
            project={project}
            index={index}
            projectCount={projects.length}
            identity={identity}
          />
          <CaseNarrative project={project} />
        </div>
      </section>

      <Boundary label={`Case ${pad2(index + 1)} · ${stampTime(computedAt)}`} />

      {/* ── below the horizon: what it produced ───────────────────── */}
      <div className="hor-deck-zone">
        <div className="hor-deck-grid" aria-hidden="true" />
        <div className="hor-shell pb-16 sm:pb-20">
          <CaseDeck project={project} aiUsage={aiUsage} {...work} />
        </div>
      </div>

      <Boundary direction="out" />

      {/* ── back above the horizon ────────────────────────────────── */}
      <section className="hor-sky">
        <div className="hor-shell">
          <CaseNav prev={prev} next={next} projectIndex={work.projectIndex} />
        </div>
      </section>
    </main>
  );
}
