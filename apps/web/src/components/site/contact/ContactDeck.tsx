import type { ReactNode } from "react";

import { DeckHead, Panel } from "@/components/site/Panel";
import { num } from "@/components/site/format";
import { snapshot } from "@/lib/snapshot";

import { ContactForm } from "./ContactForm";

const { identity, gitStats, aiUsage, projects } = snapshot;

/** Static directory — every value is read from `identity`, none is typed here. */
const DIRECTORY: { label: string; value: ReactNode }[] = [
  { label: "Open to", value: identity.availability },
  {
    label: "Email",
    value: (
      <a className="hor-link hor-mono" href={`mailto:${identity.email}`}>
        {identity.email}
      </a>
    ),
  },
  {
    label: "GitHub",
    value: (
      <a
        className="hor-link hor-mono"
        href={`https://github.com/${identity.github}`}
        rel="noreferrer noopener"
      >
        {identity.github}
      </a>
    ),
  },
  { label: "Based", value: identity.location },
  { label: "Role", value: `${identity.role} · ${identity.company}` },
];

/** Who is on the other end, in the deck's own units. */
const CORRESPONDENT = [
  { label: "Contrib · 12 mo", value: num(gitStats.totalContributionsYear) },
  { label: "Agent sessions", value: num(aiUsage.totalSessions) },
  { label: "Platforms", value: String(projects.length) },
];

/**
 * Deck zone. Above the horizon the page invites; below it, the page shows the
 * machinery — and the machinery is a `mailto:` builder, labelled as one.
 *
 * The composer and the copy button in the hero are the only client leaves on
 * the page. Everything around them is server-rendered.
 */
export function ContactDeck() {
  return (
    <section id="compose" className="scroll-mt-20">
      <DeckHead index="02" title="Compose" meta="Transport · mailto" />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:gap-5">
        <Panel label="Message composer" meta="Draft · local" delay={60}>
          <ContactForm email={identity.email} />
        </Panel>

        <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-1 lg:gap-5">
          <Panel label="Directory" meta="Static" delay={120}>
            <dl>
              {DIRECTORY.map((row) => (
                <div key={row.label} className="hor-row">
                  <dt className="hor-label">{row.label}</dt>
                  <dd className="hor-body contact-val">{row.value}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel label="Correspondent" meta="Snapshot" delay={180}>
            <dl className="grid grid-cols-3 gap-3">
              {CORRESPONDENT.map((item) => (
                <div key={item.label} className="flex flex-col-reverse">
                  <dt className="hor-label mt-2">{item.label}</dt>
                  <dd className="hor-readout-sm">{item.value}</dd>
                </div>
              ))}
            </dl>
            <p className="hor-micro mt-5 border-t border-[var(--hor-line-soft)] pt-3.5">
              The same three numbers the homepage opens with, read from the same
              snapshot. Measured, not claimed.
            </p>
          </Panel>
        </div>
      </div>
    </section>
  );
}
