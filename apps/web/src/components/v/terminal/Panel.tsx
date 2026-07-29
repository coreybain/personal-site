import type { CSSProperties, ReactNode } from "react";

type PanelProps = {
  /** Small uppercase instrument label in the panel chrome. */
  label?: string;
  /** Right-aligned readout in the panel chrome. */
  meta?: ReactNode;
  children: ReactNode;
  /** Set false when the child provides its own padding. */
  padded?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Entrance delay, ms. */
  delay?: number;
};

export function Panel({
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
      className={`obs-panel obs-rise ${className}`}
      style={{ ...style, ["--d" as string]: `${delay}ms` }}
    >
      {(label || meta) && (
        <header className="obs-panel-head">
          {label ? <h3 className="obs-label">{label}</h3> : <span />}
          {meta ? <div className="obs-label">{meta}</div> : null}
        </header>
      )}
      {padded ? <div className="obs-panel-body">{children}</div> : children}
    </section>
  );
}

type SectionHeadProps = {
  index: string;
  title: string;
  meta?: string;
};

export function SectionHead({ index, title, meta }: SectionHeadProps) {
  return (
    <div className="obs-sec-head">
      <span className="obs-sec-idx">{index}</span>
      <h2 className="obs-sec-title">{title}</h2>
      <span className="obs-sec-rule" aria-hidden="true" />
      {meta ? <span className="obs-sec-meta">{meta}</span> : null}
    </div>
  );
}

/** A labelled proportional bar. `pct` is 0–100. */
export function Meter({
  name,
  value,
  pct,
  hot = false,
  delay = 0,
}: {
  name: string;
  value: string;
  pct: number;
  hot?: boolean;
  delay?: number;
}) {
  return (
    <div className="obs-meter">
      <div className="obs-bar-row">
        <span className="obs-lang-name">{name}</span>
        <span className="obs-lang-pct">{value}</span>
      </div>
      <div className="obs-track">
        <span
          className="obs-fill"
          data-hot={hot ? "1" : "0"}
          style={{
            ["--w" as string]: `${pct}%`,
            ["--d" as string]: `${delay}ms`,
          }}
        />
      </div>
    </div>
  );
}
