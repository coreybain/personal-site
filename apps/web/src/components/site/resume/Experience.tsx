import type { CSSProperties } from "react";

import { SkyHead } from "@/components/site/Panel";
import type { ResumeDerived } from "@/lib/derive";
import type { ResumeDocument } from "@/lib/snapshot";

/**
 * Experience — sky zone, so the page has surfaced and the cards go back to
 * rounded glass. The rail on the left is the résumé's spine: one node per role,
 * the current one lit with the same live sun dot the header uses.
 *
 * `experience` is rendered in the order it arrives. That order is the admin's
 * chosen print order (`by_sortOrder` from `resume.get`, newest role first), not
 * a sort applied here — which is also why `experience[0]` is the current role.
 */
export function Experience({
  experience,
  companyCount,
  yearsShipping,
  tenureYears,
}: {
  experience: ResumeDocument["experience"];
  companyCount: number;
  yearsShipping: number;
  /** `deriveResume().tenureYears` — an open-ended role runs to the snapshot year. */
  tenureYears: ResumeDerived["tenureYears"];
}) {
  return (
    <section id="experience" className="res-section scroll-mt-20 pt-16 sm:pt-20 lg:pt-24">
      <SkyHead
        index="03"
        eyebrow="Experience"
        title={`${yearsShipping} years of shipping, ${experience.length} roles deep.`}
        lede={`Across ${companyCount} ${
          companyCount === 1 ? "employer" : "employers"
        } the shape of the work has stayed the same: own the architecture, own the delivery, and leave the practice better than it was found.`}
        aside={
          <span className="hor-pill">
            <span className="hor-live" aria-hidden="true" />
            {experience[0].title} · now
          </span>
        }
      />

      <ol className="res-tl" role="list">
        {experience.map((role, i) => {
          const current = role.end.toLowerCase() === "present";

          return (
            <li
              key={`${role.company}-${role.title}`}
              className="res-role hor-rise"
              style={{ "--hor-delay": `${80 + i * 70}ms` } as CSSProperties}
            >
              <span
                className={`res-node ${current ? "res-node-now hor-live" : ""}`}
                aria-hidden="true"
              />

              <article className="hor-card res-role-card">
                <div className="res-role-head">
                  <div>
                    <h3 className="hor-h3">{role.title}</h3>
                    <p className="res-org">{role.company}</p>
                  </div>
                  <span className="res-dates">
                    {role.start} — {role.end}
                    <span className="hor-vrule hor-vrule-sm" aria-hidden="true" />
                    {tenureYears(role.start, role.end)} yr
                  </span>
                </div>

                <p className="hor-body mt-3.5 max-w-[62ch] text-pretty">
                  {role.summary}
                </p>

                <ul className="res-hl" role="list">
                  {role.highlights.map((highlight) => (
                    <li key={highlight}>{highlight}</li>
                  ))}
                </ul>
              </article>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
