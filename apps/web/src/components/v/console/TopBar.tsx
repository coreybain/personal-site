import Link from "next/link";

import { ThemeToggle } from "@/components/theme/ThemeToggle";
import type { Identity } from "@/lib/snapshot";

import { isoToClock } from "./format";

/**
 * Sticky console chrome: identity on the left, the live snapshot readout in the
 * middle, navigation and the theme toggle on the right.
 *
 * Server component — the only client code it renders is <ThemeToggle>, which
 * must sit inside the <ThemeScope> the page wraps everything in.
 */
export function TopBar({
  identity,
  computedAt,
}: {
  identity: Identity;
  computedAt: string;
}) {
  return (
    <nav className="con-bar">
      <div className="con-shell con-bar-inner">
        <div className="con-mark">
          <span className="con-mark-badge" aria-hidden="true">
            CB
          </span>
          <span className="con-mark-name">{identity.name}</span>
          <span className="con-mark-sep" aria-hidden="true" />
          <span className="con-mark-slug">console</span>
        </div>

        <div className="con-bar-live">
          <span className="con-dot con-dot-pulse" aria-hidden="true" />
          <span className="con-label">Live</span>
          <span className="con-panel-meta">{isoToClock(computedAt)}</span>
        </div>

        <div className="con-bar-actions">
          <Link href="/" className="con-barlink">
            All variants
          </Link>
          <ThemeToggle className="con-toggle" />
        </div>
      </div>
    </nav>
  );
}
