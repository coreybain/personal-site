import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { snapshot } from "@/lib/snapshot";

import { delay } from "./SectionHead";

const { identity } = snapshot;

const NAV = [
  { href: "#signal", label: "Signal" },
  { href: "#work", label: "Work" },
  { href: "#ai", label: "AI" },
];

export function TopBar() {
  return (
    <header className="pri-shell">
      <div className="pri-bar pri-rise" style={delay(0)}>
        <div className="flex items-center gap-2.5">
          <span className="pri-mark" aria-hidden="true">
            CB
          </span>
          <span className="text-[0.875rem] font-semibold tracking-[-0.02em]">
            {identity.name}
          </span>
        </div>

        <div className="flex items-center gap-4 sm:gap-6">
          <nav className="pri-nav" aria-label="Sections">
            {NAV.map((item) => (
              <a key={item.href} href={item.href} className="pri-link text-[0.8125rem]">
                {item.label}
              </a>
            ))}
          </nav>
          <a
            href={`mailto:${identity.email}`}
            className="pri-link text-[0.8125rem] font-semibold"
          >
            Email
          </a>
          {/* The one interactive piece on the page. */}
          <ThemeToggle className="pri-toggle" />
        </div>
      </div>
    </header>
  );
}
