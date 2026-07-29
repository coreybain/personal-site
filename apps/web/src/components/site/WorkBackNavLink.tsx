"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { MouseEvent } from "react";

import { ArrowLeft } from "./work/WorkArt";

/**
 * Nested case studies get one contextual escape hatch in the persistent nav.
 * The work index and every unrelated route keep the standard top-level menu.
 */
export function WorkBackNavLink() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isCaseStudy = /^\/work\/[^/]+$/.test(pathname);
  const cameFromHome = searchParams.get("from") === "home";
  const label = cameFromHome ? "Back home" : "All work";

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      !cameFromHome ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    event.preventDefault();
    router.back();
  };

  if (!isCaseStudy) return null;

  return (
    <>
      <Link
        href={cameFromHome ? "/#work" : "/work"}
        className="hor-navbtn hor-nav-back"
        aria-label={label}
        data-label={label}
        onClick={handleClick}
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
