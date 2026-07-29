import Link from "next/link";

import { snapshot } from "@/lib/snapshot";

import { delay, stampDate } from "./format";

const { identity } = snapshot;

export function Footer() {
  return (
    <footer className="noc-rise pb-14 sm:pb-20" style={delay(600)}>
      <div className="noc-hair pt-10 sm:pt-12">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-8">
          <div>
            <span className="noc-eyebrow">Get in touch</span>
            <a
              href={`mailto:${identity.email}`}
              className="noc-link noc-h3 mt-3 block"
            >
              {identity.email}
            </a>
            <p className="noc-micro mt-3">
              {identity.role} · {identity.location} · {identity.availability}
            </p>
          </div>

          <div className="flex flex-col items-start gap-2.5 sm:items-end">
            <a
              href={`https://github.com/${identity.github}`}
              rel="noreferrer"
              className="noc-link text-[13px] font-medium"
            >
              github.com/{identity.github}
            </a>
            <Link href="/" className="noc-link text-[13px]">
              All variants
            </Link>
            <span className="noc-micro noc-mono mt-1">
              Snapshot computed {stampDate(snapshot.computedAt)}
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
