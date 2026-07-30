import type { ReactNode } from "react";

import { BackLink } from "./BackLink";
import { InfoTip } from "./InfoTip";

/**
 * Page furniture: the container, the header, the panel, the notice.
 *
 * Every admin screen starts with `<AdminPage>` and a `<AdminPageHeader>`, and
 * both sit **outside** any `<ConvexGate>`. That ordering is the whole point of
 * these components existing: the title, the actions and the return path of a
 * screen are knowable without a backend, so a deployment with no Convex still
 * renders a page a human can read and navigate rather than a blank rectangle.
 *
 * Server components, with one boundary: `AdminPageHeader` renders `InfoTip`,
 * which is `"use client"`. That is a leaf — the header itself still renders on
 * the server, and `info` crosses the boundary as an RSC payload rather than as
 * code, so a paragraph of explanation costs no JavaScript beyond the tooltip's
 * own behaviour.
 */

/**
 * The content column. One per page, wrapping everything below the topbar.
 *
 * Max width 1040px, which is a decision rather than a default: a form field wider
 * than about 70 characters is measurably harder to read, and a table wider than
 * the viewport is what `.adm-table-wrap` is for. The admin does not use the full
 * width of a large screen, and should not.
 */
export function AdminPage({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="adm-page">{children}</div>;
}

/**
 * ── The compact header ──────────────────────────────────────────────────────
 *
 * One line: an optional return path above it, then title + an optional info icon
 * on the left and the actions on the right. Everything a screen wants to *say*
 * goes in `info`; everything it wants you to *do* goes in `actions`.
 *
 * This replaced a header that printed two or three sentences of prose under every
 * title. The prose was accurate and it was costing 60–80px above the fold on
 * every screen, for text that is read once by the only person who uses the admin
 * and then read never again. Moving it into a tooltip keeps the information
 * exactly one keystroke away — the icon is in the tab order and its content is in
 * the accessible description — while giving the space back to the thing the
 * screen is for.
 *
 * **What must not move into the tooltip.** Chrome text explains the screen;
 * judgement text tells you something you have to act on. The ADR-009 blocker
 * naming unsanitised assets, the ingest token's "you will not see this again"
 * panel, a destructive confirm, and any zero-env or auth-state notice all stay
 * inline and loud — `AdminNotice` below, or a panel of their own. A fact you
 * cannot act on until you hover is a fact you will miss.
 */
export type AdminPageHeaderProps = {
  title: string;
  /**
   * What this screen edits and what its rules are, behind the info icon beside
   * the title. One or two sentences — the tooltip is not a manual, and anything
   * needing a list or a code block is an `AdminNotice` instead.
   */
  info?: ReactNode;
  /**
   * Overrides the info trigger's accessible name, which is otherwise
   * `About {title}`. The same escape hatch `AdminPanel` and the fields have, for
   * the titles where the derived name reads badly.
   */
  infoLabel?: string;
  /** Primary controls: "New case study", "View on site", a status filter. */
  actions?: ReactNode;
  /**
   * The return path, rendered as a `BackLink` above the title. **Every detail,
   * edit and `new` screen sets this**, pointing at its list; list screens do not
   * (their parent is the dashboard, which the sidebar already covers).
   */
  back?: { href: string; label: string };
  /**
   * Small mono label above the title, naming the *group* the screen sits in
   * ("Content", "Profile", "Operations") — which is what makes it worth having on
   * a list screen and noise on a detail screen. A detail screen already renders
   * `back`, whose label is the section name, so an eyebrow there prints the same
   * word twice in two type styles, one line apart. **List screens set it; detail,
   * edit and `new` screens do not.**
   */
  eyebrow?: string;
  /* There is deliberately no `description`. It existed as a deprecated shim while
     the nine section screens were migrated from prose-under-the-title to `info`,
     and it is gone now that the last caller is: a prop that renders the exact
     layout this pass removed is an invitation to reintroduce it one screen at a
     time. `.adm-page-sub` survives in `admin.css` because the sign-in screen — the
     one page outside the shell, with no `AdminPageHeader` — still uses the class
     directly for its one line of copy. */
};

export function AdminPageHeader({
  title,
  info,
  infoLabel,
  actions,
  back,
  eyebrow,
}: AdminPageHeaderProps) {
  return (
    <header className="adm-page-head">
      {back ? <BackLink href={back.href} label={back.label} /> : null}

      {/* The eyebrow is above the title row rather than inside it. It looks like
          it belongs in the same block as the title, and it did until a
          screenshot showed what that costs: the row baseline-aligns its
          children, so with the eyebrow in the left-hand column the *actions* on
          the right lined up with the 10px eyebrow instead of the 19px title.
          Hoisting it puts the title and the actions on a shared baseline, which
          is the whole claim the compact header makes. */}
      {eyebrow ? <p className="adm-eyebrow">{eyebrow}</p> : null}

      <div className="adm-page-head-row">
        {/* The InfoTip is a *sibling* of the h1, not a child of it. A button
            inside a heading contributes its accessible name to the heading's, so
            nesting it would make this page announce as "Case studies, About case
            studies" — and the h1 is how a screen-reader reader knows which
            screen they are on. */}
        <div className="adm-page-title-row">
          <h1 className="adm-page-title">{title}</h1>
          {info ? (
            <InfoTip label={infoLabel ?? `About ${title}`}>{info}</InfoTip>
          ) : null}
        </div>

        {actions ? <div className="adm-page-actions">{actions}</div> : null}
      </div>
    </header>
  );
}

/**
 * A bordered block with an optional heading and footer.
 *
 * The unit of grouping on a form screen. Panels are not decoration: a case study
 * has twenty fields across five unrelated concerns (identity, narrative, media,
 * links, presentation), and one flat column of twenty inputs is unreadable.
 */
export function AdminPanel({
  children,
  title,
  /**
   * What this group of fields is and what rules govern it, behind an info icon
   * **beside the title**.
   *
   * This exists because the obvious alternative does not work. Before it, a panel
   * explained itself by putting an `InfoTip` in `headerEnd` — which is the
   * right-hand cluster, so on a 1040px column the icon rendered most of a
   * screen-width away from the heading it belonged to and read as belonging to the
   * badge it sat next to. `headerEnd` is for controls and status; `info` is for
   * explanation, and it renders where the reader looks for it.
   */
  info,
  /** Overrides the info trigger's accessible name (default `About {title}`). */
  infoLabel,
  /** Right-hand side of the panel heading — a status badge, a small control. */
  headerEnd,
  /** A row of buttons in a tinted strip along the bottom. */
  footer,
}: Readonly<{
  children: ReactNode;
  title?: string;
  info?: ReactNode;
  infoLabel?: string;
  headerEnd?: ReactNode;
  footer?: ReactNode;
}>) {
  return (
    <section className="adm-panel">
      {title || info || headerEnd ? (
        <div className="adm-panel-head">
          {/* Same construction as the page header: the tip is a sibling of the
              heading, never a child, so it does not join the h2's accessible
              name. */}
          {title || info ? (
            <div className="adm-panel-title-row">
              {title ? <h2 className="adm-panel-title">{title}</h2> : null}
              {info ? (
                <InfoTip label={infoLabel ?? `About ${title ?? "this panel"}`}>
                  {info}
                </InfoTip>
              ) : null}
            </div>
          ) : null}

          {headerEnd ? <div className="adm-toolbar-end">{headerEnd}</div> : null}
        </div>
      ) : null}

      <div className="adm-panel-body">{children}</div>

      {footer ? <div className="adm-panel-foot">{footer}</div> : null}
    </section>
  );
}

/**
 * An inline note inside a page's content.
 *
 * `info` for something worth knowing, `warn` for a consequence, `danger` for an
 * irreversible one. Distinct from `.adm-banner`, which the shell layout uses for
 * facts about the whole deployment.
 *
 * Prefer one good notice over three: a screen where everything is highlighted
 * highlights nothing.
 */
export function AdminNotice({
  children,
  title,
  tone = "info",
}: Readonly<{
  children: ReactNode;
  title?: string;
  tone?: "info" | "warn" | "danger";
}>) {
  return (
    <div
      className="adm-notice"
      data-tone={tone}
      /* `alert` interrupts a screen reader mid-sentence, which is right for a
         destructive consequence and rude for a hint. */
      role={tone === "danger" ? "alert" : "note"}
    >
      <div>
        {title ? <p className="adm-notice-title">{title}</p> : null}
        <p className="adm-micro">{children}</p>
      </div>
    </div>
  );
}

/** A form's field stack. Just the vertical rhythm — no `<form>`, no submit. */
export function AdminForm({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="adm-form">{children}</div>;
}

/** A horizontal cluster of buttons, wrapping on narrow screens. */
export function AdminButtonRow({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="adm-btn-row">{children}</div>;
}
