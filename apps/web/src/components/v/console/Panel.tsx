import type { CSSProperties, ReactNode } from "react";

/**
 * Panel — Console's instrument surface.
 *
 * Structurally it is Observatory's panel (small uppercase label on the left, a
 * mono readout on the right, a hairline, then the body) but the shell is a
 * product-dashboard card: 18px radius, layered shadow, no corner ticks.
 */
export function Panel({
  label,
  meta,
  children,
  padded = true,
  className = "",
  style,
}: {
  label?: string;
  meta?: ReactNode;
  children: ReactNode;
  /** Set false when the child supplies its own padding. */
  padded?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <section className={`con-panel ${className}`} style={style}>
      {(label || meta) && (
        <header className="con-panel-head">
          <div className="con-panel-head-title">
            {label ? <h3 className="con-label">{label}</h3> : <span />}
          </div>
          {meta ? <div className="con-panel-meta">{meta}</div> : null}
        </header>
      )}
      {padded ? <div className="con-panel-body">{children}</div> : children}
    </section>
  );
}

/** Numbered section rule: index · title · hairline · right-hand readout. */
export function SectionHead({
  index,
  title,
  meta,
}: {
  index: string;
  title: string;
  meta?: string;
}) {
  return (
    <div className="con-sec-head">
      <span className="con-sec-idx">{index}</span>
      <h2 className="con-sec-title">{title}</h2>
      <span className="con-sec-rule" aria-hidden="true" />
      {meta ? <span className="con-sec-meta">{meta}</span> : null}
    </div>
  );
}

/**
 * A labelled proportional bar. `pct` is 0–100 and is applied as a static width
 * — no growth animation, so the widget is at its final size on first paint.
 */
export function Meter({
  name,
  value,
  pct,
  hot = false,
}: {
  name: string;
  value: string;
  pct: number;
  hot?: boolean;
}) {
  return (
    <div className="con-meter">
      <div className="con-meter-head">
        <span className="con-meter-name">{name}</span>
        <span className="con-meter-val">{value}</span>
      </div>
      <div className="con-track">
        <span
          className="con-fill"
          data-hot={hot ? "1" : "0"}
          style={{ ["--w" as string]: `${pct}%` }}
        />
      </div>
    </div>
  );
}
