import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";

import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { snapshot } from "@/lib/snapshot";

import { stampTime } from "./format";

const { identity } = snapshot;

/* 20×20 line icons, 1.6px stroke — the pill speaks in glyphs, so every item
   carries its name as an aria-label and a hover/focus tooltip. */
const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const NAV: { href: string; label: string; icon: ReactNode }[] = [
  {
    href: "#",
    label: "Top",
    icon: (
      <svg width="18" height="18" viewBox="0 0 20 20" {...STROKE}>
        <path d="M3.6 8.6L10 3.2l6.4 5.4" />
        <path d="M5.4 7.4v8.4a1 1 0 001 1h7.2a1 1 0 001-1V7.4" />
      </svg>
    ),
  },
  {
    href: "#signal",
    label: "Signal",
    icon: (
      <svg width="18" height="18" viewBox="0 0 20 20" {...STROKE}>
        <path d="M2.6 10.6h3.1l2-4.9 3.7 8.6 2-3.7h4" />
      </svg>
    ),
  },
  {
    href: "#work",
    label: "Work",
    icon: (
      <svg width="18" height="18" viewBox="0 0 20 20" {...STROKE}>
        <rect x="3" y="6.3" width="14" height="9.5" rx="1.8" />
        <path d="M7.4 6V5a1.6 1.6 0 011.6-1.6h2A1.6 1.6 0 0112.6 5v1M3 10.5h14" />
      </svg>
    ),
  },
  {
    href: "#ai",
    label: "AI",
    icon: (
      <svg width="18" height="18" viewBox="0 0 20 20" {...STROKE}>
        <path d="M8.4 3.6l1.2 3.2a1 1 0 00.6.6l3.2 1.2-3.2 1.2a1 1 0 00-.6.6l-1.2 3.2-1.2-3.2a1 1 0 00-.6-.6L3.4 8.6l3.2-1.2a1 1 0 00.6-.6z" />
        <path d="M15 12.6l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5z" />
      </svg>
    ),
  },
  {
    href: `mailto:${identity.email}`,
    label: "Email",
    icon: (
      <svg width="18" height="18" viewBox="0 0 20 20" {...STROKE}>
        <rect x="2.8" y="4.6" width="14.4" height="10.8" rx="2" />
        <path d="M3.4 6.2L10 11l6.6-4.8" />
      </svg>
    ),
  },
];

/**
 * Floating nav — a centred pill of glyph keys, fixed to the top of the
 * viewport. Server-rendered apart from <ThemeToggle>, which keeps a fixed
 * 34px box in both themes so flipping the theme cannot move a pixel.
 */
export function NavPill() {
  return (
    <nav className="hor-navpill" aria-label="Primary">
      {NAV.map((item) => (
        <a key={item.label} href={item.href} className="hor-navbtn" aria-label={item.label} data-label={item.label}>
          {item.icon}
        </a>
      ))}
      <span className="hor-vrule mx-1.5" aria-hidden="true" />
      <ThemeToggle className="hor-toggle" />
    </nav>
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
            <Link href="/variants" className="hor-link text-[13px]">
              Design explorations
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
