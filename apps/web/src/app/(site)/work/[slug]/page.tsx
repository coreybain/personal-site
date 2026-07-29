import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Boundary } from "@/components/site/Boundary";
import { stampTime } from "@/components/site/format";
import { CaseDeck } from "@/components/site/work/CaseDeck";
import { CaseHero } from "@/components/site/work/CaseHero";
import { CaseNarrative } from "@/components/site/work/CaseNarrative";
import { CaseNav } from "@/components/site/work/CaseNav";
import { neighbours, pad2, projectIndex } from "@/components/site/work/data";
import { snapshot } from "@/lib/snapshot";

import "../work.css";

type CaseParams = { slug: string };

/** The four platforms, prerendered at build time. */
export async function generateStaticParams(): Promise<CaseParams[]> {
  return snapshot.projects.map((project) => ({ slug: project.slug }));
}

/** Nothing outside `generateStaticParams` is a real case study. */
export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<CaseParams>;
}): Promise<Metadata> {
  const { slug } = await params;
  const project = snapshot.projects.find((p) => p.slug === slug);

  if (!project) {
    return { title: `Work — ${snapshot.identity.name}` };
  }

  return {
    title: `${project.title} — ${snapshot.identity.name}`,
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
 */
export default async function CaseStudyPage({
  params,
}: {
  params: Promise<CaseParams>;
}) {
  const { slug } = await params;
  const index = projectIndex(slug);

  if (index === -1) notFound();

  const project = snapshot.projects[index];
  const { prev, next } = neighbours(index);

  return (
    <main>
      {/* ── above the horizon: what it is, and what was wrong ─────── */}
      <section className="hor-sky">
        <div className="hor-wash" aria-hidden="true" />
        <div className="hor-shell">
          <CaseHero project={project} index={index} />
          <CaseNarrative project={project} />
        </div>
      </section>

      <Boundary
        label={`Case ${pad2(index + 1)} · ${stampTime(snapshot.computedAt)}`}
      />

      {/* ── below the horizon: what it produced ───────────────────── */}
      <div className="hor-deck-zone">
        <div className="hor-deck-grid" aria-hidden="true" />
        <div className="hor-shell pb-16 sm:pb-20">
          <CaseDeck project={project} />
        </div>
      </div>

      <Boundary direction="out" />

      {/* ── back above the horizon ────────────────────────────────── */}
      <section className="hor-sky">
        <div className="hor-shell">
          <CaseNav prev={prev} next={next} />
        </div>
      </section>
    </main>
  );
}
