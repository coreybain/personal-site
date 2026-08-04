import Image from "next/image";
import type { CSSProperties } from "react";

import { DeckHead } from "@/components/site/Panel";
import type { LabsDerived } from "@/lib/derive";
import { activePhrase, band, cadence, repoUrl } from "@/lib/derive";
import type { Lab } from "@/lib/snapshot";

/**
 * Featured builds — the two labs that have a real product capture behind them.
 *
 * ── Why this is a hand-written spec keyed by slug ──────────────────────────
 *
 * Everything here that is *not* telemetry — the screenshot, its alt text, the
 * live URL, the write-up, the stack chips — has no home in the `Lab` contract.
 * The Convex row carries a `coverImage`, but `Lab` does not model it and this
 * page needs five more fields besides, so the editorial half of a plate stays
 * in this file and is joined to the fetched lab by slug.
 *
 * ── The join is a filter, not an assertion ─────────────────────────────────
 *
 * It used to throw when a slug was missing, which was correct against a frozen
 * mock that always contained `boca` and `home`. Against Convex it is a hard
 * crash on /labs the moment a repo is unpublished or renamed — a page that is
 * 95% telemetry taken down by two screenshots. So a plate whose lab is absent
 * is dropped, and the section disappears entirely when none survive. The list
 * order is this spec's order, not the wall's recency order, because these are
 * curated write-ups rather than a ranking.
 */

/** The editorial half of a plate: everything the `Lab` contract has no field for. */
type FeaturedSpec = {
  slug: string;
  image: string;
  imageAlt: string;
  capture: string;
  liveUrl: string;
  liveLabel: string;
  eyebrow: string;
  writeup: string;
  stack: string[];
};

/** A spec joined to the lab it describes. */
type FeaturedBuild = FeaturedSpec & { lab: Lab };

const FEATURED_SPECS: FeaturedSpec[] = [
  {
    slug: "boca",
    image: "/images/labs/boca-home.png",
    imageAlt:
      "Boca dos Parafusos homepage with product search, retail navigation and a hardware-focused hero.",
    capture: "Public storefront / home · 1280 × 720",
    liveUrl: "https://www.bocadosparafusos.com.br",
    liveLabel: "bocadosparafusos.com.br",
    eyebrow: "Independent build · catalogue + quoting",
    writeup:
      "A complete catalogue and quote workflow for a Niterói hardware retailer. I am replacing scattered product discovery and WhatsApp hand-offs with structured search, customer lists, quote carts, multi-location inventory and one operating surface for the team behind it.",
    stack: ["Next.js", "Convex", "TypeScript", "Better Auth"],
  },
  {
    slug: "home",
    image: "/images/labs/coreybaines-home.png",
    imageAlt:
      "Corey Baines homepage showing the profile hero, identity card and floating navigation.",
    capture: "Production site / home · 1280 × 720",
    liveUrl: "https://coreybaines.com",
    liveLabel: "coreybaines.com",
    eyebrow: "Solo build · telemetry + publishing",
    writeup:
      "A personal site built from one typed live-data contract. It turns Git activity, agent usage, project case studies, side-project data and publishing into a measured portfolio with browser and native administration behind it.",
    stack: ["Next.js", "TypeScript", "Bun", "Turborepo"],
  },
];

function ArrowOut() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path
        d="M3 7L7 3M7 3H3.6M7 3v3.4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FeaturedBuildPlate({
  build,
  index,
}: {
  build: FeaturedBuild;
  index: number;
}) {
  const { lab } = build;
  const titleId = `featured-lab-${lab.slug}`;

  return (
    <article
      className="hor-panel hor-rise labs-feature"
      style={{ "--hor-delay": `${80 + index * 90}ms` } as CSSProperties}
      data-reverse={index % 2 === 1 ? "true" : undefined}
      aria-labelledby={titleId}
    >
      <header className="hor-panel-head">
        <span className="hor-label">Capture · {String(index + 1).padStart(2, "0")}</span>
        <a
          className="hor-link labs-feature-link"
          href={build.liveUrl}
          target="_blank"
          rel="noreferrer noopener"
        >
          {build.liveLabel}
          <ArrowOut />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </header>

      <div className="labs-feature-layout">
        <figure className="labs-feature-capture">
          <Image
            src={build.image}
            alt={build.imageAlt}
            fill
            sizes="(min-width: 1024px) 54vw, 100vw"
            className="labs-feature-image"
          />
          <span className="labs-feature-grid" aria-hidden="true" />
          <figcaption className="labs-feature-caption">{build.capture}</figcaption>
        </figure>

        <div className="labs-feature-copy">
          <div>
            <span className="hor-label">{build.eyebrow}</span>
            <h3 id={titleId} className="hor-h2 mt-3">
              {lab.title}
            </h3>
            <p className="hor-body labs-feature-writeup mt-4 text-pretty">
              {build.writeup}
            </p>

            <ul className="mt-5 flex flex-wrap gap-1.5" aria-label={`${lab.title} stack`}>
              {build.stack.map((technology) => (
                <li key={technology} className="hor-chip">
                  {technology}
                </li>
              ))}
            </ul>
          </div>

          <div className="labs-feature-readouts">
            <div className="labs-feature-readout">
              <span className="hor-label flex items-center gap-2">
                <i
                  className={`labs-seed labs-band-${band(lab.liveStats.lastPushDaysAgo)}`}
                  aria-hidden="true"
                />
                Last push
              </span>
              <div className="hor-readout-sm mt-2">
                {lab.liveStats.lastPushDaysAgo === 0
                  ? "Today"
                  : `${lab.liveStats.lastPushDaysAgo}d`}
              </div>
              <p className="hor-micro mt-1">{activePhrase(lab.liveStats.lastPushDaysAgo)}</p>
            </div>

            <div className="labs-feature-readout">
              <span className="hor-label">Cadence</span>
              <div className="hor-readout-sm mt-2">{cadence(lab).toFixed(1)}</div>
              <p className="hor-micro mt-1">commits a week</p>
            </div>
          </div>

          <a
            className="hor-link labs-feature-repo"
            href={repoUrl(lab)}
            target="_blank"
            rel="noreferrer noopener"
          >
            View the repository
            <ArrowOut />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
      </div>
    </article>
  );
}

export function FeaturedLabs({ labs }: Pick<LabsDerived, "labs">) {
  const builds: FeaturedBuild[] = FEATURED_SPECS.flatMap((spec) => {
    const lab = labs.find((candidate) => candidate.slug === spec.slug);
    return lab ? [{ ...spec, lab }] : [];
  });

  if (builds.length === 0) return null;

  return (
    <section id="featured-builds" className="mt-14 scroll-mt-20 sm:mt-16">
      <DeckHead
        index="02"
        title="Featured builds"
        meta={`${builds.length} projects · real product captures`}
      />

      <div className="labs-feature-list">
        {builds.map((build, index) => (
          <FeaturedBuildPlate key={build.lab.slug} build={build} index={index} />
        ))}
      </div>
    </section>
  );
}
