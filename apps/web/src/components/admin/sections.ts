/**
 * The admin's table of contents — one entry per editable entity.
 *
 * This list is the single source of truth for three things that must not drift
 * apart: the sidebar's links, the dashboard's cards, and the breadcrumb label a
 * page shows in the topbar. Add a section here and all three follow.
 *
 * Server-safe on purpose: no `"use client"`, no JSX, no imports. It is read by
 * server components (the shell layout's breadcrumb) *and* by client components
 * (the nav's active-state leaf, the dashboard's count reader), and a module with
 * a runtime dependency could not be.
 *
 * ── Adding a section ───────────────────────────────────────────────────────
 *
 * The `href` must be the real route. Every admin page lives inside the `(shell)`
 * route group — `src/app/admin/(shell)/<segment>/page.tsx` — which is a group, so
 * it contributes nothing to the URL: that file is served at `/admin/<segment>`.
 * Putting a page outside the group silently skips the auth gate and the chrome,
 * so if a link 404s or renders bare, that is the first thing to check.
 */

/** Which Convex table a section edits. Used for nothing but documentation. */
export type AdminSectionId =
  | "projects"
  | "labs"
  | "posts"
  | "fun"
  | "resume"
  | "experience"
  | "contact"
  | "tokens"
  | "settings";

export type AdminSection = {
  id: AdminSectionId;
  /** Sidebar and card label. Sentence case, short — the column is 236px. */
  label: string;
  /** Absolute route. `/admin` for the dashboard, `/admin/<segment>` otherwise. */
  href: string;
  /** One line on the dashboard card. What this section is *for*, not what it is. */
  blurb: string;
  /** Which Convex file backs it, so a reader can find the mutations. */
  backing: string;
  /** Sidebar grouping. Order within a group is the order of this array. */
  group: "content" | "profile" | "operations";
};

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  {
    id: "projects",
    label: "Case studies",
    href: "/admin/projects",
    blurb:
      "The client platforms. Publishing one is gated on every image being marked sanitised (ADR 009).",
    backing: "convex/projects.ts",
    group: "content",
  },
  {
    id: "labs",
    label: "Labs",
    href: "/admin/labs",
    blurb:
      "Curated repos (ADR 014). Stars and language refresh from a cron; everything else is editorial.",
    backing: "convex/labs.ts",
    group: "content",
  },
  {
    id: "posts",
    label: "Writing",
    href: "/admin/posts",
    blurb: "Long-form posts. Drafts are invisible to anyone without a session.",
    backing: "convex/posts.ts",
    group: "content",
  },
  {
    id: "fun",
    label: "Fun entries",
    href: "/admin/fun",
    blurb:
      "Beer, coffee, walks, places. Mostly written by the iOS app; editable and deletable here.",
    backing: "convex/funEntries.ts",
    group: "content",
  },
  {
    id: "resume",
    label: "Résumé",
    href: "/admin/resume",
    blurb:
      "The single résumé document, and the summary/skills the PDF renders (ADR 011).",
    backing: "convex/resume.ts",
    group: "profile",
  },
  {
    id: "experience",
    label: "Experience",
    href: "/admin/experience",
    blurb: "Roles and dates, ordered. The résumé's timeline reads from these.",
    backing: "convex/experienceEntries.ts",
    group: "profile",
  },
  {
    id: "settings",
    label: "Site settings",
    href: "/admin/settings",
    blurb:
      "Identity, availability, featured selections and which nav items the public site shows.",
    backing: "convex/siteSettings.ts",
    group: "profile",
  },
  {
    id: "contact",
    label: "Inbox",
    href: "/admin/contact",
    blurb: "Contact-form submissions, triaged by status.",
    backing: "convex/contactMessages.ts",
    group: "operations",
  },
  {
    id: "tokens",
    label: "Ingest tokens",
    href: "/admin/tokens",
    blurb:
      "Scoped bearer tokens for the machine ingest paths (ADR 006a). Shown once, then only revocable.",
    backing: "convex/ingestTokens.ts",
    group: "operations",
  },
];

/** Group headings, in sidebar order. */
export const ADMIN_GROUPS: readonly {
  id: AdminSection["group"];
  label: string;
}[] = [
  { id: "content", label: "Content" },
  { id: "profile", label: "Profile" },
  { id: "operations", label: "Operations" },
];

/**
 * The section that owns a pathname, or `null` for the dashboard and anything
 * unrecognised.
 *
 * Longest-prefix match, so `/admin/projects/new` resolves to Case studies. The
 * sort is by href length descending rather than array order, because a future
 * `/admin/labs` and `/admin/labs-archive` would otherwise resolve wrongly
 * depending on which was declared first.
 */
export function sectionForPathname(pathname: string): AdminSection | null {
  const matches = ADMIN_SECTIONS.filter(
    (section) =>
      pathname === section.href || pathname.startsWith(`${section.href}/`),
  ).sort((a, b) => b.href.length - a.href.length);

  return matches[0] ?? null;
}
