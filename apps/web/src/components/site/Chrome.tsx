import { Suspense, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";

import type { Identity } from "@/lib/snapshot";

import { FooterThemePicker } from "./FooterThemePicker";
import { SiteNavLink } from "./SiteNavLink";
import { WorkBackNavLink } from "./WorkBackNavLink";
import { stampTime } from "./format";

/* 20×20 line icons, 1.6px stroke — the pill speaks in glyphs, so every item
   carries its name as an aria-label and a hover/focus tooltip. */
const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
  /**
   * Marks an item the site can decide not to show. Absent means "always
   * present", which is every route except the blog — see `NavPill`.
   *
   * Spelled as a named gate rather than a boolean prop on the item so the array
   * below stays a declaration of *order* and nothing else: where "Writing" sits
   * in the pill is a design decision, and it should not have to move when the
   * condition for showing it changes.
   */
  gate?: "blog";
};

/**
 * The pill's keys — one per top-level route, in display order. Every href is
 * internal, so every item renders through <Link> and gets viewport prefetching
 * for free.
 *
 * Each item delegates pathname matching to a tiny client link leaf. The pill
 * itself stays server-rendered while non-home routes receive an accessible
 * `aria-current="page"` state.
 */
const NAV: NavItem[] = [
  {
    href: "/",
    label: "Home",
    icon: (
      <svg width="18" height="18" viewBox="0 0 20 20" {...STROKE}>
        <path d="M3.6 8.6L10 3.2l6.4 5.4" />
        <path d="M5.4 7.4v8.4a1 1 0 001 1h7.2a1 1 0 001-1V7.4" />
      </svg>
    ),
  },
  {
    /* Briefcase — the client platforms. */
    href: "/work",
    label: "Work",
    icon: (
      <svg width="18" height="18" viewBox="0 0 20 20" {...STROKE}>
        <rect x="3" y="6.3" width="14" height="9.5" rx="1.8" />
        <path d="M7.4 6V5a1.6 1.6 0 011.6-1.6h2A1.6 1.6 0 0112.6 5v1M3 10.5h14" />
      </svg>
    ),
  },
  {
    /* Beaker — the things built for their own sake. */
    href: "/labs",
    label: "Labs",
    icon: (
      <svg width="18" height="18" viewBox="0 0 20 20" {...STROKE}>
        <path d="M8.2 2.9v4.4L4.1 14.4a1.7 1.7 0 001.5 2.6h8.8a1.7 1.7 0 001.5-2.6l-4.1-7.1V2.9" />
        <path d="M7.1 2.9h5.8M6.1 12.2h7.8" />
      </svg>
    ),
  },
  {
    /* Pen — the writing. Gated; see `NavPill`. */
    gate: "blog",
    href: "/blog",
    label: "Writing",
    icon: (
      <svg width="18" height="18" viewBox="0 0 20 20" {...STROKE}>
        <path d="M13.1 3.4l3.5 3.5-8.6 8.6-4.3.8.8-4.3z" />
        <path d="M11.4 5.1l3.5 3.5" />
      </svg>
    ),
  },
  {
    /* Beer glass — off the clock. */
    href: "/fun",
    label: "Fun",
    icon: (
      <svg width="18" height="18" viewBox="0 0 20 20" {...STROKE}>
        <path d="M5.4 4.2h7.2l-.7 12.1a1 1 0 01-1 .9H7.1a1 1 0 01-1-.9z" />
        <path d="M12.5 6.6h1.9a1.7 1.7 0 011.7 1.7v2.3a1.7 1.7 0 01-1.7 1.7h-2.2M5.6 7.8h6.9" />
      </svg>
    ),
  },
  {
    /* Speech bubble with a spark — Ask Corey (ADR 015). Ungated on purpose:
       unlike Writing, this key leads somewhere that is designed for every
       state it can be in. With no model keys set the page says so in words and
       points at the pages it would have quoted, so the key never leads to an
       empty room — which is the only condition the blog gate exists to
       enforce. */
    href: "/ask",
    label: "Ask",
    icon: (
      <svg width="18" height="18" viewBox="0 0 20 20" {...STROKE}>
        <path d="M16.6 10.4a6.3 6.3 0 01-8.7 5.8L3.6 17.2l1.1-4.1a6.3 6.3 0 015.6-9.1 6.3 6.3 0 016.3 6.4z" />
        <path d="M12.6 7.1l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5z" />
      </svg>
    ),
  },
  {
    /* Envelope — the contact page (the mailto still lives in the footer). */
    href: "/contact",
    label: "Contact",
    icon: (
      <svg width="18" height="18" viewBox="0 0 20 20" {...STROKE}>
        <rect x="2.8" y="4.6" width="14.4" height="10.8" rx="2" />
        <path d="M3.4 6.2L10 11l6.6-4.8" />
      </svg>
    ),
  },
];

