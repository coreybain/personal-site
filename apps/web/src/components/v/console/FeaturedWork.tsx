import type { Project } from "@/lib/snapshot";

import { Panel, SectionHead } from "./Panel";
import { pad2 } from "./format";

/**
 * Four case-study tiles.
 *
 * No screenshots exist yet, so each tile's art is generated in CSS from that
 * project's own `accentHue` (see `.con-art[data-art]` in console.css). The four
 * patterns are drawn from what the platform actually does — ruled pages, route
 * contours, a control graph, closing bid ticks — so the set reads as one
 * instrument family rather than four stock images.
 */
export function FeaturedWork({ projects }: { projects: Project[] }) {
  return (
    <section className="con-sec con-shell">
      <SectionHead
        index="02"
        title="Featured work"
        meta={`${projects.length} platforms · principal engineer`}
      />

      <div className="con-work">
        {projects.map((p, i) => (
          <Panel
            key={p.slug}
            className="con-card"
            padded={false}
            style={{ ["--h" as string]: p.accentHue }}
          >
            <div className="con-art" data-art={i} aria-hidden="true">
              <span className="con-art-idx">{pad2(i + 1)}</span>
              <span className="con-art-tag">{p.slug}</span>
            </div>

            <div className="con-card-body">
              <h3 className="con-card-title">
                {p.title}
                <span className="con-card-swatch" aria-hidden="true" />
              </h3>

              <div className="con-card-meta">
                <span className="con-label">{p.client}</span>
                <span className="con-sep" aria-hidden="true" />
                <span className="con-label">{p.role}</span>
              </div>

              <p className="con-card-sum">{p.summary}</p>

              <div className="con-stack">
                {p.stack.map((s) => (
                  <span key={s} className="con-chip">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          </Panel>
        ))}
      </div>
    </section>
  );
}
