import type { CSSProperties, ReactNode } from "react";

/**
 * Deck primitives — the instrument styling that lives below the horizon.
 *
 * These deliberately do NOT appear above the horizon: the sky zone uses
 * `.hor-card` (rounded, glassy, sans numerals) instead. The material change is
 * the whole point of the variant.
 */

type PanelProps = {
  /** Optional fragment target for deep links into a panel. */
  id?: string;
  /** Small mono instrument label in the panel chrome. */
  label?: string;
  /** Right-aligned readout in the panel chrome. */
  meta?: ReactNode;
  children: ReactNode;
  /** Set false when the child brings its own padding. */
  padded?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Entrance delay, ms. */
  delay?: number;
};

export function Panel({
  id,
  label,
  meta,
  children,
  padded = true,
  className = "",
  style,
  delay = 0,
}: PanelProps) {
  return (
    <section
      id={id}
      className={`hor-panel hor-rise ${className}`}
      style={{ ...style, "--hor-delay": `${delay}ms` } as CSSProperties}
    >
      {label || meta ? (
        <header className="hor-panel-head">
          {label ? <h3 className="hor-label">{label}</h3> : <span />}
          {meta ? <div className="hor-label">{meta}</div> : null}
        </header>
      ) : null}
      {padded ? <div className="hor-panel-body">{children}</div> : children}
    </section>
  );
}

/** Deck section head: index · title · rule · meta. */
export function DeckHead({
  index,
  title,
  meta,
}: {
  index: string;
  title: string;
  meta?: string;
}) {
  return (
    <div className="hor-sec-head">
      <span className="hor-sec-idx">{index}</span>
      <h2 className="hor-sec-title">{title}</h2>
      <span className="hor-sec-rule" aria-hidden="true" />
      {meta ? <span className="hor-sec-meta">{meta}</span> : null}
    </div>
  );
}

/** Sky section head: eyebrow, display line, optional lede and aside. */
export function SkyHead({
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
        <span className="hor-eyebrow">
          <span className="hor-mono">{index}</span>
          <span className="hor-tick" aria-hidden="true" />
          {eyebrow}
        </span>
        <h2 className="hor-h2 mt-3.5 text-balance">{title}</h2>
        {lede ? <p className="hor-body mt-3 max-w-[44ch] text-pretty">{lede}</p> : null}
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </div>
  );
}

/** A labelled proportional bar. `value` is already formatted; `share` is 0–100. */
export function Meter({
  name,
  value,
  share,
  hot = false,
  delay = 0,
}: {
  name: string;
  value: string;
  share: number;
  hot?: boolean;
  delay?: number;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="hor-body" style={{ color: "var(--hor-ink)" }}>
          {name}
        </span>
        <span className="hor-mono hor-micro" style={{ color: "var(--hor-ink-2)" }}>
          {value}
        </span>
      </div>
      <div className="hor-track mt-2">
        <span
          className="hor-fill"
          data-hot={hot ? "1" : "0"}
          style={{ width: `${share}%`, "--hor-delay": `${delay}ms` } as CSSProperties}
        />
      </div>
    </div>
  );
}
