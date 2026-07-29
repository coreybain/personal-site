/**
 * The horizon itself — the deliberate seam between the calm sky zone and the
 * dense telemetry deck.
 *
 * Fixed height (`--hor-boundary-h`), so it can never reflow. The entry copy
 * carries a glow on dark and a soft drop shadow on light; the exit is the same
 * element reflected, with no chip, so the page surfaces quietly.
 */
export function Boundary({
  label,
  direction = "in",
}: {
  label?: string;
  direction?: "in" | "out";
}) {
  if (direction === "out") {
    return <div className="hor-boundary hor-boundary-out" aria-hidden="true" />;
  }

  return (
    <div className="hor-boundary hor-boundary-in" aria-hidden="true">
      {label ? (
        <div className="hor-boundary-chip">
          <span className="hor-tick" />
          <span className="hor-label">{label}</span>
          <span className="hor-tick" />
        </div>
      ) : null}
    </div>
  );
}
