/**
 * Links from the thing that edits content to the content.
 *
 * Two exports, one icon, one rule about `<a>` vs `<Link>`.
 *
 * ── Why a plain `<a target="_blank">` and never `next/link` ─────────────────
 *
 * Both links here leave the admin for the public site, and `next/link` would
 * soft-navigate: React stays mounted, and the admin's client graph — Clerk, the
 * Convex WebSocket, UploadThing — stays live in memory while the reader browses
 * the site. That is the exact coupling ADR 006 and the root layout's docblock
 * exist to prevent, and it also leaves a Convex subscription holding a socket
 * open on a page that has no business holding one. `AdminShell`'s brand link
 * already makes this argument at length and the same reasoning applies verbatim.
 *
 * `target="_blank"` on top of that, because these are *reference* links: you open
 * the live page to check the change landed and then come back to the form you
 * were in the middle of. Replacing the form with the site would be the opposite
 * of what the control is for. `rel="noreferrer"` comes along for the ride —
 * `noopener` is implied by `_blank` in every current browser but `noreferrer`
 * still has to be asked for.
 *
 * Unlike `AdminShell`, none of this needs an `@next/next/no-html-link-for-pages`
 * suppression: that rule skips any `<a target="_blank">` outright, on the
 * reasoning that a new tab is a legitimate reason not to use `next/link`. The
 * brand mark needs the comment precisely because it navigates in place.
 *
 * ── Why "not public yet" is a state and not a hidden link ───────────────────
 *
 * A draft has no public URL: `/work/<slug>` for an unpublished case study is a
 * 404, and offering the link would teach the reader that the admin lies. Simply
 * omitting the control is worse though — a control that appears and disappears
 * reads as a bug, and the absence answers no question. So the component renders
 * a muted, non-interactive version of itself that says which of the two reasons
 * applies: the document is a draft, or the public route does not exist yet.
 *
 * The second case is real and will be for a while: `/blog` is not built. Writing
 * screens want the affordance in place so it turns on by itself the day the route
 * lands, and want to be honest about it until then. That is `routeLive={false}`.
 */

/**
 * Box-with-an-arrow. Small and thin: this sits inside text-sized labels, and a
 * heavier glyph would read as the primary thing in the row rather than as the
 * annotation it is.
 */
function ExternalIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 20 20"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.4 4.4H5.2A1.8 1.8 0 003.4 6.2v8.6a1.8 1.8 0 001.8 1.8h8.6a1.8 1.8 0 001.8-1.8v-4.2" />
      <path d="M12.2 3.4h4.4v4.4M16.2 3.8l-6.4 6.4" />
    </svg>
  );
}

export type ViewOnSiteProps = {
  /**
   * The public route, absolute and site-relative: `/work/${slug}`, `/labs`,
   * `/resume`. Not a full URL — the admin and the site are one deployment, and a
   * hardcoded origin breaks on every preview.
   */
  href: string;
  /**
   * Whether the *document* is published. Omit on a list-level link, where the
   * route is the destination and there is no document to be a draft of.
   *
   * `false` renders the muted draft state. Note the asymmetry with the backend:
   * there is no `published` field to write anywhere (see README §7), so this is
   * read off the row you already have, never set from here.
   */
  published?: boolean;
  /**
   * Whether the public route exists at all. Defaults to `true`; pass `false` for
   * a route that is planned but not built (`/blog`), which renders a muted state
   * naming the route instead of a link to a 404.
   */
  routeLive?: boolean;
  /**
   * Overrides the link text. The default, "View on site", is right nearly
   * always; a page with two of these (a list and a featured item) should name
   * them.
   */
  label?: string;
};

export function ViewOnSite({
  href,
  published,
  routeLive = true,
  label = "View on site",
}: ViewOnSiteProps) {
  if (!routeLive) {
    return (
      <span className="adm-viewsite" data-state="planned">
        <ExternalIcon />
        Not on the site yet
        {/* The route is named because the question this state raises is "so
            where will it be" — and a reader who knows the answer can also tell
            at a glance whether the admin is pointing at the right place. */}
        <code>{href}</code>
      </span>
    );
  }

  if (published === false) {
    return (
      <span className="adm-viewsite" data-state="draft">
        <ExternalIcon />
        Draft — not public yet
      </span>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="adm-viewsite"
      data-state="live"
    >
      <ExternalIcon />
      {label}
      {/* Screen readers get told the tab changes. Sighted readers get the arrow
          glyph, which says the same thing and is why this is hidden text. */}
      <span className="adm-sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/**
 * The shell's persistent escape hatch: the public homepage, in a new tab.
 *
 * Sits next to the account controls in the topbar rather than in the sidebar,
 * because it is not a section — the sidebar is "which data am I editing" and
 * putting a link out of the app in that list makes the list mean two things. The
 * topbar's right cluster is already where the controls that are *about the
 * session* live (theme, sign out), and "leave for the site" belongs with them.
 *
 * Distinct from `AdminShell`'s brand mark, which is the same destination in the
 * same tab. That one is "I am done here"; this one is "let me look". Both are
 * worth having and the difference is `target`.
 */
export function ViewSiteLink() {
  return (
    <a
      href="/"
      target="_blank"
      rel="noreferrer"
      className="adm-btn adm-viewsite-btn"
      data-variant="ghost"
      data-size="sm"
    >
      <ExternalIcon />
      {/* Hidden below the topbar's narrow breakpoint, where the arrow carries
          it — see `.adm-viewsite-btn span` in admin.css. */}
      <span>View site</span>
      <span className="adm-sr-only"> (opens in a new tab)</span>
    </a>
  );
}
