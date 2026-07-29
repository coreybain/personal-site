import type { Project } from "@/lib/snapshot";
import { snapshot } from "@/lib/snapshot";

import { SectionHeading } from "./SectionHeading";
import { delay } from "./format";

/**
 * Four procedural art treatments, cycled across the tiles. Each one is pure
 * CSS keyed off the project's `accentHue` — there are no image assets, and the
 * base gradient, blob lightness and overlay ink all come from theme tokens, so
 * the same tile reads as luminous glass on dark and soft pastel on light.
 */
const ART_VARIANTS = ["noc-art-0", "noc-art-1", "noc-art-2", "noc-art-3"] as const;

const COUNT_WORDS = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
] as const;

const projectCount =
  COUNT_WORDS[snapshot.projects.length] ?? String(snapshot.projects.length);

function ProjectCard({ project, index }: { project: Project; index: number }) {
  return (
    <article className="noc-card noc-lift noc-project p-2.5">
      <div
        className={`noc-art ${ART_VARIANTS[index % ART_VARIANTS.length]}`}
        style={{ "--noc-h": String(project.accentHue) } as React.CSSProperties}
        aria-hidden="true"
      >
        <div className="noc-art-base" />
        <div className="noc-art-overlay" />
        <div className="noc-art-veil" />
        <span className="noc-art-glyph">{project.title.charAt(0)}</span>
      </div>

      <div className="px-3 pt-5 pb-3 sm:px-3.5">
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="noc-h3">{project.title}</h3>
          <span className="noc-micro noc-mono">
            {String(index + 1).padStart(2, "0")}
          </span>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className="noc-swatch"
            style={{ background: project.accent }}
            aria-hidden="true"
          />
          <span className="noc-micro noc-dim">{project.client}</span>
          <span className="h-2.5 w-px bg-[var(--noc-hair)]" aria-hidden="true" />
          <span className="noc-micro">{project.role}</span>
        </div>

        <p className="noc-label mt-3.5 text-pretty">{project.summary}</p>

        <ul className="mt-4 flex flex-wrap gap-1.5">
          {project.stack.map((tech) => (
            <li key={tech} className="noc-chip">
              {tech}
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

export function FeaturedWork() {
  return (
    <section id="work" className="noc-rise scroll-mt-16" style={delay(480)}>
      <SectionHeading
        index="02"
        eyebrow="Featured work"
        title={`${projectCount} platforms carrying real load.`}
        lede="Principal engineer on each: the architecture, the delivery, and the teams around them."
        aside={
          <span className="noc-pill">
            <span
              className="noc-swatch"
              style={{ background: "var(--noc-accent)" }}
              aria-hidden="true"
            />
            {snapshot.identity.company}
          </span>
        }
      />

      <div className="grid gap-4 sm:gap-5 md:grid-cols-2">
        {snapshot.projects.map((project, i) => (
          <ProjectCard key={project.slug} project={project} index={i} />
        ))}
      </div>
    </section>
  );
}
