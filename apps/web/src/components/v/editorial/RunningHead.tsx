import { snapshot } from "@/lib/snapshot";
import { longDate } from "./format";

const { identity, computedAt } = snapshot;

/** The folio line that rides the top of every page of a printed magazine. */
export function RunningHead() {
  return (
    <header className="ed-head">
      <div className="ed-wrap ed-head-in ed-caps">
        <p className="ed-head-name">
          <span>{identity.name}</span>
          <span className="ed-head-sep" aria-hidden="true">
            §
          </span>
          <span className="ed-head-hide" style={{ color: "var(--ed-ink-45)" }}>
            {identity.role}
          </span>
        </p>
        <div className="ed-head-right">
          <span className="ed-head-hide" style={{ color: "var(--ed-ink-45)" }}>
            Figures to {longDate(computedAt.slice(0, 10))}
          </span>
          <a className="ed-link" href={`mailto:${identity.email}`}>
            Get in touch
          </a>
        </div>
      </div>
    </header>
  );
}

export default RunningHead;
