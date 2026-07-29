import type { CSSProperties } from "react";
import Link from "next/link";

import type { Project } from "@/lib/snapshot";
import { snapshot } from "@/lib/snapshot";

import { ArrowLeft, WorkArt } from "./WorkArt";
import { pad2 } from "./data";

/**
 * Sky zone. The head of a case study: where you are, what it is, who it was
 * for, and one banner of the project's own procedural art.
 *
 * The attribution sits directly under the title in full ink — role at client,
 * stated before a single claim is made about the work.
 */

function delay(ms: number): CSSProperties {
  return { "--hor-delay": `${ms}ms` } as CSSProperties;
}

export function CaseHero({
  project,
  index,
}: {
  project: Project;
  index: number;
}) {
  return (
    <header className="pt-24 pb-14 sm:pt-28 sm:pb-16 lg:pt-32">
      <div className="hor-rise" style={delay(30)}>
        <Link href="/work" className="work-back">
          <ArrowLeft />
          All work
        </Link>
      </div>

      <div className="hor-rise mt-8 sm:mt-10" style={delay(80)}>
        <span className="hor-eyebrow">
          <span className="hor-mono">
            {pad2(index + 1)} / {pad2(snapshot.projects.length)}
          </span>
          <span className="hor-tick" aria-hidden="true" />
          Case study
        </span>
      </div>

      <h1
        className="hor-display hor-rise mt-5 text-balance sm:mt-6"
        style={delay(130)}
      >
        {project.title}
      </h1>

      <div
        className="hor-rise mt-6 flex flex-wrap items-center gap-x-3 gap-y-1.5 sm:mt-7"
        style={delay(180)}
      >
        <span
          className="block h-[9px] w-[9px] rounded-full"
          style={{ background: project.accent }}
          aria-hidden="true"
        />
        <span className="hor-body" style={{ color: "var(--hor-ink)" }}>
          {project.role}
        </span>
        <span className="hor-vrule" aria-hidden="true" />
        <span className="hor-body" style={{ color: "var(--hor-ink)" }}>
          {project.client}
        </span>
        <span className="hor-vrule" aria-hidden="true" />
        <span className="hor-body">{snapshot.identity.location}</span>
      </div>

      <p
        className="hor-lede hor-rise mt-7 max-w-[62ch] text-pretty"
        style={delay(230)}
      >
        {project.summary}
      </p>

      <div className="hor-rise mt-11 sm:mt-12" style={delay(290)}>
        <WorkArt project={project} index={index} size="wide" />
      </div>
    </header>
  );
}
