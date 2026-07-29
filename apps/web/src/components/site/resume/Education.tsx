import type { CSSProperties } from "react";
import Link from "next/link";

import { SkyHead } from "@/components/site/Panel";
import { stampTime } from "@/components/site/format";

import { computedAt, identity, resumeDocument } from "./data";

/**
 * Education, then the colophon — the last line of the document, which says
 * where it came from and when. On paper it is the only footer there is, since
 * the shared site footer is hidden by the print rules.
 */
export function Education() {
  return (
    <section id="education" className="res-section scroll-mt-20 pt-16 pb-16 sm:pt-20 sm:pb-20">
      <SkyHead index="05" eyebrow="Education" title="Where it started." />

      <div className="grid gap-3">
        {resumeDocument.education.map((entry, i) => (
          <article
            key={`${entry.institution}-${entry.credential}`}
            className="hor-card res-edu hor-rise"
            style={{ "--hor-delay": `${60 + i * 60}ms` } as CSSProperties}
          >
            <div>
              <h3 className="hor-h3">{entry.institution}</h3>
              <p className="res-org">{entry.credential}</p>
            </div>
            <span className="res-dates">
              {entry.start} — {entry.end}
            </span>
          </article>
        ))}
      </div>

      <div className="res-colophon">
        <p className="hor-micro">
          {identity.name} · {identity.role} · {identity.location} ·{" "}
          {identity.email}
        </p>
        <span className="hor-label">Snapshot {stampTime(computedAt)}</span>
      </div>

      <p className="hor-micro res-noprint mt-4">
        Case studies for the platforms above live on{" "}
        <Link href="/work" className="hor-link">
          the work pages
        </Link>
        .
      </p>
    </section>
  );
}
