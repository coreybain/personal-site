import type { CSSProperties, ReactNode } from "react";

/** Entrance delay as an inline custom property. */
export function delay(ms: number): CSSProperties {
  return { "--pri-delay": `${ms}ms` } as CSSProperties;
}

/**
 * The repeating section header: mono index, a 28px slice of the spectrum,
 * the eyebrow, then a large statement and an optional lede.
 */
export function SectionHead({
  index,
  eyebrow,
  title,
  lede,
  aside,
}: {
  index: string;
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="pri-sec-head">
      <div className="max-w-[34ch]">
        <div className="pri-sec-eyebrow">
          <span className="pri-eyebrow pri-mono">{index}</span>
          <span className="pri-sec-tick" aria-hidden="true" />
          <span className="pri-eyebrow">{eyebrow}</span>
        </div>
        <h2 className="pri-h2 mt-4 text-balance">{title}</h2>
        {lede ? (
          <p className="pri-sec-lede mt-3.5 max-w-[44ch] text-pretty">{lede}</p>
        ) : null}
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </div>
  );
}
