import Link from "next/link";

/**
 * "← Case studies", above a page title.
 *
 * ── Why the admin needs one at all ──────────────────────────────────────────
 *
 * Every detail and edit screen is reached from a list, and until this existed the
 * only ways back were the browser's Back button and the breadcrumb in the topbar.
 * Neither is enough. Back is unreliable *after a save* — the mutation resolved,
 * the list is already correct, and the reader has no way to know whether Back
 * will return them to a stale form or re-run something. And the breadcrumb is
 * chrome: it is 11px mono in the corner of the window, styled to be ignorable,
 * and it is ignored. A return path has to sit where the eye already is, which is
 * the top of the content column, immediately above the title.
 *
 * ── Why a `<Link>` and not `router.back()` ──────────────────────────────────
 *
 * A back *link* names its destination and a back *gesture* does not. "Case
 * studies" tells you where you are about to land; `history.back()` lands you
 * wherever you happened to come from, which after a redirect from `/new` to
 * `/projects/<id>` is the form you just left. The explicit href is also what
 * makes the control work on a deep link — someone opening a document URL from a
 * notes app has no history to go back to, and `router.back()` would do nothing.
 *
 * `next/link` rather than a plain `<a>`, unlike `AdminShell`'s brand link: this
 * navigation stays *inside* the admin, so keeping React mounted is the point
 * rather than the problem. The Convex socket and the Clerk session survive, and
 * the list's subscription is likely still warm.
 *
 * A server component. It renders as HTML on the first paint of a detail page,
 * which matters because the escape route from a screen should not be waiting on
 * hydration.
 */

export type BackLinkProps = {
  /** Where back *is*. Normally the section's list route. */
  href: string;
  /**
   * What is at `href`, as a human reads it — "Case studies", "Ingest tokens".
   * Not "Back": the chevron already says back, and the label's job is to say
   * back *to what*.
   */
  label: string;
};

export function BackLink({ href, label }: BackLinkProps) {
  return (
    <Link href={href} className="adm-back">
      <svg
        width="13"
        height="13"
        viewBox="0 0 20 20"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 4.6L6.6 10l5.4 5.4" />
      </svg>
      {label}
    </Link>
  );
}
