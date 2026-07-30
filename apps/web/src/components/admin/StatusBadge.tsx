import type { ReactNode } from "react";

/**
 * Draft or published, said the same way everywhere.
 *
 * ── Why a component for eleven characters ───────────────────────────────────
 *
 * Because "is this live?" is the single most consequential fact on every screen
 * in this admin, and the failure mode of writing it inline is that it ends up
 * phrased three ways ("Draft", "unpublished", "not live") in three places, at
 * which point the reader has to think about wording instead of state.
 *
 * The visual language is fixed: a dot plus a word, accent-coloured when the thing
 * is publicly visible and grey when it is not. Colour is never the only signal —
 * the word is always there — so it survives a monochrome screenshot and a
 * colour-blind reader.
 *
 * A **server** component: no hooks, no interactivity. It renders inside client
 * tables as well, which is fine — a server component used from a client
 * component is just a function returning JSX.
 */

export function StatusBadge({
  published,
  /** Adds a second badge when the row is also featured on the homepage. */
  featured,
}: Readonly<{ published: boolean; featured?: boolean }>) {
  return (
    <>
      <span
        className="adm-badge"
        data-state={published ? "published" : "draft"}
        /* The dot is decorative; the word carries the meaning, so nothing extra
           is needed for assistive tech. */
      >
        {published ? "live" : "draft"}
      </span>
      {featured ? (
        <span className="adm-badge" data-state="featured">
          featured
        </span>
      ) : null}
    </>
  );
}

/**
 * The same pill, for states that are not publish state.
 *
 * Used for contact-message status (`new` / `read` / `replied` / `archived` /
 * `spam`) and for a revoked ingest token. `tone` picks the colour; the caller
 * supplies the word, because these vocabularies belong to their own tables and
 * enumerating all of them here would make this file a registry of everything.
 */
export function Badge({
  children,
  tone = "neutral",
}: Readonly<{
  children: ReactNode;
  tone?: "neutral" | "published" | "featured" | "revoked";
}>) {
  return (
    <span className="adm-badge" data-state={tone === "neutral" ? undefined : tone}>
      {children}
    </span>
  );
}
