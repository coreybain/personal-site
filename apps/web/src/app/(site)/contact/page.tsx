import type { Metadata } from "next";

import { Boundary } from "@/components/site/Boundary";
import { ContactDeck } from "@/components/site/contact/ContactDeck";
import { ContactHero } from "@/components/site/contact/ContactHero";
import { ContactTopics } from "@/components/site/contact/ContactTopics";
import { stampTime } from "@/components/site/format";
import { snapshot } from "@/lib/snapshot";

import "./contact.css";

const { identity } = snapshot;

export const metadata: Metadata = {
  title: `Contact — ${identity.name}`,
  description: `${identity.availability}. Write to ${identity.name}, ${identity.role} at ${identity.company} in ${identity.location} — principal roles and hard platform problems both welcome. Email ${identity.email}.`,
};

/**
 * /contact — one focused page, in the site's own zone grammar.
 *
 *   SKY   the invitation and the address, set as display type. The address is
 *         the primary action; the form is the convenience.
 *   DECK  the composer, drawn as an instrument panel because that is what it
 *         is: a `mailto:` builder with its transport printed on the chrome.
 *   SKY   what to write about, and the ground it can cover.
 *
 * Server-rendered end to end apart from two small client leaves in
 * `components/site/contact` — the composer and the copy-to-clipboard button.
 * Nothing on this page stores a message or claims to have sent one.
 */
export default function ContactPage() {
  return (
    <main>
      <section className="hor-sky">
        <div className="hor-wash" aria-hidden="true" />
        <div className="hor-shell">
          <ContactHero />
        </div>
      </section>

      <Boundary label={`Message relay · ${stampTime(snapshot.computedAt)}`} />

      <div className="hor-deck-zone">
        <div className="hor-deck-grid" aria-hidden="true" />
        <div className="hor-shell pb-16 sm:pb-20">
          <ContactDeck />
        </div>
      </div>

      <Boundary direction="out" />

      <section className="hor-sky">
        <div className="hor-shell">
          <ContactTopics />
        </div>
      </section>
    </main>
  );
}
