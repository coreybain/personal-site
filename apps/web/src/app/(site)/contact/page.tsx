import type { Metadata } from "next";

import { Boundary } from "@/components/site/Boundary";
import { ContactDeck } from "@/components/site/contact/ContactDeck";
import { ContactHero } from "@/components/site/contact/ContactHero";
import { ContactTopics } from "@/components/site/contact/ContactTopics";
import type { ContactTransport } from "@/components/site/contact/transport";
import { stampTime } from "@/components/site/format";
import { getSiteData } from "@/lib/data";

import { submitContactMessage } from "./actions";

/**
 * ISR, five minutes — the literal, not an import. See the ISR section of
 * `@/lib/data`'s header. It matters more here than elsewhere: the availability
 * pill at the top of this page is the line `siteSettings.setAvailability`
 * changes in one tap, and five minutes is how long "I have accepted an offer"
 * can look untrue.
 *
 * The Server Action below is unaffected — a Server Action is a POST to the route
 * and is never served from the prerendered HTML.
 */
export const revalidate = 300;

/**
 * Which transport the composer gets, decided here on the server.
 *
 * The check is deliberately in the page rather than in the form: reading
 * `NEXT_PUBLIC_CONVEX_URL` from a `"use client"` module would inline the
 * deployment URL into the public JS bundle. The client component is told the
 * answer instead, and cannot ask the question.
 *
 * Zero-env is the fallback, not an error state — no Convex means the page
 * renders precisely the `mailto:` composer it always has.
 */
const TRANSPORT: ContactTransport = process.env.NEXT_PUBLIC_CONVEX_URL
  ? "convex"
  : "mailto";

/**
 * Availability and the correspondent's figures are both live, so the
 * description is generated per render. `getSiteData()` is `cache()`d — this
 * shares the page's one round of queries rather than adding a second.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { identity } = await getSiteData();

  return {
    // Bare — the `(site)` layout's `title.template` supplies "— Corey Baines".
    title: "Contact",
    description: `${identity.availabilityVisible ? `${identity.availability}. ` : ""}Write to ${identity.name}, ${identity.role} at ${identity.company} in ${identity.location} — principal roles and hard platform problems both welcome. Email ${identity.email}.`,
    alternates: { canonical: "/contact" },
  };
}

/**
 * /contact — one focused page, in the site's own zone grammar.
 *
 *   SKY   the invitation and the address, set as display type. The address is
 *         the primary action; the form is the convenience.
 *   DECK  the composer, drawn as an instrument panel because that is what it
 *         is — and the chrome names its transport.
 *   SKY   what to write about, and the ground it can cover.
 *
 * Server-rendered end to end apart from two small client leaves in
 * `components/site/contact` — the composer and the copy-to-clipboard button.
 * **One read**: `getSiteData()` is called once here and passed down as props.
 *
 * ── What changed with the backend ──────────────────────────────────────────
 *
 * The composer used to build a `mailto:` and say so. With Convex configured it
 * now calls `submitContactMessage` — a Server Action wrapping the one public
 * mutation in `packages/convex` — and the message becomes a row in the admin
 * inbox. The Server Action is imported here and passed down, so the route owns
 * the wiring and `components/site/contact` stays a folder of components.
 *
 * Without Convex the action is not passed at all and the old behaviour stands,
 * unchanged and unclaimed. The email address in the hero is untouched either
 * way: it was always the primary action and it still is.
 */
export default async function ContactPage() {
  const { identity, gitStats, aiUsage, projects, resumeDocument, computedAt } =
    await getSiteData();

  return (
    <main>
      <section className="hor-sky">
        <div className="hor-wash" aria-hidden="true" />
        <div className="hor-shell">
          <ContactHero identity={identity} />
        </div>
      </section>

      <Boundary label={`Message relay · ${stampTime(computedAt)}`} />

      <div className="hor-deck-zone">
        <div className="hor-deck-grid" aria-hidden="true" />
        <div className="hor-shell pb-16 sm:pb-20">
          <ContactDeck
            identity={identity}
            gitStats={gitStats}
            aiUsage={aiUsage}
            projectCount={projects.length}
            transport={TRANSPORT}
            action={TRANSPORT === "convex" ? submitContactMessage : null}
          />
        </div>
      </div>

      <Boundary direction="out" />

      <section className="hor-sky">
        <div className="hor-shell">
          <ContactTopics
            identity={identity}
            aiUsage={aiUsage}
            projectCount={projects.length}
            capabilities={resumeDocument.capabilities}
          />
        </div>
      </section>
    </main>
  );
}
