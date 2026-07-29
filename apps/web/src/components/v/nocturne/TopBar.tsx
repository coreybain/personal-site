import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { snapshot } from "@/lib/snapshot";

import { delay } from "./format";

const { identity } = snapshot;

const NAV = [
  { href: "#signal", label: "Signal" },
  { href: "#work", label: "Work" },
  { href: "#ai", label: "AI" },
];

/**
 * Server component. The only client code it renders is <ThemeToggle>, which
 * must live inside the <ThemeScope> — see page.tsx.
 */
export function TopBar() {
  return (
    <div className="noc-bar noc-rise" style={delay(0)}>
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="noc-mark" aria-hidden="true">
          CB
        </span>
        <span className="truncate text-[13px] font-medium tracking-[-0.014em]">
          {identity.name}
        </span>
      </div>

      <nav className="flex items-center gap-3 sm:gap-5" aria-label="Sections">
        <ul className="noc-nav-links">
          {NAV.map((item) => (
            <li key={item.href}>
              <a href={item.href} className="noc-link text-[13px]">
                {item.label}
              </a>
            </li>
          ))}
        </ul>
        <a
          href={`mailto:${identity.email}`}
          className="noc-link text-[13px] font-medium"
        >
          Email
        </a>
        <ThemeToggle className="noc-toggle" />
      </nav>
    </div>
  );
}
