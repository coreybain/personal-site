import type { LanguageShare } from "@/lib/snapshot";

/* One black, one accent, three neutrals — the palette holds. */
const SWATCHES = ["#0b0b0b", "#ff2d00", "#8a8a8a", "#bfbfbf", "#e2e2e2"];

export function LanguageBar({ languages }: { languages: LanguageShare[] }) {
  return (
    <div>
      <div className="sw-langbar">
        {languages.map((lang, i) => (
          <span
            key={lang.name}
            style={{
              width: `${lang.pct}%`,
              background: SWATCHES[i % SWATCHES.length],
            }}
          />
        ))}
      </div>

      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-5">
        {languages.map((lang, i) => (
          <li
            key={lang.name}
            className="flex items-center gap-2 border-t border-[var(--sw-hair)] pt-2"
          >
            <span
              className="sw-swatch shrink-0"
              style={{ background: SWATCHES[i % SWATCHES.length] }}
            />
            <span className="sw-mono truncate">{lang.name}</span>
            <span className="sw-mono sw-mute ml-auto tabular-nums">
              {lang.pct}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
