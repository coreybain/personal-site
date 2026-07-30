import type { Metadata } from "next";

import {
  AdminPage,
  AdminPageHeader,
  ConvexGate,
  ViewOnSite,
} from "@/components/admin";

import { Inbox } from "./Inbox";

/**
 * `/admin/contact` — the contact-form inbox.
 *
 * A **server** component, thin by the kit's composition rule: the header renders
 * on a deployment with no Convex, so a zero-env clone shows a page that explains
 * what the inbox is instead of a blank rectangle. Everything that reads a message
 * is inside `Inbox`, below the gate.
 *
 * The route is `/admin/contact`, matching the `contact` entry in
 * `src/components/admin/sections.ts` — which drives the sidebar link, the
 * dashboard card and the breadcrumb. The Convex table is `contactMessages` and the
 * section is labelled "Inbox"; the URL follows the section registry rather than
 * either name, because that file is the one place all three must agree.
 *
 * ── Why every message body is behind a session ──────────────────────────────
 *
 * These are other people's names, email addresses and, occasionally, their
 * commercial plans. `contactMessages.list` is admin-only for that reason and there
 * is no public read of this table at all: the only public function is `submit`,
 * which returns `null` so that not even a row count leaks to the sender.
 *
 * The "View on site" link goes to `/contact` — the form that writes here, which is
 * the only public surface this section has.
 */
export const metadata: Metadata = {
  title: "Inbox — admin",
};

export default function ContactPage() {
  return (
    <AdminPage>
      <AdminPageHeader
        eyebrow="Operations"
        title="Inbox"
        /* The triage vocabulary is the only thing worth explaining here, and it is
           chrome: the status buttons say what they do, this says which one to
           reach for. The one sentence that is *not* chrome — deleting is
           irreversible — is not in here, because `DeleteButton` already says it at
           the moment it matters, naming the sender it is about to delete. */
        info={
          <>
            Submissions from the public form at <code>/contact</code>, triaged by
            status. Opening a new message marks it read.{" "}
            <strong>Archived</strong> is &ldquo;dealt with, keep it&rdquo;;{" "}
            <strong>spam</strong> is the bin that a public form on a site aimed at
            recruiters will certainly need.
          </>
        }
        actions={<ViewOnSite href="/contact" label="View the form" />}
      />

      <ConvexGate>
        <Inbox />
      </ConvexGate>
    </AdminPage>
  );
}
