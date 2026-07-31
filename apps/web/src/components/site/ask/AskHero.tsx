import type { CSSProperties } from "react";

import type { Identity } from "@/lib/snapshot";

function delay(ms: number): CSSProperties {
  return { "--hor-delay": `${ms}ms` } as CSSProperties;
}

/**
 * Sky zone. What this page is, before anyone types anything.
 *
 * Server-rendered, no JavaScript — the island below the horizon is the whole
 * client cost of this route, and the part of the page that explains itself has
 * no business being in that bundle.
 *
 * The copy has one job beyond welcome: **set the expectation that this is
 * retrieval, not a persona.** Ask Corey answers from pages that are published
 * on this site and shows which ones. It is not Corey, it does not know anything
 * private (ADR 008: only text already rendered on a public page is ever
 * indexed), and it says so before it is asked.
 *
 * The counts are the real corpus, read live: they are the same rows `/work`,
 * `/labs` and `/blog` render, which is exactly what `knowledge.ts` indexes on
 * publish. A number here that did not match the site would be the first lie the
 * page told.
 */
export function AskHero({
  identity,
  projectCount,
  labCount,
  postCount,
}: {
  identity: Identity;
  projectCount: number;
  labCount: number;
  postCount: number;
}) {
  /** Only sections with something in them are claimed. */
  const corpus = [
    projectCount > 0
      ? `${projectCount} case ${projectCount === 1 ? "study" : "studies"}`
      : null,
    labCount > 0 ? `${labCount} ${labCount === 1 ? "lab" : "labs"}` : null,
    postCount > 0 ? `${postCount} ${postCount === 1 ? "post" : "posts"}` : null,
  ].filter((entry): entry is string => entry !== null);

  return (
    <header className="pt-24 pb-14 sm:pt-28 sm:pb-16 lg:pt-36 lg:pb-20">
      <div className="hor-rise" style={delay(40)}>
        <span className="hor-pill">
          <span className="hor-live" aria-hidden="true" />
          Grounded in this site, and cited
        </span>
      </div>

      <h1
        className="ask-display hor-rise mt-8 text-balance sm:mt-10"
        style={delay(110)}
      >
        Ask about the work.
      </h1>

      <p
        className="hor-lede hor-rise mt-6 max-w-[58ch] text-pretty"
        style={delay(180)}
      >
        A question goes to a retrieval step over everything published here — the
        case studies, the labs, the writing, the resume — and the answer comes
        back with the pages it was drawn from, numbered, as links you can open.
      </p>

      <p
        className="hor-body hor-rise mt-4 max-w-[58ch] text-pretty"
        style={delay(210)}
      >
        It is not {identity.name.split(" ")[0]}, and it does not know anything
        that is not on this site. Nothing private is indexed: the corpus is
        built from the same text these pages render, so anything it can quote
        you could have read yourself. When it has no source, it says so instead
        of filling the gap.
      </p>

      {corpus.length > 0 ? (
        <p className="hor-micro hor-rise mt-6" style={delay(240)}>
          <span className="hor-label">Corpus</span>{" "}
          <span className="ask-corpus">{corpus.join(" · ")}</span>
        </p>
      ) : null}
    </header>
  );
}
