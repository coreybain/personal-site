import type { CSSProperties } from "react";

/**
 * Procedural cover art. There are no screenshots yet, so each tile gets a
 * hand-built abstract composition seeded off the project's `accentHue` — four
 * distinct printing gestures (rings, strata, mesh, rays) rather than four
 * recolours of the same gradient. Hues are pulled toward print ink: modest
 * saturation, multiply blending, so nothing fights the vermillion accent.
 */

type Layers = { base: CSSProperties; over: CSSProperties };

function build(hue: number, variant: number): Layers {
  const solid = `hsl(${hue} 46% 42%)`;
  const mid = `hsl(${hue} 40% 55%)`;
  const pale = `hsl(${hue} 34% 78%)`;
  const deep = `hsl(${hue} 50% 26%)`;

  switch (variant % 4) {
    /* Concentric rings — a struck seal, or a pressure map. */
    case 0:
      return {
        base: {
          background: `
            radial-gradient(circle at 32% 108%, ${pale} 0%, transparent 64%),
            linear-gradient(158deg, hsl(${hue} 22% 93%), hsl(${hue} 16% 86%))
          `,
        },
        over: {
          background: `
            repeating-radial-gradient(circle at 32% 108%, ${solid} 0 1.5px, transparent 1.5px 17px),
            repeating-linear-gradient(58deg, ${deep} 0 1px, transparent 1px 13px)
          `,
          opacity: 0.85,
        },
      };

    /* Plotted columns — bars of unequal height standing on a ruled ground. */
    case 1: {
      const bar = (c: string, left: string, w: string, h: string) =>
        `linear-gradient(${c}, ${c}) ${left} 100% / ${w} ${h} no-repeat`;

      return {
        base: {
          background: `
            linear-gradient(180deg, transparent 0 88%, hsl(${hue} 26% 80%) 88% 100%),
            repeating-linear-gradient(0deg, hsl(${hue} 24% 76% / 0.7) 0 1px, transparent 1px 22px),
            linear-gradient(180deg, hsl(${hue} 24% 95%), hsl(${hue} 18% 88%))
          `,
        },
        over: {
          background: `
            ${bar(deep, "8%", "7%", "34%")},
            ${bar(solid, "21%", "10%", "62%")},
            ${bar(mid, "36%", "6%", "45%")},
            ${bar(solid, "48%", "12%", "88%")},
            ${bar(deep, "65%", "5%", "28%")},
            ${bar(solid, "76%", "9%", "70%")},
            ${bar(mid, "90%", "6%", "51%")}
          `,
          opacity: 0.9,
        },
      };
    }

    /* Mesh + disc — a plotted graph with one solid mass on it. */
    case 2:
      return {
        base: {
          background: `
            radial-gradient(circle at 70% 34%, ${mid} 0 23%, transparent 23.4%),
            linear-gradient(200deg, hsl(${hue} 22% 94%), hsl(${hue} 16% 85%))
          `,
        },
        over: {
          background: `
            radial-gradient(circle at 70% 34%, transparent 0 22.6%, ${deep} 22.6% 23.4%, transparent 23.4%),
            repeating-linear-gradient(90deg, ${solid} 0 1px, transparent 1px 21px),
            repeating-linear-gradient(0deg, ${solid} 0 1px, transparent 1px 21px)
          `,
          opacity: 0.7,
        },
      };

    /* Ray fan + halftone — a burst, screened. */
    default:
      return {
        base: {
          background: `
            radial-gradient(circle at 14% 96%, ${pale} 0%, transparent 70%),
            linear-gradient(142deg, hsl(${hue} 22% 93%), hsl(${hue} 18% 86%))
          `,
        },
        over: {
          background: `
            repeating-conic-gradient(from 202deg at 14% 96%, hsl(${hue} 34% 46%) 0 2.6deg, transparent 2.6deg 10deg),
            radial-gradient(circle at center, ${deep} 0.6px, transparent 1.1px)
          `,
          backgroundSize: "auto, 7px 7px",
          opacity: 0.6,
        },
      };
  }
}

export function ProjectArt({
  hue,
  variant,
  index,
}: {
  hue: number;
  variant: number;
  index: string;
}) {
  const { base, over } = build(hue, variant);

  return (
    <div className="ed-art" aria-hidden="true">
      <div className="ed-art-layer" style={base} />
      <div className="ed-art-layer" style={over} />
      <span className="ed-art-index ed-caps ed-num">{index}</span>
    </div>
  );
}

export default ProjectArt;
