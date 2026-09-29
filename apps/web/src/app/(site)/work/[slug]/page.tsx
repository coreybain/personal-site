import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Boundary } from "@/components/site/Boundary";
import { stampTime } from "@/components/site/format";
import { CaseBody } from "@/components/site/work/CaseBody";
import { CaseDeck } from "@/components/site/work/CaseDeck";
import { CaseHero } from "@/components/site/work/CaseHero";
import { CaseNarrative } from "@/components/site/work/CaseNarrative";
import { CaseNav } from "@/components/site/work/CaseNav";
import { getProjects, getSiteData } from "@/lib/data";
import { deriveWork, pad2 } from "@/lib/derive";
import { renderMarkdown } from "@/lib/markdown";

import "../work.css";

type CaseParams = { slug: string };

/**
 * The published platforms, prerendered at build time.
 *
 * An empty live collection produces no build-time params, which is honest: no
 * case studies are currently published. `dynamicParams` below still allows a
 * project published after the build to render on demand.
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
 * Per-case metadata.
 *
 * Titles are **bare** — `(site)/layout.tsx` owns the `%s — Corey Baines` suffix
 * and applies it from live identity, so writing it out here would double it.
 *
 * A slug that resolves to nothing returns the section title rather than
 * throwing: this function runs *before* the page's `notFound()`, and a metadata
 * exception on a 404 turns a clean 404 into a 500. It gets no canonical, because
 * a page that does not exist has no canonical URL.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<CaseParams>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { projects } = await getSiteData();
  const project = projects.find((p) => p.slug === slug);

  if (!project) {
    return { title: "Work" };
  }

  return {
    title: project.title,
    description: `${project.role} at ${project.client}. ${project.summary}`,
    alternates: { canonical: `/work/${project.slug}` },
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
 * The structured overview (`problem`, `approach`, `outcomes`) and optional
 * Markdown body come from the same project row. Every field is optional on the
 * public type, so each block renders only when its source content exists.
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
  const bodyHtml = project.body ? await renderMarkdown(project.body) : "";

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
          <CaseBody html={bodyHtml} />
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
