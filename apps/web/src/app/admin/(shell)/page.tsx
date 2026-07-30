import type { Metadata } from "next";

import { AdminPage, AdminPageHeader } from "@/components/admin";
import { DashboardGrid } from "@/components/admin/DashboardGrid";

/**
 * `/admin` — the dashboard.
 *
 * A **server** component, and a thin one: a header, the link out to the site, and
 * the grid. Everything that needs a backend is inside `DashboardGrid`, which is a
 * client component because nine counts means nine `useQuery` subscriptions (see its
 * docblock for why the whole grid crossed the boundary rather than a leaf per card).
 *
 * The grid renders with or without Convex, so this page is legible on a zero-env
 * clone: nine cards, nine em dashes, and a notice saying why. That is deliberate
 * placeholder tolerance rather than a fallback — the shape of the admin is
 * information, and it should not require a provisioned backend to see.
 *
 * There is no `<h1>` above the header's own: `AdminPageHeader` renders it.
 */
export const metadata: Metadata = {
  title: "Overview — admin",
};

export default function AdminDashboardPage() {
  return (
    <AdminPage>
      <AdminPageHeader
        eyebrow="Overview"
        title="Content"
        /* Was three sentences of prose under the title, which is 60px of the
           screen spent explaining a grid of labelled numbers that explains
           itself. The one non-obvious fact in it — that the counts are live and
           include writes this admin did not make — is worth keeping, and worth
           keeping behind the icon. */
        info={
          <>
            Every editable entity, and how much of it exists. The counts come
            straight from Convex and are live, so they follow records written by
            the iOS app and the ingest crons as well as by these screens.
          </>
        }
      />

      <ViewSiteRow />

      <DashboardGrid />
    </AdminPage>
  );
}

/**
 * The public site, as the first card on the dashboard.
 *
 * The topbar's persistent "View site" is the one you use mid-task without losing
 * your place; this is the one you notice on arrival. Both are worth having, and
 * the dashboard is the screen where "the thing all of this produces" deserves to
 * be a destination rather than a 12px link in a corner.
 *
 * It borrows `.adm-card` so it lands in exactly the visual language of the nine
 * below it — same border, same radius, same accent hover — for no new CSS, and it
 * is a **bare** card rather than one inside an `.adm-cards` grid. That was the
 * first attempt and a screenshot killed it: the grid is
 * `repeat(auto-fill, minmax(268px, 1fr))`, and `auto-fill` lays down as many
 * tracks as the container holds whether or not there are children to fill them, so
 * a single card sat in a 268px column looking like a tenth section rather than the
 * row above them. `.adm-card` is `display: flex` on its own, so as a plain block
 * child of the page column it is full width with nothing added. The bottom margin
 * is the grid's own `gap`, so the card and the grid read as one stack.
 *
 * A plain `<a target="_blank">`, never `next/link`, for the reason the kit's
 * `ViewOnSite` docblock gives at length: a soft navigation to the public site
 * keeps Clerk, the Convex socket and UploadThing alive in memory on a page that
 * has no business holding them.
 */
function ViewSiteRow() {
  return (
    <a
      className="adm-card"
      href="/"
      target="_blank"
      rel="noreferrer"
      style={{ marginBottom: "0.7rem" }}
    >
      <span className="adm-card-head">
        <span className="adm-card-label">View the public site</span>
        <span className="adm-card-count">
          {/* The kit's `ExternalIcon` is private to `ViewOnSite.tsx` and this card
              cannot use `ViewOnSite` itself — that would nest an anchor inside an
              anchor. Same glyph, redrawn, so the affordance reads the same
              everywhere. */}
          <svg
            width="13"
            height="13"
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
        </span>
      </span>

      <span className="adm-card-blurb">
        Everything below, as a visitor sees it.
        <span className="adm-sr-only"> (opens in a new tab)</span>
      </span>
    </a>
  );
}
