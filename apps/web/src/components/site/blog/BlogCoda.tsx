import Link from "next/link";

import { num } from "@/components/site/format";
import { countWord } from "@/lib/derive";
import type { GitStats } from "@/lib/snapshot";

/**
 * Sky zone, in the slot `<PostGrid>` occupies once there is something to put in
 * it. The close of an empty blog.
 *
 * ── Why an empty page still gets two zones ─────────────────────────────────
 *
 * The deck states the fact — an instrument reading `00`, with the reason. This
 * says where to go instead, and it is the half that keeps the empty state from
 * reading as a dead end. They are not the same statement twice: one is a
 * measurement, the other is a redirect, and splitting them is what lets the
 * measurement stay a single unapologetic line.
 *
 * The numbers are real, from the same read the rest of the page used. That is
 * the point of putting them here: the argument being made is "the writing is
 * absent, the work is not", and it is a stronger argument with a figure attached
 * than without one.
 *
 * Modelled on /fun's sign-off — a rule, one honest paragraph, and a way out.
 */
export function BlogCoda({
  gitStats,
  projectCount,
}: {
  gitStats: GitStats;
  projectCount: number;
}) {
  return (
    <section className="pt-16 pb-16 sm:pt-20 sm:pb-20 lg:pt-20">
      <div className="hor-rule" />

      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-6 pt-8 sm:pt-10">
        <p className="hor-lede max-w-[54ch] text-pretty">
          Until there is something here worth your time, the arguments are on the
          work: {countWord(projectCount).toLowerCase()} production platforms
          written up in full, and{" "}
          {num(gitStats.totalContributionsYear)} contributions in the last twelve
          months behind them.
        </p>

        <div className="flex flex-wrap items-center gap-x-7 gap-y-3">
          <Link href="/work" className="hor-btn">
            Read the case studies
          </Link>
          <Link href="/labs" className="hor-link text-[13px] font-medium">
            Personal builds
          </Link>
        </div>
      </div>
    </section>
  );
}
