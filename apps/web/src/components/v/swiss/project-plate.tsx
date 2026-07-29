/**
 * Procedural placeholder art. No screenshots exist yet, so each project gets a
 * flat constructivist plate built from primitives, keyed to its accent hue.
 * Black, white and exactly one hue per plate — no gradients, no radii.
 */

const INK = "#0b0b0b";

export function ProjectPlate({ index, hue }: { index: number; hue: number }) {
  const accent = `hsl(${hue} 86% 52%)`;

  return (
    <svg
      className="sw-plate"
      viewBox="0 0 400 300"
      aria-hidden="true"
      focusable="false"
    >
      {index === 0 ? <PlateDocument accent={accent} /> : null}
      {index === 1 ? <PlateRoute accent={accent} /> : null}
      {index === 2 ? <PlateRings accent={accent} /> : null}
      {index === 3 ? <PlateBids accent={accent} /> : null}
    </svg>
  );
}

/* 01 — composition: solid field + measured rule stack. */
function PlateDocument({ accent }: { accent: string }) {
  const bars = [200, 164, 124, 188, 88];
  return (
    <>
      <rect x="0" y="0" width="148" height="300" fill={accent} />
      {bars.map((w, i) => (
        <rect
          key={i}
          x="176"
          y={48 + i * 36}
          width={w}
          height="16"
          fill={INK}
        />
      ))}
      <rect x="176" y="24" width="16" height="16" fill={INK} />
      <rect x="352" y="252" width="24" height="24" fill={INK} />
    </>
  );
}

/* 02 — composition: diagonal mass, disc, single slicing rule. */
function PlateRoute({ accent }: { accent: string }) {
  return (
    <>
      <polygon points="0,300 0,138 268,300" fill={INK} />
      <circle cx="284" cy="98" r="72" fill={accent} />
      <rect x="0" y="148" width="400" height="6" fill={INK} />
      <rect x="24" y="24" width="72" height="6" fill={INK} />
    </>
  );
}

/* 03 — composition: concentric rings, one carrying the hue. */
function PlateRings({ accent }: { accent: string }) {
  return (
    <>
      <circle
        cx="200"
        cy="150"
        r="134"
        fill="none"
        stroke={INK}
        strokeWidth="12"
      />
      <circle
        cx="200"
        cy="150"
        r="102"
        fill="none"
        stroke={accent}
        strokeWidth="12"
      />
      <circle
        cx="200"
        cy="150"
        r="70"
        fill="none"
        stroke={INK}
        strokeWidth="12"
      />
      <circle cx="200" cy="150" r="38" fill={accent} />
      <rect x="0" y="147" width="52" height="6" fill={INK} />
      <rect x="348" y="147" width="52" height="6" fill={INK} />
    </>
  );
}

/* 04 — composition: ascending column series, terminal column in hue. */
function PlateBids({ accent }: { accent: string }) {
  const heights = [28, 44, 58, 80, 96, 124, 152, 190, 232];
  return (
    <>
      {heights.map((h, i) => (
        <rect
          key={i}
          x={18 + i * 42}
          y={268 - h}
          width="28"
          height={h}
          fill={i === heights.length - 1 ? accent : INK}
        />
      ))}
      <rect x="0" y="272" width="400" height="4" fill={INK} />
    </>
  );
}
