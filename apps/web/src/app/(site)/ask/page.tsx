import type { Metadata } from "next";

import { AskConsole } from "@/components/site/ask/AskConsole";
import { AskGround } from "@/components/site/ask/AskGround";
import { AskHero } from "@/components/site/ask/AskHero";
import { Boundary } from "@/components/site/Boundary";
import { stampTime } from "@/components/site/format";
import { getPosts, getSiteData } from "@/lib/data";

import "./ask.css";

/**
 * /ask — Ask Corey, rebuilt on retrieval (ADR 015).
 *
 *   SKY   what this is, what it is grounded in, and what it is not.
 *   DECK  the console — the one client island on the public site.
 *   SKY   the ground rules, in two lists.
 *
 * ── The one route that ships JavaScript ───────────────────────────────────
 *
 * Every other public page is server-rendered with no client component of its
 * own. This one carries a chat, so it carries `@ai-sdk/react` and the composer,
 * and `tooling/perf/budgets.ts` has a line for it that says so. The exception
 * is contained by keeping the boundary exactly at `<AskConsole>`: the hero, the
 * ground rules, the layout and this file are all server components, so the page
 * is readable and useful before — and without — hydration.
 *
 * ── One read ──────────────────────────────────────────────────────────────
 *
 * `getSiteData()` and `getPosts()` are the same two `cache()`d readers the rest
 * of the site uses, shared with `generateMetadata` and with the layout. The
 * counts they produce describe the corpus honestly: `knowledge.ts` indexes
 * exactly the published projects, labs and posts these readers return.
 */
export const revalidate = 300;

/**
 * Whether this deployment can answer at all, as far as the *server* can tell.
 *
 * Read here rather than in the island for the same reason `/contact` decides
 * its transport in the page: a `"use client"` module that reads an environment
 * variable inlines it into the public bundle. A boolean crosses the boundary;
 * the key never does, and could not — this is not a `NEXT_PUBLIC_` variable, so
 * it does not exist in a browser bundle at all.
 *
 * ⚠️ Advisory only. Three ways it can disagree with reality, all handled by
 * `AskConsole` treating the route as the authority:
 *
 *   • the page was prerendered before the key was set (ISR: five minutes)
 *   • the route reads a key or a config this page does not
 *   • the answering key is set but the retrieval side is not, or vice versa
 *
 * Read per render rather than at module scope so setting the variable takes
 * effect on the next revalidation rather than the next deploy.
 */
function answeringConfigured(): boolean {
  const key = process.env.ANTHROPIC_API_KEY;
  return key !== undefined && key.length > 0;
}

/**
 * Starter questions, built from content that is actually published.
 *
 * This is the difference between a demo and a feature. A hardcoded "Tell me
 * about your experience" is a prompt somebody wrote once; these name real
 * projects by their real titles, so every suggestion is a question the corpus
 * can answer — and if a project is unpublished tomorrow, its starter disappears
 * with it rather than becoming a question that returns nothing.
 *
 * `projects` arrives ordered by the same `order` field `/work` renders, so the
 * first two are the two Corey leads with.
 */
function starterQuestions(
  projects: { title: string; client: string }[],
  hasPosts: boolean,
): string[] {
  const starters = projects
    .slice(0, 2)
    .map((project) => `What did Corey build for ${project.title}?`);

  starters.push("What's his AI-assisted workflow?");

  // Only asked when there is writing to answer from; otherwise the resume is
  // the deepest thing in the corpus and gets the slot.
  starters.push(
    hasPosts
      ? "What has he written about recently?"
      : "Which stacks has he shipped to production?",
  );

  return starters;
}

/**
 * Bare title — the `(site)` layout's template appends "— Corey Baines".
 *
 * The description is built from live counts for the same reason every other
 * page's is: it is the line a search result shows, and a hand-written one drifts
 * away from the site the first time something is published.
 */
export async function generateMetadata(): Promise<Metadata> {
  const [{ identity, projects, labs }, posts] = await Promise.all([
    getSiteData(),
    getPosts(),
  ]);

  const corpus = projects.length + labs.length + posts.length;

  return {
    title: "Ask",
    description: `Ask about ${identity.name}'s work and get an answer drawn from this site — ${corpus} published case studies, labs and posts — with the pages it came from cited as links.`,
    alternates: { canonical: "/ask" },
  };
}

export default async function AskPage() {
  const [{ identity, projects, labs, computedAt }, posts] = await Promise.all([
    getSiteData(),
    getPosts(),
  ]);

  return (
    <main>
      <section className="hor-sky">
        <div className="hor-wash" aria-hidden="true" />
        <div className="hor-shell">
          <AskHero
            identity={identity}
            projectCount={projects.length}
            labCount={labs.length}
            postCount={posts.length}
          />
        </div>
      </section>

      <Boundary label={`Retrieval · ${stampTime(computedAt)}`} />

      <div className="hor-deck-zone">
        <div className="hor-deck-grid" aria-hidden="true" />
        <div className="hor-shell pb-16 sm:pb-20">
          <AskConsole
            starters={starterQuestions(projects, posts.length > 0)}
            answeringConfigured={answeringConfigured()}
          />
        </div>
      </div>

      <Boundary direction="out" />

      <section className="hor-sky">
        <div className="hor-shell">
          <AskGround identity={identity} />
        </div>
      </section>
    </main>
  );
}
