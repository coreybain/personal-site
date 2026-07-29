import type { ReactNode } from "react";

type SectionHeaderProps = {
  /** Two-digit folio number, e.g. `"01"`. */
  index: string;
  label: string;
  /** Right-aligned dateline / provenance. Hidden below 34rem. */
  meta?: string;
  /** The section's argument, set as a display-serif pull line. */
  thesis?: ReactNode;
};

/**
 * The one section-opening pattern used four times: rule, folio line, thesis.
 * Repeating it exactly is what makes the page read as a single publication.
 */
export function SectionHeader({ index, label, meta, thesis }: SectionHeaderProps) {
  return (
    <header className="ed-sec">
      <div className="ed-sec-line ed-caps">
        <span className="ed-sec-num ed-num">{index}</span>
        <h2 className="ed-sec-label">{label}</h2>
        {meta ? <span className="ed-sec-meta">{meta}</span> : null}
      </div>
      {thesis ? <p className="ed-thesis ed-rise">{thesis}</p> : null}
    </header>
  );
}

export default SectionHeader;
