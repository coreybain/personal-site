import type { FunEntry } from "@/lib/snapshot";
import { daysAgoLabel, group } from "./format";

const INK = "#0b0b0b";
const RED = "#ff2d00";

function Mark({ type }: { type: FunEntry["type"] }) {
  return (
    <svg
      className="block h-full w-full"
      viewBox="0 0 200 160"
      aria-hidden="true"
      focusable="false"
    >
      {type === "beer" ? (
        <>
          <polygon points="78,56 126,56 120,134 84,134" fill={RED} />
          <polygon
            points="72,28 132,28 122,136 82,136"
            fill="none"
            stroke={INK}
            strokeWidth="6"
          />
          <path
            d="M132 52 H158 V104 H132"
            fill="none"
            stroke={INK}
            strokeWidth="6"
          />
          <rect x="74" y="54" width="56" height="6" fill={INK} />
        </>
      ) : null}

      {type === "coffee" ? (
        <>
          <circle cx="100" cy="80" r="30" fill={RED} />
          <circle
            cx="100"
            cy="80"
            r="46"
            fill="none"
            stroke={INK}
            strokeWidth="6"
          />
          <rect x="38" y="134" width="124" height="6" fill={INK} />
          <rect x="84" y="14" width="6" height="20" fill={INK} />
          <rect x="110" y="8" width="6" height="26" fill={INK} />
        </>
      ) : null}

      {type === "walk" ? (
        <>
          <path
            d="M28 116 L64 74 L100 96 L136 46 L170 62"
            fill="none"
            stroke={INK}
            strokeWidth="8"
            strokeLinecap="butt"
            strokeLinejoin="miter"
          />
          <circle cx="170" cy="62" r="11" fill={RED} />
          <rect x="20" y="134" width="160" height="6" fill={INK} />
        </>
      ) : null}
    </svg>
  );
}

export function LifeCard({ entry }: { entry: FunEntry }) {
  const detail =
    entry.type === "walk"
      ? `${group(entry.steps)} steps · ${entry.km} km`
      : entry.note;

  return (
    <figure className="border-t border-[var(--sw-ink)] pt-4">
      <div className="aspect-[5/4] w-full border border-[var(--sw-hair-strong)] bg-white">
        <Mark type={entry.type} />
      </div>
      <figcaption className="mt-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="sw-mono sw-red">{entry.type}</span>
          <span className="sw-mono sw-mute">{daysAgoLabel(entry.daysAgo)}</span>
        </div>
        <p className="sw-body mt-2 font-medium">{entry.title}</p>
        <p className="sw-mono sw-mute mt-1.5">{detail}</p>
      </figcaption>
    </figure>
  );
}
