"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ArrowLeft } from "./work/WorkArt";

/**
 * Nested case studies get one contextual escape hatch in the persistent nav.
 * The work index and every unrelated route keep the standard top-level menu.
 */
export function WorkBackNavLink() {
  const pathname = usePathname();
  const isCaseStudy = /^\/work\/[^/]+$/.test(pathname);

  if (!isCaseStudy) return null;

  return (
    <>
      <Link
        href="/work"
        className="hor-navbtn hor-nav-back"
        aria-label="All work"
        data-label="All work"
      >
        <ArrowLeft />
      </Link>
      <span
        className="hor-vrule hor-nav-context-sep"
        aria-hidden="true"
      />
    </>
  );
}
