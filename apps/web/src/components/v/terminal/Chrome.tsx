import Link from "next/link";
import type { Identity } from "@/lib/snapshot";
import { isoToClock } from "./format";

export function TopBar({ computedAt }: { computedAt: string }) {
  return (
    <nav className="obs-bar">
      <div className="obs-shell obs-bar-inner">
        <div className="obs-bar-mark">
          <span className="obs-dot" aria-hidden="true" />
          <span>Observatory</span>
        </div>

        <div className="obs-bar-mid">
          <span>Snapshot</span>
          <span style={{ color: "var(--obs-faint)" }}>
            {isoToClock(computedAt)}
          </span>
        </div>

        <Link href="/" className="obs-back">
          ← All variants
        </Link>
      </div>
    </nav>
  );
}

export function Footer({
  identity,
  computedAt,
}: {
  identity: Identity;
  computedAt: string;
}) {
  return (
    <footer className="obs-footer">
      <div className="obs-shell obs-footer-inner">
        <div>
          <span className="obs-label">{identity.availability}</span>
          <div style={{ marginTop: "0.9rem" }}>
            <a className="obs-mail" href={`mailto:${identity.email}`}>
              {identity.email}
            </a>
          </div>
        </div>

        <div className="obs-footer-end">
          <div className="obs-flinks">
            <a
              className="obs-flink"
              href={`https://github.com/${identity.github}`}
              rel="noreferrer noopener"
            >
              GitHub ↗
            </a>
            <a className="obs-flink" href={`mailto:${identity.email}`}>
              Email ↗
            </a>
            <Link className="obs-flink" href="/">
              Variants
            </Link>
          </div>
          <div
            className="obs-label"
            style={{ marginTop: "0.85rem", color: "var(--obs-ghost)" }}
          >
            Snapshot computed {isoToClock(computedAt)} ·{" "}
            {identity.name.toUpperCase()}
          </div>
        </div>
      </div>
    </footer>
  );
}
