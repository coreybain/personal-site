import type { Metadata } from "next";

import { Boundary } from "@/components/site/Boundary";
import { num, stampTime } from "@/components/site/format";
import { Capabilities } from "@/components/site/resume/Capabilities";
import { Education } from "@/components/site/resume/Education";
import { Experience } from "@/components/site/resume/Experience";
import { LiveSignal } from "@/components/site/resume/LiveSignal";
import { ResumeHeader } from "@/components/site/resume/ResumeHeader";
import { ProfileJsonLd } from "@/components/site/seo";
import { getSiteData } from "@/lib/data";
import { deriveResume } from "@/lib/derive";

import "./resume.css";

/**
 * ISR, five minutes — the literal, not an import. See the ISR section of
 * `@/lib/data`'s header for the reasoning behind the number.
 */
export const revalidate = 300;

/**
 * The description quotes live telemetry, so it is generated per render rather
 * than frozen in a module-scope `metadata` const. Shares the page's queries:
 * `getSiteData()` is `cache()`d, so this is not a second read.
 *
 * The title carries the role but **not** the name: the `(site)` layout's
 * `title.template` appends "— Corey Baines", so this resolves to
 * "Résumé, Principal Engineer — Corey Baines". The role stays here rather than
 * moving into the template because it is true of this page in a way it is not
 * true of /fun.
 */
export async function generateMetadata(): Promise<Metadata> {
  const site = await getSiteData();
  const { identity, gitStats, aiUsage, computedAt } = site;
  const { yearsShipping } = deriveResume(site);

  return {
    title: `Résumé, ${identity.role}`,
    description: `${identity.role} in ${identity.location}, ${yearsShipping} years shipping platforms. ${num(
      gitStats.totalContributionsYear,
    )} contributions and ${num(
      aiUsage.totalSessions,
    )} agent sessions in the last 12 months, read live from the snapshot of ${stampTime(
      computedAt,
    )}.`,
    alternates: { canonical: "/resume" },
  };
}

/**
 * /resume — a print-clean document that is also a Horizon page.
 *
 * Same zone structure as the homepage, for the same reason: sky for the human
 * parts (who this is, what the work was), deck for the measured parts. The live
 * signal section below the horizon is what a PDF cannot do — it is stamped, it
 * says where each number came from, and it changes when the snapshot does.
 *
 * `resumeDocument.embedGitStats` is the contract switch: when it is false the
 * telemetry deck is not rendered at all and the document stays a document.
 *
 * Server component end to end. **One read**: `getSiteData()` is called once
 * here, reduced once by `deriveResume()`, and both results are passed down as
 * props — nothing under this page fetches or imports the snapshot. The print
 * stylesheet lives in `resume.css` and hides the shared nav and footer without
 * touching them.
 */
export default async function ResumePage() {
  const site = await getSiteData();
  const { identity, gitStats, aiUsage, resumeDocument, computedAt } = site;
  const derived = deriveResume(site);

  return (
    <main className="res-doc">
      {/* ProfilePage wrapping the Person, with `dateModified` taken from the
          same `computedAt` the live-signal header prints — ADR 012's claim that
          this document is provably current, made machine readable. Rendered
          server-side from data this page already holds. */}
      <ProfileJsonLd
        identity={identity}
        gitStats={gitStats}
        aiUsage={aiUsage}
        capabilities={resumeDocument.capabilities}
        yearsShipping={derived.yearsShipping}
        computedAt={computedAt}
      />

      {/* ── above the horizon: the document ───────────────────────── */}
      <section className="hor-sky">
        <div className="hor-wash" aria-hidden="true" />
        <div className="hor-shell">
          <ResumeHeader
            identity={identity}
            summary={resumeDocument.summary}
            companyCount={derived.companyCount}
            yearsShipping={derived.yearsShipping}
            computedAt={computedAt}
          />
        </div>
      </section>

      {/* ── below the horizon: the evidence ───────────────────────── */}
      {resumeDocument.embedGitStats ? (
        <>
          <Boundary label={`Live signal · ${stampTime(computedAt)}`} />

          <div className="hor-deck-zone">
            <div className="hor-deck-grid" aria-hidden="true" />
            <div className="hor-shell pb-16 sm:pb-20">
              <LiveSignal
                gitStats={gitStats}
                aiUsage={aiUsage}
                embedGitStats={resumeDocument.embedGitStats}
                computedAt={computedAt}
                derived={derived}
              />
            </div>
          </div>

          <Boundary direction="out" />
        </>
      ) : null}

      {/* ── back above the horizon: the record ────────────────────── */}
      <section className="hor-sky">
        <div className="hor-shell">
          <Experience
            experience={resumeDocument.experience}
            companyCount={derived.companyCount}
            yearsShipping={derived.yearsShipping}
            tenureYears={derived.tenureYears}
          />
          <Capabilities
            languages={gitStats.languages}
            capabilities={resumeDocument.capabilities}
          />
          <Education
            identity={identity}
            education={resumeDocument.education}
            computedAt={computedAt}
          />
        </div>
      </section>
    </main>
  );
}
