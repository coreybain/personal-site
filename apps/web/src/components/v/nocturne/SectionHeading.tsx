import type { ReactNode } from "react";

/**
 * One heading shape for every section: index, rule, eyebrow / title / lede on
 * the left, an optional meta slot pinned to the right baseline.
 */
export function SectionHeading({
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
    <div className="mb-7 flex flex-wrap items-end justify-between gap-x-8 gap-y-4 sm:mb-9">
      <div className="max-w-[38ch]">
        <span className="noc-eyebrow flex items-center gap-2.5">
          <span className="noc-mono noc-accent">{index}</span>
          <span className="h-px w-6 bg-[var(--noc-hair)]" aria-hidden="true" />
          {eyebrow}
        </span>
        <h2 className="noc-h2 mt-3.5 text-balance">{title}</h2>
        {lede ? (
          <p className="noc-label mt-3 max-w-[44ch] text-pretty">{lede}</p>
        ) : null}
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </div>
  );
}
