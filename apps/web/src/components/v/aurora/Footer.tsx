import Link from "next/link";

import { snapshot } from "@/lib/snapshot";

import styles from "./aurora.module.css";
import { shortDateTime } from "./format";

const { identity } = snapshot;

export function Footer() {
  return (
    <footer
      className={`${styles.rise} pb-14 sm:pb-20`}
      style={{ "--aur-delay": "580ms" } as React.CSSProperties}
    >
      <div className={`${styles.hairline} pt-10 sm:pt-12`}>
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-8">
          <div>
            <span className={styles.eyebrow}>Get in touch</span>
            <a
              href={`mailto:${identity.email}`}
              className={`${styles.link} ${styles.linkUnderline} ${styles.h3} mt-3 block`}
            >
              {identity.email}
            </a>
            <p className={`${styles.micro} mt-3`}>
              {identity.role} · {identity.location} · {identity.availability}
            </p>
          </div>

          <div className="flex flex-col items-start gap-2.5 sm:items-end">
            <a
              href={`https://github.com/${identity.github}`}
              rel="noreferrer"
              className={`${styles.link} ${styles.linkUnderline} text-[13px] font-medium`}
            >
              github.com/{identity.github}
            </a>
            <Link
              href="/"
              className={`${styles.link} ${styles.linkUnderline} text-[13px]`}
            >
              All variants
            </Link>
            <span className={`${styles.micro} ${styles.mono} mt-1`}>
              Snapshot computed {shortDateTime(snapshot.computedAt)}
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
