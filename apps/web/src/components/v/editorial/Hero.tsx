import type { CSSProperties } from "react";

import { snapshot } from "@/lib/snapshot";
import { longDate, num } from "./format";

const { identity, gitStats, aiUsage, projects } = snapshot;

const [firstName, ...restName] = identity.name.split(" ");
const lastName = restName.join(" ");

/** The evidence rail: three figures, before a single line of prose. */
const rail = [
  { value: num(gitStats.totalContributionsYear), label: "Contributions" },
  { value: num(aiUsage.totalSessions), label: "Agent sessions" },
  { value: String(projects.length), label: "Platforms shipped" },
];

/** Stagger index for the load-in animation. */
const step = (i: number) => ({ "--ed-i": i }) as CSSProperties;

export function Hero() {
  return (
    <section className="ed-wrap ed-hero">
      <div className="ed-hero-grid">
        <div>
          <h1 className="ed-display ed-in" style={step(0)}>
            <span>{firstName}</span>
            <span className="ed-display-2">{lastName}</span>
          </h1>

          <div className="ed-hero-role ed-in" style={step(1)}>
            <p className="ed-hero-role-title">{identity.role}</p>
            <p className="ed-caps ed-hero-meta">{identity.location}</p>
          </div>

          <p className="ed-deck ed-in" style={step(2)}>
            I lead the platforms {identity.company}&rsquo;s enterprise customers run
            on &mdash; documents, compliance, live auctions &mdash; and I build them
            alongside agents, at scale.
          </p>

          <p className="ed-status ed-caps ed-in" style={step(3)}>
            <span className="ed-dot" aria-hidden="true" />
            {identity.availability}
          </p>
        </div>

        <div className="ed-in" style={step(4)}>
          <div className="ed-rail">
            {rail.map((item) => (
              <div className="ed-rail-item" key={item.label}>
                <span className="ed-rail-val">{item.value}</span>
                <span className="ed-caps ed-rail-label">{item.label}</span>
              </div>
            ))}
          </div>
          <p className="ed-caps ed-rail-foot">
            Twelve months to {longDate(snapshot.computedAt.slice(0, 10))}
          </p>
        </div>
      </div>
    </section>
  );
}

export default Hero;
