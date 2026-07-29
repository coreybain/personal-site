import Link from "next/link";

import { snapshot } from "@/lib/snapshot";
import { longDate } from "./format";

const { identity, computedAt } = snapshot;

export function Colophon() {
  return (
    <footer className="ed-foot" id="contact">
      <div className="ed-wrap ed-foot-grid">
        <div>
          <p className="ed-caps" style={{ color: "var(--ed-ink-45)" }}>
            {identity.availability}
          </p>
          <p className="ed-foot-cta" style={{ marginTop: "0.9rem" }}>
            <a className="ed-link" href={`mailto:${identity.email}`}>
              {identity.email}
            </a>
          </p>
          <p className="ed-foot-links ed-caps">
            <a
              className="ed-link"
              href={`https://github.com/${identity.github}`}
              rel="noreferrer"
            >
              GitHub / {identity.github}
            </a>
            <span>{identity.location}</span>
            <Link className="ed-link" href="/">
              All variants
            </Link>
          </p>
        </div>

        <div className="ed-colophon ed-caps">
          <p>{identity.role}</p>
          <p>{identity.company}</p>
          <p>Set in Fraunces &amp; Archivo</p>
          <p>Figures computed {longDate(computedAt.slice(0, 10))}</p>
        </div>
      </div>
    </footer>
  );
}

export default Colophon;
