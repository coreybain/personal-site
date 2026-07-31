import Link from "next/link";

import type { Identity } from "@/lib/snapshot";

/**
 * Closing sky zone. The boundaries of the thing, stated plainly.
 *
 * Server-rendered. Two lists rather than a paragraph, because "what it will not
 * do" is the half readers actually need and burying it in prose is how a demo
 * quietly over-promises. Everything asserted here is enforced somewhere real:
 *
 *   the corpus       `knowledge.ts` indexes published rows only, and only their
 *                    rendered text (ADR 008)
 *   the citations    `ask.retrieve` returns site-relative URLs; the chips are
 *                    those URLs and nothing else
 *   the limit        `lib/rateLimit.ts`, 10 questions an hour per visitor
 *   no history       nothing is stored: no thread, no transcript, no cookie
 */
export function AskGround({ identity }: { identity: Identity }) {
  return (
    <section className="pb-20 pt-14 sm:pb-24 sm:pt-16">
      <div className="hor-sec-head">
        <span className="hor-sec-idx">03</span>
        <span className="hor-sec-title">Ground rules</span>
        <span className="hor-sec-rule" aria-hidden="true" />
      </div>

      <div className="ask-ground">
        <div>
          <span className="hor-eyebrow">What it answers from</span>
          <ul className="ask-ground-list">
            <li>
              Case studies on{" "}
              <Link className="hor-link" href="/work">
                /work
              </Link>{" "}
              — the problem, the approach, the outcomes as written.
            </li>
            <li>
              The{" "}
              <Link className="hor-link" href="/labs">
                labs
              </Link>{" "}
              and anything published to{" "}
              <Link className="hor-link" href="/blog">
                the writing
              </Link>
              .
            </li>
            <li>
              The{" "}
              <Link className="hor-link" href="/resume">
                resume
              </Link>{" "}
              — roles, dates, capabilities, in the words on that page.
            </li>
          </ul>
        </div>

        <div>
          <span className="hor-eyebrow">What it will not do</span>
          <ul className="ask-ground-list">
            <li>
              Quote anything private. Client repositories, internal documents
              and agent transcripts are not indexed and have no field to arrive
              in.
            </li>
            <li>
              Answer for {identity.name.split(" ")[0]} on rates, availability or
              anything that needs a commitment — that is{" "}
              <Link className="hor-link" href="/contact">
                a message to a person
              </Link>
              .
            </li>
            <li>
              Remember you. No transcript is stored, no account exists, and
              closing the tab ends it. Questions are metered per visitor by a
              salted digest, never a stored address.
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
