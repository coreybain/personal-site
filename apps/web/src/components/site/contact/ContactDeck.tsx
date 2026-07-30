import type { ReactNode } from "react";

import { DeckHead, Panel } from "@/components/site/Panel";
import { num } from "@/components/site/format";
import type { AiUsage, GitStats, Identity } from "@/lib/snapshot";

import { ContactForm } from "./ContactForm";
import type { ContactSubmitAction, ContactTransport } from "./transport";

/**
 * Deck zone. Above the horizon the page invites; below it, the page shows the
 * machinery — and the chrome names the machinery, whichever one is wired.
 *
 * With Convex configured that is `contactMessages.submit` through a Server
 * Action, and the panel says `Direct · stored`. Without it, it is the `mailto:`
 * builder it has always been, labelled as one. Neither label is decorative:
 * whether a message is *stored* is the one thing a reader deserves to be told
 * before they type into a box.
 *
 * The composer and the copy button in the hero are the only client leaves on
 * the page. Everything around them is server-rendered, and the values below all
 * arrive as props from the page's single `getSiteData()`.
 */
export function ContactDeck({
  identity,
  gitStats,
  aiUsage,
  projectCount,
  transport,
  action,
}: {
  identity: Identity;
  gitStats: GitStats;
  aiUsage: AiUsage;
  /** `snapshot.projects.length` — the deck prints the count, not the list. */
  projectCount: number;
  transport: ContactTransport;
  /** Forwarded to the composer. `null` on the mailto transport. */
  action: ContactSubmitAction | null;
}) {
  /** Directory — every value read from `identity`, none typed here. */
  const directory: { label: string; value: ReactNode }[] = [
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
  const correspondent = [
    { label: "Contrib · 12 mo", value: num(gitStats.totalContributionsYear) },
    { label: "Agent sessions", value: num(aiUsage.totalSessions) },
    { label: "Platforms", value: String(projectCount) },
  ];

  const direct = transport === "convex";

  return (
    <section id="compose" className="scroll-mt-20">
      <DeckHead
        index="02"
        title="Compose"
        meta={`Transport · ${direct ? "convex" : "mailto"}`}
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:gap-5">
        <Panel
          label="Message composer"
          meta={direct ? "Direct · stored" : "Draft · local"}
          delay={60}
        >
          <ContactForm email={identity.email} action={action} />
        </Panel>

        <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-1 lg:gap-5">
          <Panel label="Directory" meta="Static" delay={120}>
            <dl>
              {directory.map((row) => (
                <div key={row.label} className="hor-row">
                  <dt className="hor-label">{row.label}</dt>
                  <dd className="hor-body contact-val">{row.value}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel label="Correspondent" meta="Snapshot" delay={180}>
            <dl className="grid grid-cols-3 gap-3">
              {correspondent.map((item) => (
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
