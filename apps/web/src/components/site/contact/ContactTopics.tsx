import type { CSSProperties } from "react";

import { SkyHead } from "@/components/site/Panel";
import { num } from "@/components/site/format";
import type { AiUsage, Identity, ResumeDocument } from "@/lib/snapshot";

/**
 * The page surfaces again: three kinds of first message, and the ground each
 * one can cover. The chip row is `resumeDocument.capabilities` verbatim — the
 * same list the résumé renders, so the two pages can never drift apart.
 *
 * The copy quotes two live figures (how many platforms, how many agent
 * sessions), so the topics are built per render from props rather than frozen in
 * a module constant.
 */
export function ContactTopics({
  identity,
  aiUsage,
  projectCount,
  capabilities,
}: {
  identity: Identity;
  aiUsage: AiUsage;
  projectCount: number;
  capabilities: ResumeDocument["capabilities"];
}) {
  const topics = [
    {
      index: "01",
      title: "A role",
      body: "The team, the systems it owns, and what principal means where you are. A band and a location expectation in the first message saves us both a round.",
    },
    {
      index: "02",
      title: "A hard problem",
      body: `Real-time correctness, rendering pipelines, risk modelled as a graph — the shape of the ${projectCount} platforms already carrying load. Advisory, review, or hands on the code.`,
    },
    {
      index: "03",
      title: "An engineering question",
      body: `Agent-assisted delivery, or anything on this site. ${num(
        aiUsage.totalSessions,
      )} sessions in, the opinions come with receipts.`,
    },
  ];

  return (
    <section className="pt-16 pb-16 sm:pt-20 sm:pb-20">
      <SkyHead
        index="03"
        eyebrow="Before you write"
        title="Three messages that always get an answer."
        lede="No template required — this is only what makes a reply fast."
        aside={
          <span className="hor-pill">
            <span className="hor-live" aria-hidden="true" />
            {identity.availability}
          </span>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        {topics.map((topic, i) => (
          <article
            key={topic.index}
            className="hor-card hor-lift contact-topic hor-rise"
            style={{ "--hor-delay": `${60 + i * 60}ms` } as CSSProperties}
          >
            <span className="contact-topic-idx">{topic.index}</span>
            <h3 className="hor-h3 mt-3">{topic.title}</h3>
            <p className="hor-body mt-3 text-pretty">{topic.body}</p>
          </article>
        ))}
      </div>

      <div
        className="hor-rise mt-10 sm:mt-12"
        style={{ "--hor-delay": "260ms" } as CSSProperties}
      >
        <div className="hor-rule" />
        <div className="pt-7">
          <span className="hor-eyebrow">Ground I can cover</span>
          <ul className="mt-4 flex flex-wrap gap-1.5">
            {capabilities.map((capability) => (
              <li key={capability} className="hor-chip">
                {capability}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
