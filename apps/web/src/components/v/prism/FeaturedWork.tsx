import type { CSSProperties } from "react";

import type { Project } from "@/lib/snapshot";
import { snapshot } from "@/lib/snapshot";

import { SectionHead, delay } from "./SectionHead";

const ART_VARIANTS = ["pri-art-0", "pri-art-1", "pri-art-2", "pri-art-3"] as const;

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
    <article
      className="pri-card pri-lift pri-project p-2.5"
      // The hue rides on the card so the art AND the client dot inherit it;
      // each composes it with the current theme's saturation/lightness.
      style={{ "--pri-h": String(project.accentHue) } as CSSProperties}
    >
      {/* No image assets exist: the art is generated from the project's own
          hue, wrapped in the shared spectrum edge so the four tiles read as a
          set rather than four unrelated swatches. */}
      <div
        className={`pri-art ${ART_VARIANTS[index % ART_VARIANTS.length]}`}
        aria-hidden="true"
      >
        <div className="pri-art-field" />
        <div className="pri-art-weave" />
        <div className="pri-art-veil" />
        <span className="pri-art-glyph">{project.title.charAt(0)}</span>
      </div>

      <div className="px-3 pt-5 pb-3.5 sm:px-4">
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="pri-h3">{project.title}</h3>
          <span className="pri-micro pri-mono">
            {String(index + 1).padStart(2, "0")}
          </span>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span
            className="pri-proj-dot block h-[7px] w-[7px] rounded-full"
            aria-hidden="true"
          />
          <span className="pri-micro pri-ink-2">{project.client}</span>
          <span className="pri-meta-sep" aria-hidden="true" />
          <span className="pri-micro">{project.role}</span>
        </div>

        <p className="pri-label mt-3.5 text-pretty">{project.summary}</p>

        <ul className="mt-4 flex flex-wrap gap-1.5">
          {project.stack.map((tech) => (
            <li key={tech} className="pri-chip">
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
    <section id="work" className="pri-shell pri-rise scroll-mt-8" style={delay(480)}>
      <SectionHead
        index="02"
        eyebrow="Featured work"
        title={`${projectCount} platforms carrying real load.`}
        lede="Principal Engineer on each: the architecture, the delivery, and the teams around them."
        aside={
          <span className="pri-pill">
            <span
              className="block h-[7px] w-[7px] rounded-full"
              style={{ backgroundImage: "var(--pri-grad-x)" }}
              aria-hidden="true"
            />
            Artwork generated from each project&rsquo;s hue
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
