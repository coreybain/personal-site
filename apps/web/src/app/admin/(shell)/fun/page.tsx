import type { Metadata } from "next";
import Link from "next/link";

import {
  AdminPage,
  AdminPageHeader,
  ConvexGate,
  ViewOnSite,
} from "@/components/admin";

import { FunTable } from "./FunTable";

/**
 * `/admin/fun` — the Fun Entries list.
 *
 * A **server** component: furniture, then the gate. `FunTable` is the client half.
 *
 * ── Where "there is no draft state" went ─────────────────────────────────────
 *
 * Into the tip, and this was the one judgement call worth writing down. It is the
 * most surprising fact about this table — every other content screen in the admin
 * makes drafts — and the instinct is to keep it loud. But README §2a's test is
 * whether the reader has to act on it *before touching this screen*, and on a list
 * they do not: the only write here is a delete, which arms in place and names the
 * entry it is about to remove. The screens where it matters say it loudly and stay
 * that way — `/admin/fun/new` opens with "This publishes immediately", and the
 * editor's own panel says the entry is already public.
 *
 * The live `ViewOnSite` link does some of the same work: a list whose header offers
 * "View on site" with no draft/published distinction anywhere on it is a list of
 * things that are on the site.
 */
export const metadata: Metadata = {
  title: "Fun entries — admin",
};

export default function AdminFunPage() {
  return (
    <AdminPage>
      <AdminPageHeader
        eyebrow="Content"
        title="Fun entries"
        info={
          <>
            Beer, coffee, walks and pubs — usually captured by the iOS app. There is
            no draft state: the table has no <code>published</code> field, so an
            entry is public the moment it is saved, and deleting is the only way to
            take one back.
          </>
        }
        actions={
          <>
            {/* Live, and a plain route rather than a document — an entry has no page
                of its own, /fun is a grid. No `published` prop for the same reason:
                a route cannot be a draft (README §4a). */}
            <ViewOnSite href="/fun" />

            <Link
              href="/admin/fun/new"
              className="adm-btn"
              data-variant="primary"
            >
              New entry
            </Link>
          </>
        }
      />

      <ConvexGate>
        <FunTable />
      </ConvexGate>
    </AdminPage>
  );
}