const RESUME_NAV_ITEM = {
  href: "/resume",
  label: "Resume",
  icon: (
    <svg width="18" height="18" viewBox="0 0 20 20" {...STROKE}>
      <path d="M5.1 2.9h6l3.8 3.8v10.4H5.1z" />
      <path d="M11 2.9v3.9h3.9M7.5 10.2h5M7.5 13h3.6" />
    </svg>
  ),
} satisfies { href: string; label: string; icon: ReactNode };

/**
 * Floating nav — a centred pill of glyph keys, fixed to the top of the
 * viewport. Lives in the `(site)` layout, so it persists across navigations.
 * The résumé gets the separated edge key; theme preferences live in the
 * footer, and only the individual pathname-aware links cross the client
 * boundary.
 *
 * ── The one gated key ──────────────────────────────────────────────────────
 *
 * "Writing" appears only when `showBlog` is true, which the layout computes
 * from `showBlogInNav()`: the `siteSettings.nav.blog` toggle, server-derived
 * (the old published-post condition was removed 2026-07-31 — ADR 0018
 * amendment; the `/blog` empty state was built to stand on its own). The
 * decision is made during the render, and the browser is sent a pill that
 * either has the key in it or does not. There is no flicker, no `hidden`
 * attribute and no CSS that could be defeated by a stylesheet failing to load.
 *
 * **Hiding the key does not hide the route** — `/blog` renders for anyone who
 * types it, links to it, or finds it in a search result.
 *
 * `showBlog` defaults to `false` so that a caller who has not been updated —
 * an archived variant, a future layout — fails closed rather than advertising a
 * section that may not have anything in it.
 */
export function NavPill({ showBlog = false }: { showBlog?: boolean }) {
  const items = NAV.filter((item) => item.gate !== "blog" || showBlog);

  return (
    <nav className="hor-navpill" aria-label="Primary">
      <Suspense fallback={null}>
        <WorkBackNavLink />
      </Suspense>
      {items.map((item) => (
        <SiteNavLink
          key={item.label}
          href={item.href}
          label={item.label}
        >
          {item.icon}
        </SiteNavLink>
      ))}
      <span className="hor-vrule mx-1.5" aria-hidden="true" />
      <SiteNavLink
        href={RESUME_NAV_ITEM.href}
        className="hor-nav-edge"
        label={RESUME_NAV_ITEM.label}
      >
        {RESUME_NAV_ITEM.icon}
      </SiteNavLink>
    </nav>
  );
}

/**
 * The contact block every `(site)` route ends on.
 *
 * Prop-fed rather than reading `@/lib/snapshot` at module scope, because the
 * footer is mounted by the layout and the layout is now a Convex reader. A
 * module-scope `const { identity } = snapshot` is evaluated once per *process*,
 * so it could never see a row — and `siteSettings.setAvailability` changing
 * Corey's email or handle would have gone unnoticed here until a redeploy.
 *
 * `identity` and `computedAt` arrive from the layout's single `getSiteData()`
 * call, which is the same cached read the page below it uses.
 */
export function Footer({
  identity,
  computedAt,
}: {
  identity: Identity;
  /** ISO instant the snapshot was assembled — the footer's `Snapshot …` stamp. */
  computedAt: string;
}) {
  return (
    <footer
      className="hor-footer hor-rise pb-14 sm:pb-20"
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
            <FooterThemePicker />
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
              Snapshot {stampTime(computedAt)}
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
