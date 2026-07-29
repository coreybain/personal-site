import type { CSSProperties } from "react";

import type { Project } from "@/lib/snapshot";

/**
 * The homepage's procedural tile art, re-proportioned for this page.
 *
 * There are no image assets anywhere on this site, so a project's picture is
 * generated from its own hue: two radial fields, one of four overlay textures,
 * and the motif that ties every page together — a horizon line, sitting at a
 * different altitude on every project.
 *
 * The block classes (`hor-art*`) are the shared ones from horizon.css so the
 * material is identical to the homepage; only the aspect ratio and the glyph
 * size change, and those live in work.css.
 */

const ART_CLASS = ["hor-art-0", "hor-art-1", "hor-art-2", "hor-art-3"] as const;

/** Altitudes rise across the set, so the four tiles read as a sequence. */
const ART_HORIZON = ["68%", "60%", "52%", "44%"] as const;

export type ArtSize = "wide" | "tile" | "mini";

export function WorkArt({
  project,
  index,
  size = "tile",
  className = "",
}: {
  project: Project;
  index: number;
  size?: ArtSize;
  className?: string;
}) {
  return (
    <div
      className={`hor-art work-art-${size} ${
        ART_CLASS[index % ART_CLASS.length]
      } ${className}`}
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
  );
}

/**
 * Client and role, on every card and at the head of every case study.
 *
 * This attribution is contractual, not decoration: the client name is set in
 * full ink, never dimmed, and it is never truncated or collapsed behind a
 * breakpoint.
 */
export function Attribution({
  project,
  className = "",
}: {
  project: Project;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-2.5 gap-y-1.5 ${className}`}
    >
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
  );
}

export function ArrowRight() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path
        d="M2.6 6.5h7.8M7.2 3.3l3.2 3.2-3.2 3.2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ArrowLeft() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path
        d="M10.4 6.5H2.6M5.8 3.3L2.6 6.5l3.2 3.2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
