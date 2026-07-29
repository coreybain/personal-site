import type { Project } from "@/lib/snapshot";
import { SectionHead } from "./Panel";

/**
 * No screenshots exist yet. Each card's art is generated in CSS from the
 * project's own `accentHue` (see `.obs-art[data-art]` in observatory.css) so the
 * four tiles read as one instrument family rather than four stock images.
 */
export function FeaturedWork({ projects }: { projects: Project[] }) {
  return (
    <section className="obs-sec obs-shell">
      <SectionHead
        index="02"
        title="Featured work"
        meta={`${projects.length} platforms · principal engineer`}
      />

      <div className="obs-work">
        {projects.map((p, i) => (
          <article
            key={p.slug}
            className="obs-panel obs-card obs-rise"
            style={{
              ["--h" as string]: p.accentHue,
              ["--d" as string]: `${i * 90}ms`,
            }}
          >
            <div className="obs-art" data-art={i} aria-hidden="true">
              <span className="obs-art-idx">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="obs-art-tag">{p.slug}</span>
            </div>

            <div className="obs-card-body">
              <h3 className="obs-card-title">
                {p.title}
                <span
                  className="obs-legend-sw"
                  aria-hidden="true"
                  style={{
                    background: p.accent,
                    boxShadow: `0 0 8px ${p.accent}`,
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                  }}
                />
              </h3>

              <div className="obs-card-meta">
                <span className="obs-label">{p.client}</span>
                <span className="obs-dotsep" aria-hidden="true" />
                <span className="obs-label">{p.role}</span>
              </div>

              <p className="obs-card-sum">{p.summary}</p>

              <div className="obs-stack">
                {p.stack.map((s) => (
                  <span key={s} className="obs-chip">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
