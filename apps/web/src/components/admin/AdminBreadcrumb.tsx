"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { sectionForPathname } from "./sections";

/**
 * The topbar's "you are here" line: `admin / case studies / new`.
 *
 * Derived from the pathname rather than passed in, so a page never has to
 * declare its own crumb and can never declare a wrong one. Two levels deep at
 * most — the section, then a raw trailing segment if there is one (`new`, or a
 * document id). Ids are not resolved to titles here on purpose: that would mean
 * a Convex read in the chrome, on every page, to render eleven characters.
 *
 * Pages that want a human title for a deep route should render it in their own
 * `<AdminPageHeader>`, which is where a reader is actually looking.
 */
export function AdminBreadcrumb() {
  const pathname = usePathname();
  const section = sectionForPathname(pathname);

  /* Everything after the section's own href, e.g. "new" or a document id. */
  const tail = section
    ? pathname.slice(section.href.length).replace(/^\/+/, "")
    : "";

  return (
    <nav className="adm-crumbs" aria-label="Breadcrumb">
      <Link href="/admin">admin</Link>

      {section ? (
        <>
          <span aria-hidden="true">/</span>
          {tail ? (
            <Link href={section.href}>{section.label.toLowerCase()}</Link>
          ) : (
            <span aria-current="page">{section.label.toLowerCase()}</span>
          )}
        </>
      ) : null}

      {tail ? (
        <>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{tail}</span>
        </>
      ) : null}
    </nav>
  );
}
