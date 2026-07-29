import type { Metadata } from "next";

import { Boundary } from "@/components/site/Boundary";
import { num, stampTime } from "@/components/site/format";
import { Capabilities } from "@/components/site/resume/Capabilities";
import { Education } from "@/components/site/resume/Education";
import { Experience } from "@/components/site/resume/Experience";
import { LiveSignal } from "@/components/site/resume/LiveSignal";
import { ResumeHeader } from "@/components/site/resume/ResumeHeader";
import {
  aiUsage,
  computedAt,
  gitStats,
  identity,
  resumeDocument,
  yearsShipping,
} from "@/components/site/resume/data";

import "./resume.css";

export const metadata: Metadata = {
  title: `Résumé — ${identity.name}, ${identity.role}`,
  description: `${identity.role} in ${identity.location}, ${yearsShipping} years shipping platforms. ${num(
    gitStats.totalContributionsYear,
  )} contributions and ${num(
    aiUsage.totalSessions,
  )} agent sessions in the last 12 months, read live from the snapshot of ${stampTime(
    computedAt,
  )}.`,
};

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
 * Server component end to end. Every number comes from `@/lib/snapshot` via
 * `resume/data.ts`; the prose is draft copy. The print stylesheet lives in
 * `resume.css` and hides the shared nav and footer without touching them.
 */
export default function ResumePage() {
  return (
    <main className="res-doc">
      {/* ── above the horizon: the document ───────────────────────── */}
      <section className="hor-sky">
        <div className="hor-wash" aria-hidden="true" />
        <div className="hor-shell">
          <ResumeHeader />
        </div>
      </section>

      {/* ── below the horizon: the evidence ───────────────────────── */}
      {resumeDocument.embedGitStats ? (
        <>
          <Boundary label={`Live signal · ${stampTime(computedAt)}`} />

          <div className="hor-deck-zone">
            <div className="hor-deck-grid" aria-hidden="true" />
            <div className="hor-shell pb-16 sm:pb-20">
              <LiveSignal />
            </div>
          </div>

          <Boundary direction="out" />
        </>
      ) : null}

      {/* ── back above the horizon: the record ────────────────────── */}
      <section className="hor-sky">
        <div className="hor-shell">
          <Experience />
          <Capabilities />
          <Education />
        </div>
      </section>
    </main>
  );
}
