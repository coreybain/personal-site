import Link from "next/link";

import { snapshot } from "@/lib/snapshot";

import { delay } from "./SectionHead";
import { shortDateTime } from "./format";

const { identity } = snapshot;

export function Footer() {
  return (
    <footer
      className="pri-shell pri-rise pb-14 sm:pb-20"
      style={delay(600)}
    >
      <div className="pri-rule pt-10 sm:pt-12">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-8">
          <div>
            <span className="pri-eyebrow">Get in touch</span>
            <a
              href={`mailto:${identity.email}`}
              className="pri-link pri-h3 mt-3.5 block"
            >
              {identity.email}
            </a>
            <p className="pri-micro mt-3">
              {identity.role} · {identity.location} · {identity.availability}
            </p>
          </div>

          <div className="flex flex-col items-start gap-2.5 sm:items-end">
            <a
              href={`https://github.com/${identity.github}`}
              rel="noreferrer"
              className="pri-link text-[0.8125rem] font-semibold"
            >
              github.com/{identity.github}
            </a>
            <Link href="/" className="pri-link text-[0.8125rem]">
              All variants
            </Link>
            <span className="pri-micro pri-mono mt-1">
              Snapshot computed {shortDateTime(snapshot.computedAt)}
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
