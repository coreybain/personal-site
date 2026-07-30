import { Rise } from "@/components/motion";

/**
 * The horizon itself — the deliberate seam between the calm sky zone and the
 * dense telemetry deck.
 *
 * Fixed height (`--hor-boundary-h`), so it can never reflow. The entry copy
 * carries a glow on dark and a soft drop shadow on light; the exit is the same
 * element reflected, with no chip, so the page surfaces quietly.
 *
 * The chip is the site's one motion-driven entrance (ADR 013) — see `<Rise>`
 * for why it is the chip and not the hero. It is `aria-hidden` decoration
 * inside a fixed-height band: it cannot shift layout, it is never the largest
 * paint, and if the feature chunk is slow it simply settles a beat after the CSS
 * entrances above it. `lift` is off because the stylesheet already centres the
 * chip with a `transform`, and motion's inline one would win.
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
        <Rise className="hor-boundary-chip" lift={false} delayMs={120}>
          <span className="hor-tick" />
          <span className="hor-label">{label}</span>
          <span className="hor-tick" />
        </Rise>
      ) : null}
    </div>
  );
}
