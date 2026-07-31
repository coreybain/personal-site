import type { CSSProperties } from "react";

import { longDate } from "@/components/site/format";
import type { BlogDerived } from "@/lib/derive";
import { countWord } from "@/lib/derive";
import type { Identity } from "@/lib/snapshot";

import { dayOf } from "./meta";

/**
 * Sky zone. The head of /blog.
 *
 * Same opening as /work and /labs — one wash, quiet display type, sans numerals
 * — and the same three-figure skyline before the horizon, *when there is
 * anything to count*. On an empty blog the skyline is omitted rather than
 * printed as three zeroes: the deck below states the zero once, deliberately and
 * in the instrument face, and repeating it up here would turn one honest fact
 * into a page that keeps apologising.
 *
 * The lede changes with the state and nothing else does. Both versions say the
 * same thing about what this section is for; only the tense moves.
 *
 * Prop-fed from the page's single read. `Pick<BlogDerived, …>` names exactly
 * which derived figures are used, so the page can spread `{...deriveBlog(posts)}`
 * and this signature still documents the dependency.
 */

type BlogIntroProps = {
  identity: Identity;
} & Pick<BlogDerived, "count" | "latest" | "tags" | "totalMinutes">;

function delay(ms: number): CSSProperties {
  return { "--hor-delay": `${ms}ms` } as CSSProperties;
}

export function BlogIntro({
  identity,
  count,
  latest,
  tags,
  totalMinutes,
}: BlogIntroProps) {
  const skyline =
    latest === null
      ? []
      : [
          { value: String(count), label: "Posts published" },
          { value: `${totalMinutes} min`, label: "Reading, end to end" },
          {
            value: String(tags.length),
            label: `Subjects across the ${countWord(count).toLowerCase()}`,
          },
        ];

  return (
    <header className="pt-24 pb-14 sm:pt-28 sm:pb-16 lg:pt-32 lg:pb-20">
      <div className="hor-rise" style={delay(40)}>
        <span className="hor-eyebrow">
          <span className="hor-mono">01</span>
          <span className="hor-tick" aria-hidden="true" />
          Writing
        </span>
      </div>

      <h1
        className="hor-display hor-rise mt-7 max-w-[15ch] text-balance sm:mt-9"
        style={delay(110)}
      >
        Working notes.
      </h1>

      <p
        className="hor-lede hor-rise mt-7 max-w-[62ch] text-pretty"
        style={delay(180)}
      >
        {latest === null ? (
          <>
            Where the notes go: the decisions behind the platforms on{" "}
            <span style={{ color: "var(--hor-ink)" }}>/work</span> that were hard
            to reverse, the ones that turned out wrong, and what the numbers on
            the rest of this site actually cost to collect. Nothing is published
            yet — the section is here because the plumbing is worth having in
            place before the writing is, not because it is about to fill up.
          </>
        ) : (
          <>
            {countWord(count)} {count === 1 ? "post" : "posts"} on the decisions
            behind the platforms on{" "}
            <span style={{ color: "var(--hor-ink)" }}>/work</span>: the ones that
            were hard to reverse, the ones that turned out wrong, and what the
            numbers on the rest of this site cost to collect. Written by{" "}
            {identity.name}, most recently on {longDate(dayOf(latest.publishedAt))}.
          </>
        )}
      </p>

      {skyline.length > 0 ? (
        <div className="hor-rise mt-12 sm:mt-14 lg:mt-16" style={delay(250)}>
          <div className="hor-rule" />
          <dl className="grid grid-cols-1 gap-y-7 pt-7 sm:grid-cols-3 sm:gap-x-8">
            {skyline.map((item) => (
              /* dt before dd keeps the <dl> grouping valid; column-reverse puts
                 the numeral back on top. Same device as WorkIntro. */
              <div key={item.label} className="flex flex-col-reverse">
                <dt className="hor-eyebrow mt-2.5">{item.label}</dt>
                <dd className="hor-stat-sky">{item.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </header>
  );
}
