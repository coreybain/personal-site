import type { CSSProperties } from "react";
import Link from "next/link";

import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { snapshot } from "@/lib/snapshot";

import { stampTime } from "./format";

const { identity } = snapshot;

const NAV = [
  { href: "#signal", label: "Signal" },
  { href: "#work", label: "Work" },
  { href: "#ai", label: "AI" },
];

/**
 * Sticky top bar. Server-rendered apart from <ThemeToggle>, which is the only
 * interactive element on the page — it sits on the right of the bar, in an
 * instrument key that keeps a fixed 34px box in both themes so flipping the
 * theme cannot move a pixel.
 */
export function TopBar() {
  return (
    <div className="hor-bar">
      <div className="hor-shell hor-bar-inner">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="hor-mark" aria-hidden="true">
            CB
          </span>
          <span className="truncate text-[13px] font-medium tracking-[-0.014em]">
            {identity.name}
          </span>
          <span className="hor-vrule ml-1 hidden sm:block" aria-hidden="true" />
          <span className="hor-label hidden sm:block">Horizon</span>
        </div>

        <div className="flex items-center gap-4 sm:gap-6">
          <nav className="hor-nav" aria-label="Sections">
            {NAV.map((item) => (
              <a key={item.href} href={item.href} className="hor-link text-[13px]">
                {item.label}
              </a>
            ))}
          </nav>
          <a
            href={`mailto:${identity.email}`}
            className="hor-link hidden text-[13px] font-medium sm:block"
          >
            Email
          </a>
          <ThemeToggle className="hor-toggle" />
        </div>
      </div>
    </div>
  );
}

export function Footer() {
  return (
    <footer
      className="hor-rise pb-14 sm:pb-20"
      style={{ "--hor-delay": "760ms" } as CSSProperties}
    >
      <div className="hor-shell">
        <div className="hor-rule" />
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-8 pt-10 sm:pt-12">
          <div>
            <span className="hor-eyebrow">Get in touch</span>
            <a
              href={`mailto:${identity.email}`}
              className="hor-link hor-h3 mt-3.5 block"
            >
              {identity.email}
            </a>
            <p className="hor-micro mt-3">
              {identity.role} · {identity.company} · {identity.location}
            </p>
          </div>

          <div className="flex flex-col items-start gap-2.5 sm:items-end">
            <a
              href={`https://github.com/${identity.github}`}
              rel="noreferrer noopener"
              className="hor-link text-[13px] font-medium"
            >
              github.com/{identity.github}
            </a>
            <Link href="/" className="hor-link text-[13px]">
              All variants
            </Link>
            <span className="hor-label mt-1.5">
              Snapshot {stampTime(snapshot.computedAt)}
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
