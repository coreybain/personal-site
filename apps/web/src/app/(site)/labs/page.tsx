import type { Metadata } from "next";

import { Boundary } from "@/components/site/Boundary";
import { num, stampTime } from "@/components/site/format";
import { FeaturedLabs } from "@/components/site/labs/FeaturedLabs";
import { LabWall } from "@/components/site/labs/LabWall";
import { LabsCoda } from "@/components/site/labs/LabsCoda";
import { LabsIntro } from "@/components/site/labs/LabsIntro";
import { RecencyWindow } from "@/components/site/labs/RecencyWindow";
import { getSiteData } from "@/lib/data";
import { deriveLabs } from "@/lib/derive";

import "./labs.css";

/**
 * /labs — the personal repositories.
 *
 * Same three-material rhythm as the homepage, weighted differently: the sky
 * opening is one short paragraph whose only job is to separate this page from
 * the client work, and then the page spends almost all of itself below the
 * horizon, as a telemetry wall.
 *
 * Server component end to end; every number comes from Convex by way of
 * `@/lib/data` and is reduced by `deriveLabs()`. The snapshot is read **once**,
 * here, and passed down as props;
 * nothing below this function fetches. Colour is `--hor-*` only, so both themes
 * are handled by the two THEME blocks in horizon.css.
 */

/**
 * ISR, five minutes — the same window every `(site)` page declares. Written as a
 * literal because Next requires this value to be statically analysable; see the
 * ISR section of `@/lib/data`'s header for why 300 and why an uncached Convex
 * `fetch` still prerenders.
 */
export const revalidate = 300;

/**
 * `generateMetadata` rather than a `metadata` constant: the description quotes
 * the freshest push, and a module-scope object is built once per process.
 *
 * `getSiteData()` is wrapped in React's `cache()` and metadata generation shares
 * a request scope with the render below, so this is the same six queries — not
 * twelve.
 *
 * The title is bare: the "— Corey Baines" suffix comes from the `(site)`
 * layout's `title.template`, once, from live identity.
 */
export async function generateMetadata(): Promise<Metadata> {
  const snapshot = await getSiteData();
  if (snapshot.labs.length === 0) {
    return {
      title: "Labs",
      description: `No personal repositories are currently published for ${snapshot.identity.name}.`,
      alternates: { canonical: "/labs" },
    };
  }

  const { labs } = deriveLabs(snapshot.labs);

  return {
    title: "Labs",
    description: `${snapshot.gitStats.publicRepoCount} active repositories and ${num(
      snapshot.gitStats.publicCommits,
    )} public commits in the last 12 months, from ${snapshot.gitStats.totalPublicRepoCount} public repositories on ${snapshot.identity.name}'s GitHub account. ${labs.length} selected Labs are written up here.`,
    alternates: { canonical: "/labs" },
  };
}

export default async function LabsPage() {
  const snapshot = await getSiteData();

  if (snapshot.labs.length === 0) {
    return (
      <main>
        <section className="hor-sky">
          <div className="hor-wash" aria-hidden="true" />
          <div className="hor-shell">
            <header className="pt-24 pb-14 sm:pt-28 sm:pb-16 lg:pt-32 lg:pb-20">
              <span className="hor-eyebrow">Personal work</span>
              <h1 className="hor-display mt-8 sm:mt-10">Labs</h1>
              <p className="hor-lede mt-7 max-w-[52ch] text-pretty">
                No repositories are currently published in the live Labs collection.
                New entries will appear here automatically after they are published.
              </p>
              <div className="mt-12 sm:mt-14">
                <div className="hor-rule" />
                <dl className="pt-7">
                  <div className="flex flex-col-reverse">
                    <dt className="hor-eyebrow mt-2.5">Published repositories</dt>
                    <dd className="hor-stat-sky">0</dd>
                  </div>
                </dl>
              </div>
            </header>
          </div>
        </section>

        <Boundary label={`Labs · ${stampTime(snapshot.computedAt)}`} />

        <div className="hor-deck-zone">
          <div className="hor-deck-grid" aria-hidden="true" />
          <div className="hor-shell pb-16 sm:pb-20">
            <div className="hor-panel p-6 sm:p-8">
              <span className="hor-label">Live collection</span>
              <p className="hor-body mt-3 max-w-[52ch]">
                This empty state is the current Convex result; no fixture repositories
                are being substituted.
              </p>
            </div>
          </div>
        </div>
      </main>
    );
  }

  const derived = deriveLabs(snapshot.labs);

  return (
    <main>
      {/* ── above the horizon: what these are ─────────────────────── */}
      <section className="hor-sky">
        <div className="hor-wash" aria-hidden="true" />
        <div className="hor-shell">
          <LabsIntro
            identity={snapshot.identity}
            gitStats={snapshot.gitStats}
            {...derived}
          />
        </div>
      </section>

      <Boundary label={`Labs · ${stampTime(snapshot.computedAt)}`} />

      {/* ── below the horizon: the wall ───────────────────────────── */}
      <div className="hor-deck-zone">
        <div className="hor-deck-grid" aria-hidden="true" />
        <div className="hor-shell pb-16 sm:pb-20">
          <RecencyWindow {...derived} />
          <FeaturedLabs {...derived} />
          <LabWall {...derived} />
        </div>
      </div>

      <Boundary direction="out" />

      {/* ── surfacing again for the closing note ──────────────────── */}
      <section className="hor-sky">
        <div className="hor-shell">
          <LabsCoda
            identity={snapshot.identity}
            gitStats={snapshot.gitStats}
            {...derived}
          />
        </div>
      </section>
    </main>
  );
}
