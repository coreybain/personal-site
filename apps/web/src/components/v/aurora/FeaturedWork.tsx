import type { Project } from "@/lib/snapshot";
import { snapshot } from "@/lib/snapshot";

import styles from "./aurora.module.css";
import { SectionHeading } from "./SectionHeading";

const ART_VARIANTS = [styles.art0, styles.art1, styles.art2, styles.art3] as const;

/** Spelled-out count for the section title, with a digit fallback past ten. */
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
    <article className={`${styles.card} ${styles.lift} ${styles.projectCard} p-2.5`}>
      <div
        className={`${styles.art} ${ART_VARIANTS[index % ART_VARIANTS.length]}`}
        style={{ "--aur-h": String(project.accentHue) } as React.CSSProperties}
        aria-hidden="true"
      >
        <div className={styles.artBase} />
        <div className={styles.artOverlay} />
        <div className={styles.artVignette} />
        <span className={styles.artGlyph}>{project.title.charAt(0)}</span>
      </div>

      <div className="px-3 pt-5 pb-3 sm:px-3.5">
        <div className="flex items-baseline justify-between gap-4">
          <h3 className={styles.h3}>{project.title}</h3>
          <span className={`${styles.micro} ${styles.mono}`}>
            {String(index + 1).padStart(2, "0")}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className="block h-[7px] w-[7px] rounded-full"
            style={{ background: project.accent }}
            aria-hidden="true"
          />
          <span className={styles.micro} style={{ color: "var(--aur-ink-2)" }}>
            {project.client}
          </span>
          <span className="h-2.5 w-px bg-[var(--aur-hairline)]" aria-hidden="true" />
          <span className={styles.micro}>{project.role}</span>
        </div>

        <p className={`${styles.label} mt-3.5 text-pretty`}>{project.summary}</p>

        <ul className="mt-4 flex flex-wrap gap-1.5">
          {project.stack.map((tech) => (
            <li key={tech} className={styles.chip}>
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
    <section
      id="work"
      className={`${styles.rise} scroll-mt-16`}
      style={{ "--aur-delay": "460ms" } as React.CSSProperties}
    >
      <SectionHeading
        index="02"
        eyebrow="Featured work"
        title={`${projectCount} platforms carrying real load.`}
        lede="Principal engineer on each: architecture, delivery and the teams around them."
        aside={
          <span className={styles.pill}>
            <span
              className="block h-[7px] w-[7px] rounded-full"
              style={{ background: "var(--aur-accent-soft)" }}
              aria-hidden="true"
            />
            Procedural artwork
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
