"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ADMIN_GROUPS, ADMIN_SECTIONS, type AdminSectionId } from "./sections";

/**
 * The sidebar's link list.
 *
 * A client component, and it has to be: the active item is decided from
 * `usePathname()`, and it must update on a client-side navigation without a
 * round trip. It carries no data and no state of its own, so the cost is the
 * markup plus `usePathname` — the same trade `SiteNavLink` makes on the public
 * site, one level up because the whole list is static.
 *
 * The dashboard link is part of the list rather than a special case above it, so
 * "where am I" has exactly one answer at every moment.
 */

/* 16×16 line icons, 1.5px stroke. Smaller and plainer than the public site's
   nav glyphs: these sit next to a text label, so they are recognition aids
   rather than the whole affordance. */
const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" aria-hidden="true" {...STROKE}>
      {children}
    </svg>
  );
}

const ICONS: Record<AdminSectionId | "dashboard", ReactNode> = {
  /* Grid — the overview. */
  dashboard: (
    <Icon>
      <rect x="3" y="3" width="6" height="6" rx="1.4" />
      <rect x="11" y="3" width="6" height="6" rx="1.4" />
      <rect x="3" y="11" width="6" height="6" rx="1.4" />
      <rect x="11" y="11" width="6" height="6" rx="1.4" />
    </Icon>
  ),
  /* Briefcase — matches the public site's Work key. */
  projects: (
    <Icon>
      <rect x="3" y="6.3" width="14" height="9.5" rx="1.8" />
      <path d="M7.4 6V5a1.6 1.6 0 011.6-1.6h2A1.6 1.6 0 0112.6 5v1M3 10.5h14" />
    </Icon>
  ),
  /* Beaker — matches Labs. */
  labs: (
    <Icon>
      <path d="M8.2 2.9v4.4L4.1 14.4a1.7 1.7 0 001.5 2.6h8.8a1.7 1.7 0 001.5-2.6l-4.1-7.1V2.9" />
      <path d="M7.1 2.9h5.8M6.1 12.2h7.8" />
    </Icon>
  ),
  /* Pen over a line — writing. */
  posts: (
    <Icon>
      <path d="M4 16h12M13.2 3.6l3.2 3.2-8 8-4 .8.8-4z" />
    </Icon>
  ),
  /* Beer glass — matches Fun. */
  fun: (
    <Icon>
      <path d="M5.4 4.2h7.2l-.7 12.1a1 1 0 01-1 .9H7.1a1 1 0 01-1-.9z" />
      <path d="M12.5 6.6h1.9a1.7 1.7 0 011.7 1.7v2.3a1.7 1.7 0 01-1.7 1.7h-2.2M5.6 7.8h6.9" />
    </Icon>
  ),
  /* Document — matches Résumé. */
  resume: (
    <Icon>
      <path d="M5.1 2.9h6l3.8 3.8v10.4H5.1z" />
      <path d="M11 2.9v3.9h3.9M7.5 10.2h5M7.5 13h3.6" />
    </Icon>
  ),
  /* Stacked bars — a timeline of roles. */
  experience: (
    <Icon>
      <path d="M3.5 5.2h9M3.5 10h13M3.5 14.8h6" />
    </Icon>
  ),
  /* Envelope — matches Contact. */
  contact: (
    <Icon>
      <rect x="2.8" y="4.6" width="14.4" height="10.8" rx="2" />
      <path d="M3.4 6.2L10 11l6.6-4.8" />
    </Icon>
  ),
  /* Key — the ingest tokens. */
  tokens: (
    <Icon>
      <circle cx="7" cy="7" r="3.2" />
      <path d="M9.3 9.3l6 6M13.1 13.1l1.5-1.5M15 15l1.4-1.4" />
    </Icon>
  ),
  /* Sliders — settings. */
  settings: (
    <Icon>
      <path d="M3.5 6.4h13M3.5 13.6h13" />
      <circle cx="8" cy="6.4" r="1.7" />
      <circle cx="13" cy="13.6" r="1.7" />
    </Icon>
  ),
};

/**
 * One link. `usePathname` is read once by the parent and threaded down as a
 * prop rather than called per item — nine subscriptions to the same value would
 * re-render nine components on every navigation instead of one.
 */
function NavLink({
  href,
  label,
  icon,
  pathname,
  exact,
}: {
  href: string;
  label: string;
  icon: ReactNode;
  pathname: string;
  /** `true` for the dashboard, which owns only itself. */
  exact?: boolean;
}) {
  const isActive = exact
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      className="adm-navlink"
      aria-current={isActive ? "page" : undefined}
      data-active={isActive ? "true" : undefined}
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="adm-nav" aria-label="Admin sections">
      <NavLink
        href="/admin"
        label="Overview"
        icon={ICONS.dashboard}
        pathname={pathname}
        exact
      />

      {ADMIN_GROUPS.map((group) => {
        const sections = ADMIN_SECTIONS.filter(
          (section) => section.group === group.id,
        );

        if (sections.length === 0) {
          return null;
        }

        return (
          <div key={group.id}>
            <p className="adm-nav-label">{group.label}</p>
            {sections.map((section) => (
              <NavLink
                key={section.id}
                href={section.href}
                label={section.label}
                icon={ICONS[section.id]}
                pathname={pathname}
              />
            ))}
          </div>
        );
      })}
    </nav>
  );
}
