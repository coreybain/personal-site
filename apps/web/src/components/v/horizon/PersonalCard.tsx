import Image from "next/image";

import portrait from "@/assets/portrait.jpg";
import { snapshot } from "@/lib/snapshot";

const { identity } = snapshot;

/**
 * The hero's right column: an ID card in the sky-card material. The dashed
 * orbits behind it are decorative and break the card's box on purpose,
 * echoing the wash's arc.
 */
export function PersonalCard() {
  return (
    <div className="hor-id-wrap">
      <span className="hor-id-orbit" aria-hidden="true">
        <i />
      </span>
      <span className="hor-id-orbit hor-id-orbit-b" aria-hidden="true" />

      <aside className="hor-idcard hor-card" aria-label={`${identity.name} — profile card`}>
        <div className="hor-id-photo">
          <Image
            src={portrait}
            alt={`Portrait of ${identity.name}`}
            fill
            sizes="(min-width: 1024px) 340px, 100vw"
            className="hor-id-img"
            priority
          />
        </div>

        <p className="hor-id-name">{identity.name}</p>

        <span className="hor-id-badge" aria-hidden="true">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path
              d="M6.5 1.2l1.2 3.1a1 1 0 00.6.6l3.1 1.2-3.1 1.2a1 1 0 00-.6.6l-1.2 3.1-1.2-3.1a1 1 0 00-.6-.6L1.4 6.1l3.1-1.2a1 1 0 00.6-.6z"
              fill="currentColor"
            />
          </svg>
        </span>

        <p className="hor-id-role">
          {identity.role} · {identity.company}
        </p>
        <p className="hor-id-loc">{identity.location}</p>

        <div className="hor-id-social">
          <a
            className="hor-id-chip"
            href={`https://github.com/${identity.github}`}
            rel="noreferrer noopener"
            aria-label="GitHub"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 .6a7.4 7.4 0 00-2.34 14.43c.37.07.5-.16.5-.36v-1.25c-2.06.45-2.5-.99-2.5-.99-.33-.85-.82-1.08-.82-1.08-.67-.46.05-.45.05-.45.74.05 1.13.77 1.13.77.66 1.13 1.73.8 2.15.61.07-.48.26-.8.47-.99-1.64-.19-3.37-.82-3.37-3.66 0-.8.29-1.47.76-1.98-.08-.19-.33-.94.07-1.96 0 0 .62-.2 2.03.76a7.07 7.07 0 013.7 0c1.4-.96 2.03-.76 2.03-.76.4 1.02.15 1.77.07 1.96.47.51.76 1.17.76 1.98 0 2.85-1.73 3.47-3.38 3.65.27.23.5.68.5 1.37v2.03c0 .2.13.43.51.36A7.4 7.4 0 008 .6z" />
            </svg>
          </a>
          <a className="hor-id-chip" href={`mailto:${identity.email}`} aria-label="Email">
            <svg
              width="16"
              height="16"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="2.8" y="4.6" width="14.4" height="10.8" rx="2" />
              <path d="M3.4 6.2L10 11l6.6-4.8" />
            </svg>
          </a>
        </div>
      </aside>
    </div>
  );
}
