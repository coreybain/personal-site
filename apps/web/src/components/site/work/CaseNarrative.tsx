import type { CSSProperties } from "react";

import type { Project } from "@/lib/snapshot";

/**
 * Still sky. Prose belongs above the horizon — the deck is for readouts, and
 * two paragraphs of narrative set in mono against graph paper would be a lie
 * about what they are.
 *
 * Both chapters are optional on the snapshot type, so the section renders only
 * the ones that exist and drops out entirely when neither does.
 */

function delay(ms: number): CSSProperties {
  return { "--hor-delay": `${ms}ms` } as CSSProperties;
}

function Chapter({
  index,
  eyebrow,
  body,
  ms,
}: {
  index: string;
  eyebrow: string;
  body: string;
  ms: number;
}) {
  return (
    <section className="work-chapter hor-rise" style={delay(ms)}>
      <span className="hor-eyebrow">
        <span className="hor-mono">{index}</span>
        <span className="hor-tick" aria-hidden="true" />
        {eyebrow}
      </span>
      <p className="hor-lede mt-4 text-pretty">{body}</p>
    </section>
  );
}

export function CaseNarrative({ project }: { project: Project }) {
  if (!project.problem && !project.approach) return null;

  return (
    <div className="grid gap-10 pb-16 sm:gap-12 sm:pb-20 lg:grid-cols-2 lg:gap-14">
      {project.problem ? (
        <Chapter
          index="01"
          eyebrow="The problem"
          body={project.problem}
          ms={60}
        />
      ) : null}
      {project.approach ? (
        <Chapter
          index="02"
          eyebrow="The approach"
          body={project.approach}
          ms={120}
        />
      ) : null}
    </div>
  );
}
