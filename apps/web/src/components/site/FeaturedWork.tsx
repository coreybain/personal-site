import Link from "next/link";
import type { CSSProperties } from "react";

import { countWord } from "@/lib/derive";
import type { Project } from "@/lib/snapshot";

import { SkyHead } from "./Panel";

/**
 * Sky zone again — the page has surfaced, so the tiles go back to rounded
 * glass and generous padding.
 *
 * There are no image assets, so the art is generated: two hue-derived radial
 * fields, one of four overlay textures, and — the motif that ties the whole
 * page together — a horizon line, at a different altitude on every tile.
 */

const ART_CLASS = ["hor-art-0", "hor-art-1", "hor-art-2", "hor-art-3"] as const;
const ART_HORIZON = ["58%", "70%", "46%", "64%"] as const;

function WorkCard({ project, index }: { project: Project; index: number }) {
  const titleId = `featured-work-${project.slug}-title`;

  return (
    <Link
      href={`/work/${project.slug}?from=home`}
      aria-labelledby={titleId}
      className="hor-card hor-lift hor-work-card hor-rise p-2.5"
      style={{ "--hor-delay": `${60 + index * 60}ms` } as CSSProperties}
    >
      <div
        className={`hor-art ${ART_CLASS[index % ART_CLASS.length]}`}
        style={
          {
            "--hor-h": String(project.accentHue),
            "--hor-y": ART_HORIZON[index % ART_HORIZON.length],
          } as CSSProperties
        }
        aria-hidden="true"
      >
        <div className="hor-art-base" />
        <div className="hor-art-overlay" />
        <div className="hor-art-line" />
        <div className="hor-art-veil" />
        <span className="hor-art-glyph">{project.title.charAt(0)}</span>
      </div>

      <div className="px-3 pt-5 pb-3 sm:px-3.5">
        <div className="flex items-baseline justify-between gap-4">
          <h3 id={titleId} className="hor-h3">
            {project.title}
          </h3>
          <span className="hor-label">{String(index + 1).padStart(2, "0")}</span>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <span
            className="block h-[7px] w-[7px] rounded-full"
            style={{ background: project.accent }}
            aria-hidden="true"
          />
          <span className="hor-micro" style={{ color: "var(--hor-ink)" }}>
            {project.client}
          </span>
          <span className="hor-vrule hor-vrule-sm" aria-hidden="true" />
          <span className="hor-micro">{project.role}</span>
        </div>

        <p className="hor-body mt-3.5 text-pretty">{project.summary}</p>

        <ul className="mt-4 flex flex-wrap gap-1.5">
          {project.stack.map((tech) => (
            <li key={tech} className="hor-chip">
              {tech}
            </li>
          ))}
        </ul>
      </div>
    </Link>
  );
}

/**
 * The tile grid, and the spelled-out count in the heading above it.
 *
 * `countWord` comes from `@/lib/derive` rather than a second copy of the word
 * list here — /work's intro prints the same sentence about the same array, and
 * two ladders of number words is one too many to keep in step.
 *
 * `projects[0].client` is safe: `getSiteData()` falls back to the mock for the
 * whole projects domain when Convex has none, so the array is never empty.
 */
export function FeaturedWork({ projects }: { projects: Project[] }) {
  const projectCount = countWord(projects.length);

  return (
    <section id="work" className="scroll-mt-20 pt-16 sm:pt-20 lg:pt-24">
      <SkyHead
        index="03"
        eyebrow="Featured work"
        title={`${projectCount} platforms carrying real load.`}
        lede={`Principal Engineer on each — architecture, delivery and the teams around them. All ${projectCount.toLowerCase()} for ${projects[0].client}.`}
        aside={
          <span className="hor-pill">
            <span
              className="block h-[7px] w-[7px] rounded-full"
              style={{ background: "var(--hor-accent)" }}
              aria-hidden="true"
            />
            Procedural artwork
          </span>
        }
      />

      <div className="grid gap-4 sm:gap-5 md:grid-cols-2">
        {projects.map((project, i) => (
          <WorkCard key={project.slug} project={project} index={i} />
        ))}
      </div>
    </section>
  );
}
