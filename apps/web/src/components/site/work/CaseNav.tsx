import type { CSSProperties } from "react";
import Link from "next/link";

import type { Project } from "@/lib/snapshot";

import { ArrowLeft, ArrowRight, WorkArt } from "./WorkArt";
import { pad2, projectIndex } from "./data";

/**
 * Sky zone, at the foot of a case study. Two cards, always — the neighbour
 * list wraps at both ends, so there is no dead corner on the first or last
 * platform and no layout that changes shape between pages.
 */

function delay(ms: number): CSSProperties {
  return { "--hor-delay": `${ms}ms` } as CSSProperties;
}

function NavCard({
  project,
  direction,
  ms,
}: {
  project: Project;
  direction: "prev" | "next";
  ms: number;
}) {
  const index = projectIndex(project.slug);
  const isNext = direction === "next";

  return (
    <Link
      href={`/work/${project.slug}`}
      className={`hor-card hor-lift hor-work-card hor-rise work-nav ${
        isNext ? "work-nav-next" : ""
      }`}
      style={delay(ms)}
    >
      <div className="work-nav-art">
        <WorkArt project={project} index={Math.max(index, 0)} size="mini" />
      </div>

      <div className="min-w-0 flex-1 py-1 pr-1">
        <span
          className={`hor-eyebrow ${isNext ? "justify-end" : ""}`}
          style={{ display: "flex" }}
        >
          {isNext ? null : <ArrowLeft />}
          {isNext ? "Next platform" : "Previous platform"}
          {isNext ? <ArrowRight /> : null}
        </span>
        <p className="hor-h3 mt-2 truncate">{project.title}</p>
        <p className="hor-micro mt-1.5 truncate">
          {pad2(index + 1)} · {project.client}
        </p>
      </div>
    </Link>
  );
}

export function CaseNav({
  prev,
  next,
}: {
  prev: Project;
  next: Project;
}) {
  return (
    <nav
      className="pt-16 pb-16 sm:pt-20 sm:pb-20"
      aria-label="Other case studies"
    >
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <span className="hor-eyebrow">
          <span className="hor-mono">04</span>
          <span className="hor-tick" aria-hidden="true" />
          Keep reading
        </span>
        <Link href="/work" className="hor-link hor-micro">
          All work
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
        <NavCard project={prev} direction="prev" ms={60} />
        <NavCard project={next} direction="next" ms={120} />
      </div>
    </nav>
  );
}
