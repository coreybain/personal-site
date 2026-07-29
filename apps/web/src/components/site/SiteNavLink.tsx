"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type SiteNavLinkProps = {
  children: ReactNode;
  className?: string;
  href: string;
  label: string;
};

/**
 * The smallest client boundary in the site navigation.
 *
 * Home is intentionally never marked active. Every other top-level route also
 * owns its descendants, so Work remains current on `/work/[slug]`.
 */
export function SiteNavLink({
  children,
  className,
  href,
  label,
}: SiteNavLinkProps) {
  const pathname = usePathname();
  const isActive =
    href !== "/" && (pathname === href || pathname.startsWith(`${href}/`));

  return (
    <Link
      href={href}
      className={["hor-navbtn", className].filter(Boolean).join(" ")}
      aria-label={label}
      aria-current={isActive ? "page" : undefined}
      data-label={label}
      data-active={isActive ? "true" : undefined}
    >
      {children}
    </Link>
  );
}
