import type { FunEntry } from "@/lib/snapshot";
import { SectionHead } from "./Panel";
import { daysAgoLabel, group } from "./format";

const HUE: Record<FunEntry["type"], number> = {
  beer: 40,
  coffee: 22,
  walk: 168,
};

const KIND: Record<FunEntry["type"], string> = {
  beer: "Beer",
  coffee: "Coffee",
  walk: "Walk",
};

function Glyph({ type }: { type: FunEntry["type"] }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "rgba(255,255,255,0.72)",
    strokeWidth: 1.3,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  if (type === "beer") {
    return (
      <svg {...common} aria-hidden="true">
        <path d="M7 8h9v11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V8Z" />
        <path d="M16 10h2a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2" />
        <path d="M7 8c0-2.2 1.6-3.5 3-3.2C10.6 3.2 13.4 3 14.4 4.6 15.7 4.4 16.4 6.2 16 8" />
      </svg>
    );
  }
  if (type === "coffee") {
    return (
      <svg {...common} aria-hidden="true">
        <path d="M4 9h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9Z" />
        <path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H17" />
        <path d="M8 3v2.5M12 3v2.5" />
      </svg>
    );
  }
  return (
    <svg {...common} aria-hidden="true">
      <circle cx="14" cy="4.6" r="1.8" />
      <path d="M12.4 21l1.3-5.2-2.9-2.4.9-4.6-3.3 1.5-1.1 3" />
      <path d="M13.7 15.8 17 19.4M11.7 8.8l3.1 1.2 2.4-.7" />
    </svg>
  );
}

export function LifeStrip({ entries }: { entries: FunEntry[] }) {
  return (
    <section className="obs-sec obs-shell">
      <SectionHead index="04" title="Off duty" meta="Because there is a person here" />

      <div className="obs-life">
        {entries.map((e, i) => (
          <div
            key={`${e.type}-${i}`}
            className="obs-panel obs-life-card obs-rise"
            style={{
              ["--h" as string]: HUE[e.type],
              ["--d" as string]: `${i * 80}ms`,
            }}
          >
            <div className="obs-life-photo">
              <Glyph type={e.type} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="obs-label" style={{ marginBottom: 5 }}>
                {KIND[e.type]} · {daysAgoLabel(e.daysAgo)}
              </div>
              <div className="obs-life-title">{e.title}</div>
              <div
                className="obs-label"
                style={{ marginTop: 5, letterSpacing: "0.06em" }}
              >
                {e.type === "walk"
                  ? `${e.km} km · ${group(e.steps)} steps`
                  : e.note}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
