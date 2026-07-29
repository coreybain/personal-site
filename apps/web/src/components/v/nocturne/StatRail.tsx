/**
 * The instrument rail — the one repeating measurement shape on this page.
 *
 * Value, then label, then one line of provenance. Used three times (hero, git
 * card, AI card) so the eye learns the shape once and can scan every rail after
 * that without re-reading it.
 *
 * DOM order is `<dt>` before `<dd>`, which is what the HTML spec requires; the
 * visual order (value on top) is a CSS `order` swap in nocturne.css. Two
 * columns to 760px, four above it — the cell box is identical in both themes,
 * so toggling can never reflow it.
 */
export type RailCell = {
  value: string;
  unit?: string;
  label: string;
  sub: string;
};

export function StatRail({
  cells,
  className = "",
}: {
  cells: RailCell[];
  className?: string;
}) {
  return (
    <dl className={`noc-rail ${className}`.trim()}>
      {cells.map((cell) => (
        <div key={cell.label} className="noc-rail-cell">
          <dt className="noc-rail-term">
            <span className="noc-rail-label">{cell.label}</span>
            <span className="noc-micro noc-rail-sub">{cell.sub}</span>
          </dt>
          <dd className="noc-rail-value noc-stat-sm">
            {cell.value}
            {cell.unit ? (
              <span className="noc-micro font-normal">{cell.unit}</span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
