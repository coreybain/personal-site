"use client";

/* Deep import, not the barrel — the one place in the admin that does this, and the
   reason is measurable. An `error.tsx` is its own client entry, so Turbopack builds
   a *second* client graph for it; importing `@/components/admin` pulled the whole
   barrel into that graph, and the barrel re-exports `RichTextEditor`. The result
   was `/admin/fun/[id]` shipping two separate 505 KB copies of Tiptap and
   ProseMirror in its first load — 1.93 MB against ~1.40 MB for every other admin
   route — which is also exactly the duplicated-ProseMirror-schema situation README
   §4b warns produces a runtime `RangeError`. All four of these live in
   `AdminPage.tsx`, whose only imports are `BackLink` and `InfoTip`. */
import {
  AdminButtonRow,
  AdminPage,
  AdminPageHeader,
  AdminPanel,
} from "@/components/admin/AdminPage";

/**
 * The error boundary for `/admin/fun/[id]`.
 *
 * ── Why this one route has one and the others do not ─────────────────────────
 *
 * This is the only admin route whose URL is fed straight into a Convex `v.id()`
 * validator. `funEntries` has no slug, so the editor addresses a row by id — and an
 * id-shaped string that is not a real document id is rejected by the validator
 * inside the query, which means `useQuery` **throws during render**. A throw during
 * render is an error boundary or it is a blank page; without this file the nearest
 * boundary is Next's own, which replaces the whole admin shell with a stack trace.
 *
 * The comparable failure does not exist on `/admin/posts/[slug]`: `posts.getBySlug`
 * takes a `v.string()` and returns `null` for anything unknown, precisely so an
 * unknown URL is a 404 rather than a 500 (its docblock says so). A valid-but-deleted
 * id also returns `null` and is handled inside `FunEditor` as "no such entry" — this
 * file is for the malformed case and for anything else that throws.
 *
 * ── `unstable_retry`, not `reset` ────────────────────────────────────────────
 *
 * This version of Next passes `unstable_retry`, which re-fetches *and* re-renders
 * the boundary's children. `reset` still exists and only clears the error state
 * without re-fetching, which for a Convex subscription would re-throw immediately.
 * Retrying is what the reader wants and is what the current API recommends.
 *
 * ── Why the prose stayed on the page here ───────────────────────────────────
 *
 * Every other screen in this section moved its explanation into an `InfoTip`. This
 * one did not, and the difference is the point of the rule rather than an exception
 * to it: an error screen is nothing *but* judgement text. The reader is here because
 * something failed, the sentence about a hand-edited URL is the diagnosis, and a
 * diagnosis behind a hover is a diagnosis nobody reads. It is composed through
 * `AdminPage`/`AdminPageHeader` now instead of hand-rolled `.adm-page-head` markup,
 * which is what actually needed fixing — the hand-rolled version still had the
 * pre-compaction structure (a wrapping `<div>`, `.adm-page-sub`) and would have
 * drifted further with every kit change.
 *
 * `AdminPageHeader` and `AdminPanel` have no `"use client"` of their own, so they
 * compose into this client boundary and are bundled with it. That is fine and is
 * the only way an error boundary can use them: the file has to be a Client
 * Component (React requires it), so everything it renders is client code.
 */
export default function FunEntryError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <AdminPage>
      <AdminPageHeader
        title="That entry could not be loaded"
        /* The list, and it is the only navigation on this screen that is certain
           to work — whatever threw is between here and the entry. */
        back={{ href: "/admin/fun", label: "Fun entries" }}
      />

      <AdminPanel>
        <p className="adm-hint">
          The most likely cause is a hand-edited URL: the last segment has to be a
          Convex document id, and anything else is refused by the validator rather
          than treated as a missing row.
        </p>

        {/* The raw message, verbatim. The only person who sees this screen is the
            one who can act on it, and a paraphrase would hide which of several
            failures it was. */}
        <p className="adm-error" role="alert">
          {error.message || "The request failed and carried no message."}
        </p>

        <AdminButtonRow>
          <button
            type="button"
            className="adm-btn"
            onClick={() => unstable_retry()}
          >
            Try again
          </button>
        </AdminButtonRow>
      </AdminPanel>
    </AdminPage>
  );
}
