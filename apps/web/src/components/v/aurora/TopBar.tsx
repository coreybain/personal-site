import { snapshot } from "@/lib/snapshot";

import styles from "./aurora.module.css";

const { identity } = snapshot;

const NAV = [
  { href: "#signal", label: "Signal" },
  { href: "#work", label: "Work" },
  { href: "#ai", label: "AI" },
];

export function TopBar() {
  return (
    <div
      className={`${styles.rise} flex h-16 items-center justify-between gap-6 sm:h-20`}
      style={{ "--aur-delay": "0ms" } as React.CSSProperties}
    >
      <div className="flex items-center gap-2.5">
        <span className={styles.mark} aria-hidden="true">
          CB
        </span>
        <span className="text-[13px] font-medium tracking-[-0.014em]">
          {identity.name}
        </span>
      </div>

      <nav className="flex items-center gap-5 sm:gap-6">
        <ul className="hidden items-center gap-5 sm:flex sm:gap-6">
          {NAV.map((item) => (
            <li key={item.href}>
              <a
                href={item.href}
                className={`${styles.link} ${styles.linkUnderline} text-[13px]`}
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
        <a
          href={`mailto:${identity.email}`}
          className={`${styles.link} ${styles.linkUnderline} text-[13px] font-medium`}
        >
          Email
        </a>
      </nav>
    </div>
  );
}
