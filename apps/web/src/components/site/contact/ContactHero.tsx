import type { CSSProperties } from "react";
import Image from "next/image";

import type { Identity } from "@/lib/snapshot";

import { CopyAddress } from "./CopyAddress";
import { ContactSheetTrigger } from "./ContactSheet";

function delay(ms: number): CSSProperties {
  return { "--hor-delay": `${ms}ms` } as CSSProperties;
}

/**
 * Sky zone. The invitation, then the address set as a monument — it is the
 * primary action on the page, so it gets display type, not a form field.
 *
 * The availability pill is the first thing on the page for the same reason it
 * is first on the homepage: it answers the question most people arrive with.
 * It is also the line `siteSettings.setAvailability` changes from a phone, so
 * it is read from `identity` per render rather than frozen at module load.
 *
 * The direct address stays exactly as it was, whatever the composer below the
 * horizon is wired to. A stored message is a convenience; the inbox is the
 * commitment.
 */
export function ContactHero({ identity }: { identity: Identity }) {
  return (
    <header className="pt-24 pb-14 sm:pt-28 sm:pb-16 lg:pt-36 lg:pb-20">
      <div className="hor-rise" style={delay(40)}>
        <span className="hor-pill">
          <span className="hor-live" aria-hidden="true" />
          {identity.availability}
        </span>
      </div>

      <h1
        className="contact-display hor-rise mt-8 text-balance sm:mt-10"
        style={delay(110)}
      >
        Start a conversation.
      </h1>

      <p
        className="hor-lede hor-rise mt-6 max-w-[56ch] text-pretty"
        style={delay(180)}
      >
        Two kinds of message always get a reply. Principal and staff-plus roles,
        where the architecture and the people around it are the same job. And
        hard platform problems — real-time systems that disagree with
        themselves, rendering pipelines, compliance models that have outgrown
        the spreadsheet holding them together.
      </p>

      <p
        className="hor-body hor-rise mt-4 max-w-[56ch] text-pretty"
        style={delay(210)}
      >
        Short is fine. One paragraph and a link tells me more than a brief.
      </p>

      <div
        className="hor-card contact-mail-card hor-rise mt-10 sm:mt-12"
        style={delay(260)}
      >
        <span className="hor-eyebrow">
          <span className="hor-mono">01</span>
          <span className="hor-tick" aria-hidden="true" />
          Direct line
        </span>

        <div className="mt-4 sm:mt-5">
          <a className="contact-addr" href={`mailto:${identity.email}`}>
            {identity.email}
          </a>
        </div>

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <ContactSheetTrigger className="hor-btn">
            Write an email
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
          </ContactSheetTrigger>
          <CopyAddress value={identity.email} />
        </div>

        <p className="hor-micro mt-6 max-w-[52ch]">
          A personal inbox, read by one person — no form queue in front of it.
          The composer below the horizon writes into this same address.
        </p>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <a
          className="hor-card hor-lift contact-tile hor-rise"
          href={`https://github.com/${identity.github}`}
          rel="noreferrer noopener"
          style={delay(320)}
        >
          <span className="contact-tile-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 .6a7.4 7.4 0 00-2.34 14.43c.37.07.5-.16.5-.36v-1.25c-2.06.45-2.5-.99-2.5-.99-.33-.85-.82-1.08-.82-1.08-.67-.46.05-.45.05-.45.74.05 1.13.77 1.13.77.66 1.13 1.73.8 2.15.61.07-.48.26-.8.47-.99-1.64-.19-3.37-.82-3.37-3.66 0-.8.29-1.47.76-1.98-.08-.19-.33-.94.07-1.96 0 0 .62-.2 2.03.76a7.07 7.07 0 013.7 0c1.4-.96 2.03-.76 2.03-.76.4 1.02.15 1.77.07 1.96.47.51.76 1.17.76 1.98 0 2.85-1.73 3.47-3.38 3.65.27.23.5.68.5 1.37v2.03c0 .2.13.43.51.36A7.4 7.4 0 008 .6z" />
            </svg>
          </span>
          <span className="min-w-0">
            <span className="hor-eyebrow">Code</span>
            <span className="mt-1.5 block truncate text-[13px] font-medium tracking-[-0.012em]">
              github.com/{identity.github}
            </span>
          </span>
        </a>

        <div
          className="hor-card contact-tile contact-location-tile hor-rise"
          style={delay(360)}
        >
          <span className="contact-location-map-frame" aria-hidden="true">
            <Image
              src="/images/pyrmont-map.webp"
              alt=""
              fill
              sizes="(min-width: 640px) 36vw, 68vw"
              className="contact-location-map"
            />
          </span>
          <span className="contact-tile-icon" aria-hidden="true">
            <svg
              width="16"
              height="16"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10 17.4s5.4-4.6 5.4-9a5.4 5.4 0 10-10.8 0c0 4.4 5.4 9 5.4 9z" />
              <circle cx="10" cy="8.3" r="2" />
            </svg>
          </span>
          <span className="contact-location-copy min-w-0">
            <span className="hor-eyebrow">Based in</span>
            <span className="mt-1.5 block truncate text-[13px] font-medium tracking-[-0.012em]">
              {identity.location}
            </span>
          </span>
        </div>
      </div>
    </header>
  );
}
