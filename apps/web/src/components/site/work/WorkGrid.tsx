import type { CSSProperties } from "react";
import Link from "next/link";

import { SkyHead } from "@/components/site/Panel";
import { countWord, pad2 } from "@/lib/derive";
import type { Project } from "@/lib/snapshot";

import { ArrowRight, Attribution, WorkArt } from "./WorkArt";

/**
 * Sky zone again — the page has surfaced, so the tiles go back to rounded
 * glass, generous padding and sans numerals.
 *
 * The first platform gets the full width and a letterbox band; the rest run
 * three across with taller art. Every tile is one link, and every tile carries
 * the client attribution — that line is contractual and never optional.
 *
 * Prop-fed: the list arrives from the page rather than from the mock module, in
 * the same display order `deriveWork().projectIndex` counts against, so the
 * `01` on a tile is the `01 / 04` on the case study it opens.
 */

/** Stack chips shown on a compact tile before the overflow chip takes over. */
const CHIP_LIMIT = 3;

function delay(ms: number): CSSProperties {
  return { "--hor-delay": `${ms}ms` } as CSSProperties;
}

function Chips({ stack, limit }: { stack: string[]; limit?: number }) {
  const shown = limit ? stack.slice(0, limit) : stack;
  const rest = stack.length - shown.length;

  return (
    <ul className="work-chips">
      {shown.map((tech) => (
        <li key={tech} className="hor-chip">
          {tech}
        </li>
      ))}
      {rest > 0 ? (
        <li className="hor-chip" aria-label={`and ${rest} more`}>
          +{rest}
        </li>
      ) : null}
    </ul>
  );
}

function FeatureTile({ project, index }: { project: Project; index: number }) {
  return (
    <Link
      href={`/work/${project.slug}`}
      className="hor-card hor-lift hor-work-card hor-rise work-tile p-2.5"
      style={delay(60)}
    >
      <WorkArt project={project} index={index} size="wide" />

      <div className="grid gap-x-12 gap-y-6 px-3 pt-6 pb-3 sm:px-4 sm:pt-7 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-start">
        <div>
          <div className="flex items-center gap-3">
            <span className="hor-label">{pad2(index + 1)}</span>
            <span className="hor-vrule hor-vrule-sm" aria-hidden="true" />
            <span className="hor-label">Lead platform</span>
          </div>
          <h3 className="hor-h2 mt-3.5 text-balance">{project.title}</h3>
          <Attribution project={project} className="mt-3.5" />
        </div>

        <div>
          <p className="hor-lede text-pretty">{project.summary}</p>
          <div className="mt-5">
            <Chips stack={project.stack} />
          </div>
          <span className="work-cta mt-5 inline-flex">
            Read the case study
            <ArrowRight />
          </span>
        </div>
      </div>
    </Link>
  );
}

function WorkTile({ project, index }: { project: Project; index: number }) {
  return (
    <Link
      href={`/work/${project.slug}`}
      className="hor-card hor-lift hor-work-card hor-rise work-tile flex flex-col p-2.5"
      style={delay(120 + index * 60)}
    >
      <WorkArt project={project} index={index} size="tile" />

      <div className="flex flex-1 flex-col px-2.5 pt-5 pb-2.5 sm:px-3">
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="hor-h3">{project.title}</h3>
          <span className="hor-label">{pad2(index + 1)}</span>
        </div>

        <Attribution project={project} className="mt-2.5" />

        <p className="hor-body work-clamp mt-3.5 text-pretty">
          {project.summary}
        </p>

        <div className="mt-4">
          <Chips stack={project.stack} limit={CHIP_LIMIT} />
        </div>

        <span className="work-cta mt-5 inline-flex self-start">
          Case study
          <ArrowRight />
        </span>
      </div>
    </Link>
  );
}

export function WorkGrid({ projects }: { projects: Project[] }) {
  const [lead, ...rest] = projects;

  // The live published collection may be empty. The guard prevents a blank lead
  // tile; the page's intro and counters still render the honest zero state.
  if (!lead) return null;

  return (
    <section className="pt-16 pb-16 sm:pt-20 sm:pb-20 lg:pt-24">
      <SkyHead
        index="03"
        eyebrow="Case studies"
        title="Every platform has a page."
        lede="What was broken, how it was rebuilt, and the outcomes that were actually measured afterwards."
        aside={
          <span className="hor-pill">
            <span
              className="block h-[7px] w-[7px] rounded-full"
              style={{ background: "var(--hor-accent)" }}
              aria-hidden="true"
            />
            {countWord(projects.length)} case studies
          </span>
        }
      />

      <div className="grid gap-4 sm:gap-5">
        <FeatureTile project={lead} index={0} />

        <div className="grid gap-4 sm:gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {rest.map((project, i) => (
            <WorkTile key={project.slug} project={project} index={i + 1} />
          ))}
        </div>
      </div>
    </section>
  );
}
