import type { CSSProperties } from "react";

import { stamp } from "@/components/site/format";
import type { Identity } from "@/lib/snapshot";

/**
 * The document header — sky zone.
 *
 * Left: who this is and the one-paragraph summary. Right: the contact block,
 * which is also the only part of this page a recruiter actually copies out of.
 * The PDF control sits under the primary action and is now real: it is a plain
 * `<a href="/api/resume.pdf" download>` pointing at the Route Handler that
 * renders the same Resume Document this page renders (ADR 011).
 *
 * ── Why an anchor and not a button ─────────────────────────────────────────
 *
 * A `<button>` would need an `onClick`, which would make this a client
 * component, which would put a `"use client"` boundary around a header whose
 * only job is to print text — and the thing it would call, `@home/pdf`, is a
 * megabyte of layout engine that must never leave the server. An anchor costs
 * zero JavaScript, works with middle-click and "copy link address", and lets the
 * browser stream the response. `download` asks for a save rather than a tab; the
 * route answers `Content-Disposition: inline` so that everyone who reaches the
 * URL another way still gets a readable document.
 *
 * ── Props, not module state ────────────────────────────────────────────────
 *
 * `identity` and the contact rows built from it were module constants read off
 * the mock. They arrive from the page's one `getSiteData()` now, which is what
 * makes `siteSettings.setAvailability` — the "Status" row below — visible within
 * an ISR window instead of at the next deploy.
 */

function delay(ms: number): CSSProperties {
  return { "--hor-delay": `${ms}ms` } as CSSProperties;
}

export function ResumeHeader({
  identity,
  summary,
  companyCount,
  yearsShipping,
  computedAt,
}: {
  identity: Identity;
  /** `resumeDocument.summary` — the one paragraph the document opens with. */
  summary: string;
  companyCount: number;
  yearsShipping: number;
  computedAt: string;
}) {
  const contact = [
    { label: "Email", value: identity.email, href: `mailto:${identity.email}` },
    {
      label: "GitHub",
      value: `github.com/${identity.github}`,
      href: `https://github.com/${identity.github}`,
    },
    { label: "Location", value: identity.location, href: null },
    ...(identity.availabilityVisible
      ? [{ label: "Status", value: identity.availability, href: null }]
      : []),
  ] as const;

  return (
    <header className="res-head pt-24 pb-14 sm:pt-28 sm:pb-16 lg:pt-32">
      <div>
        <span className="hor-eyebrow hor-rise" style={delay(40)}>
          <span className="hor-mono">01</span>
          <span className="hor-tick" aria-hidden="true" />
          Résumé
        </span>

        <h1
          className="hor-display res-name hor-rise mt-6 text-balance sm:mt-7"
          style={delay(100)}
        >
          {identity.name}
        </h1>

        <div className="hor-rise mt-5" style={delay(160)}>
          <p className="hor-h2">{identity.role}</p>
          <div className="res-metaline">
            <span className="hor-body" style={{ color: "var(--hor-ink)" }}>
              {identity.company}
            </span>
            <span className="hor-vrule" aria-hidden="true" />
            <span className="hor-body">{identity.location}</span>
            <span className="hor-vrule" aria-hidden="true" />
            <span className="hor-body">
              {yearsShipping} years shipping · {companyCount}{" "}
              {companyCount === 1 ? "employer" : "employers"}
            </span>
          </div>
        </div>

        <p
          className="hor-lede hor-rise mt-7 max-w-[56ch] text-pretty"
          style={delay(220)}
        >
          {summary}
        </p>

        {/* Both keys are screen affordances: on paper the contact card and the
            print-only line below already carry the address. */}
        <div className="res-actions hor-rise res-noprint" style={delay(280)}>
          <a className="hor-btn" href={`mailto:${identity.email}`}>
            Email {identity.name.split(" ")[0]}
            <svg
              width="13"
              height="13"
              viewBox="0 0 13 13"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M2.6 6.5h7.8M7.2 3.3l3.2 3.2-3.2 3.2"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </a>

          {/* Not `<Link>`: this is a Route Handler returning a binary, not a
              route the client router can navigate to, and prefetching it would
              have the browser download a PDF nobody asked for. */}
          <a className="res-dl" href="/api/resume.pdf" download>
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M8 2.4v7.4M4.9 7l3.1 3 3.1-3M3.2 12.6h9.6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Download PDF
          </a>
        </div>

        <p className="hor-micro res-actions-note res-noprint">
          The PDF is generated from this page&rsquo;s data rather than
          maintained beside it — the same document, set for A4. Your
          browser&rsquo;s print dialog also renders this page clean, without the
          navigation or the telemetry chrome.
        </p>

        <p className="hor-micro res-print-only">
          coreybaines.com/resume · {identity.email} · github.com/
          {identity.github}
        </p>
      </div>

      <aside
        className="hor-card res-vcard hor-rise"
        style={delay(90)}
        aria-label="Contact details"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="hor-label">Contact</span>
          <span className="hor-live" aria-hidden="true" />
        </div>

        <div className="mt-1">
          {contact.map((row) => (
            <div key={row.label} className="res-vrow">
              <span className="hor-label">{row.label}</span>
              {row.href ? (
                <a
                  className="hor-link res-vval"
                  href={row.href}
                  rel="noreferrer noopener"
                >
                  {row.value}
                </a>
              ) : (
                <span className="res-vval">{row.value}</span>
              )}
            </div>
          ))}
        </div>

        <div className="res-vfoot">
          <span className="hor-label">Revision</span>
          <span className="hor-mono hor-micro" style={{ color: "var(--hor-ink)" }}>
            {stamp(computedAt.slice(0, 10))}
          </span>
        </div>
      </aside>
    </header>
  );
}
