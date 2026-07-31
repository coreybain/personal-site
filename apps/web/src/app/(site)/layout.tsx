import type { Metadata } from "next";
import type { ReactNode } from "react";
import { IBM_Plex_Mono, Inter } from "next/font/google";

import { MotionProvider } from "@/components/motion";
import { Footer, NavPill } from "@/components/site/Chrome";
import { num } from "@/components/site/format";
import { ThemeScope } from "@/components/theme/ThemeScope";
import { getSiteData, showBlogInNav } from "@/lib/data";

import "./horizon.css";

/**
 * Fonts are loaded here and nowhere else. They are exposed as CSS variables
 * consumed only by rules scoped under `.hor` in horizon.css:
 *
 *   Inter          — the sky. Quiet display type, sans numerals.
 *   IBM Plex Mono  — the deck. Instrument labels and machined readouts.
 *
 * The face change at the horizon is doing real work: it is how the page tells
 * you it has moved from the calm zone into the telemetry zone.
 */
const horSans = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-hor-sans",
});

const horMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-hor-mono",
});

/**
 * ISR for every route under `(site)`.
 *
 * Next takes the **lowest** `revalidate` across a route's layout and its page,
 * so this one declaration already floors the whole group at five minutes — the
 * per-page literals are there so a page reads as self-describing, not because
 * the layout's is optional. The literal is repeated rather than imported from
 * `REVALIDATE_SECONDS` because the value has to be statically analysable; see
 * the header of `@/lib/data` for the full argument, and for why 300.
 *
 * Still valid in Next 16: `revalidate` is only removed under Cache Components,
 * which `next.config.ts` does not enable.
 */
export const revalidate = 300;

/**
 * The title and the description are the first thing a recruiter's search result
 * shows, so they are built from the same numbers the page prints rather than
 * from prose that can drift.
 *
 * A `generateMetadata` function, not a `metadata` object, because the values now
 * come from a Convex read — a module-scope object is evaluated once per process
 * and would have frozen the mock's figures into every `<head>` on the site.
 * `getSiteData()` is `cache()`d, so this shares one round of queries with the
 * layout body below and with whichever page is rendering: resolving metadata is
 * part of the same render pass.
 *
 * ── The title template lives here, not in the root layout ──────────────────
 *
 * `title.template` applies to every **descendant** segment, and the root
 * layout's descendants are not only this group: `/admin` sets
 * "Admin — coreybaines.com" and each of the seven `/v/*` explorations sets a
 * complete title of its own. A template at the root would render those as
 * "Admin — coreybaines.com — Corey Baines". Declared here it is scoped to the
 * public site, which is the thing the suffix is actually a statement about.
 *
 * The contract this creates for every page under `(site)`: **set a bare title.**
 * `title: "Work"`, not `title: "Work — Corey Baines"` — the suffix is added
 * once, here, from live identity, and a page that spells it out again gets it
 * twice.
 *
 * `title.default` is required whenever a template is set, and it is doing real
 * work rather than satisfying the API: the homepage declares no title of its
 * own, so this *is* the homepage's title. It is the one page whose title should
 * be the person rather than a section, so the default reads as a full statement
 * and the template is never applied to it.
 *
 * The root layout supplies `metadataBase`, the ADR 018 index gate, the Open
 * Graph card identity and the author fields. Nothing here repeats them.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { identity, gitStats, aiUsage, projects } = await getSiteData();

  return {
    title: {
      default: `${identity.name} — ${identity.role}`,
      template: `%s — ${identity.name}`,
    },
    description: `${identity.role} in ${identity.location}. ${num(
      gitStats.totalContributionsYear,
    )} contributions in the last year, ${projects.length} platforms shipped for ${
      identity.company
    }, ${num(aiUsage.totalSessions)} agent sessions.`,
  };
}

/**
 * Shared chrome for every page under `(site)`.
 *
 *   fonts wrapper  — carries the two font variables into the scope
 *   ThemeScope     — the `.hor` element that owns `data-theme`; the only
 *                    client boundary in the shell that renders DOM (wrapper +
 *                    pre-paint script)
 *   MotionProvider — LazyMotion + MotionConfig (ADR 013). Renders no DOM, and
 *                    sits *inside* ThemeScope so the pre-paint boot script
 *                    stays the scope's first child
 *   NavPill        — floating glyph nav, persists across route changes
 *   {children}     — the page's own zones (sky / deck / sky)
 *   Footer         — contact block + theme picker, persists across routes
 *
 * Pages below this layout render *only* their sections. Because the scope and
 * the chrome now live in the layout, a client-side navigation between site
 * routes swaps `{children}` and leaves the theme, the pill and the footer
 * mounted — no re-boot, no flash.
 *
 * ── The layout's own read ──────────────────────────────────────────────────
 *
 * The footer prints `identity` (email, role, company, location, GitHub handle)
 * and the snapshot stamp, so the layout is a data reader like any page. It calls
 * `getSiteData()` — the *same* `cache()`d assembly `generateMetadata` above and
 * the page below both call, so a homepage request still costs one round of
 * Convex queries in total, not three.
 *
 * That shared read is also the answer to the obvious alternative: the footer
 * does **not** fetch for itself. A leaf that reaches for its own data is how a
 * one-read page quietly becomes twelve, and per ADR 004 the target is one.
 *
 * ── The nav's one conditional key ──────────────────────────────────────────
 *
 * `showBlogInNav()` decides whether the pill carries "Writing": the admin's
 * `siteSettings.nav.blog` flag **and** at least one published post, both
 * server-derived (ADR 018). It is resolved here, in the shell, because the pill
 * is mounted here and persists across navigations — a per-page answer would let
 * the key appear and disappear as the reader moved around the site.
 *
 * It is cheap by construction. `getNav()` shares the layout's own
 * `siteSettings.get`, and the `&&` inside `showBlogInNav` short-circuits, so
 * while the flag is off — the launch state — no `(site)` page issues a
 * `posts.list` query at all. See the function for the full argument.
 */
export default async function SiteLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const [{ identity, computedAt }, showBlog] = await Promise.all([
    getSiteData(),
    showBlogInNav(),
  ]);

  return (
    <div className={`hor-fonts ${horSans.variable} ${horMono.variable}`}>
      <ThemeScope className="hor" defaultTheme="dark">
        <MotionProvider>
          <NavPill showBlog={showBlog} />
          {children}
          <Footer identity={identity} computedAt={computedAt} />
        </MotionProvider>
      </ThemeScope>
    </div>
  );
}
