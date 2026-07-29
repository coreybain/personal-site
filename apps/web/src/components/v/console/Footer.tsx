import Link from "next/link";

import type { Identity } from "@/lib/snapshot";

import { isoToClock } from "./format";

export function Footer({
  identity,
  computedAt,
}: {
  identity: Identity;
  computedAt: string;
}) {
  return (
    <footer className="con-footer">
      <div className="con-shell con-footer-inner">
        <div>
          <span className="con-label">{identity.availability}</span>
          <div>
            <a className="con-mail" href={`mailto:${identity.email}`}>
              {identity.email}
            </a>
          </div>
        </div>

        <div className="con-footer-end">
          <div className="con-flinks">
            <a
              className="con-flink"
              href={`https://github.com/${identity.github}`}
              rel="noreferrer noopener"
            >
              GitHub ↗
            </a>
            <a className="con-flink" href={`mailto:${identity.email}`}>
              Email ↗
            </a>
            <Link className="con-flink" href="/">
              Variants
            </Link>
          </div>
          <div className="con-label con-stamp">
            Snapshot computed {isoToClock(computedAt)}
          </div>
        </div>
      </div>
    </footer>
  );
}
