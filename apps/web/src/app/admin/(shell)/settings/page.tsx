import type { Metadata } from "next";

import {
  AdminPage,
  AdminPageHeader,
  ConvexGate,
  ViewOnSite,
} from "@/components/admin";

import { SettingsEditor } from "./SettingsEditor";

/**
 * `/admin/settings` — the `siteSettings` singleton.
 *
 * A **server** component, thin by the kit's composition rule: the header renders
 * without a backend, so a zero-env clone shows a page that says what this screen
 * changes rather than a blank rectangle. Everything that reads or writes is inside
 * `SettingsEditor`, below the gate.
 *
 * ── What is actually at stake here ──────────────────────────────────────────
 *
 * This is the one screen where a save changes the *public site* rather than a piece
 * of content on it: the hero headline, the availability line, the socials, which
 * nav items exist at all, and which slugs the dashboard features. Two consequences
 * worth stating, because both are surprising:
 *
 *   • Turning a nav item off does not remove the route. `/labs` still resolves;
 *     the link to it stops being rendered. That is the intended behaviour — a nav
 *     flag hides work in progress, it is not access control.
 *   • Featured slugs are format-checked but not existence-checked, deliberately,
 *     so the dashboard can be curated before the content is written.
 *
 * Both are now stated where they apply — the first in the Navigation panel's
 * tooltip, the second in the Featured panel's — rather than in a paragraph under
 * this title that has to summarise both before the reader has seen either. What
 * stays inline in `SettingsEditor` is the pair of things that can cost something:
 * the "no settings row exists yet" notice, and the warning that this form does not
 * follow live changes and will overwrite an edit made from the phone.
 *
 * The "View on site" target is `/` because that is what this screen edits — the
 * homepage's own chrome. It duplicates the shell's persistent link on purpose: this
 * one is the answer to "did that headline land", and it belongs beside the title of
 * the screen that changed it.
 */
export const metadata: Metadata = {
  title: "Site settings — admin",
};

export default function SettingsPage() {
  return (
    <AdminPage>
      <AdminPageHeader
        eyebrow="Profile"
        title="Site settings"
        info={
          <>
            The one row that holds the public site&rsquo;s chrome: who it says it is
            about, the availability line, what the nav shows, and which entries the
            homepage features. Everything here changes without a deploy.
          </>
        }
        actions={<ViewOnSite href="/" label="View homepage" />}
      />

      <ConvexGate>
        <SettingsEditor />
      </ConvexGate>
    </AdminPage>
  );
}
