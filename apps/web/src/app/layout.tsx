import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { getSettingsIdentity } from "@/lib/data";
import { IS_INDEXABLE, METADATA_BASE } from "@/lib/seo";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Site-wide metadata: the things that are true of **every** route in the app,
 * public or not.
 *
 * ── Why this is a function, and what it costs ──────────────────────────────
 *
 * `generateMetadata` is supported in the root layout exactly as it is anywhere
 * else, and it is a function here because the name and the role are data now,
 * not copy. What it must not be is expensive: metadata for the root layout is
 * resolved on every route in the app, `/admin` included, and that route group is
 * `force-dynamic` — so a six-query assembly here would tax every authenticated
 * navigation for a `<title>` the admin layout overrides on the next line.
 *
 * `getSettingsIdentity()` is the narrow reader written for this call site: one
 * `siteSettings.get`, memoised, which on any `(site)` route is **zero** extra
 * queries because the page's own assembly has already started the same promise.
 * Its docblock names the one fallback tier it drops and why that is acceptable.
 *
 * ── The division of labour with `(site)/layout.tsx` ────────────────────────
 *
 * This file owns what does not depend on which *part* of the site you are in:
 *
 *   metadataBase   the origin every relative URL below resolves against
 *   robots         the ADR 018 index gate, applied to the whole app
 *   openGraph      card identity — site name, locale, type, the default image
 *   twitter        card shape
 *   authors etc.   who wrote this
 *
 * What it deliberately does **not** own is the title *template*. That lives in
 * `(site)/layout.tsx`, because a template applies to every descendant segment
 * and this layout's descendants include `/admin` ("Admin — coreybaines.com"),
 * which already sets a complete title of its own. A `%s — Corey Baines`
 * template here would render it as
 * "Admin — coreybaines.com — Corey Baines". Scoping the template to the `(site)`
 * group is what makes it a rule about the public site rather than a rule about
 * the repository.
 *
 * The `title` below is therefore a plain default with no template: the fallback
 * for any route that never sets one (the global 404, chiefly). Every real page
 * sets its own.
 *
 * ── `openGraph.url` is absent on purpose ───────────────────────────────────
 *
 * A page's `openGraph` **replaces** this object wholesale rather than merging
 * into it, so anything set here is inherited only by pages that declare no
 * `openGraph` at all — which is most of them. `og:url` is per-page by
 * definition, so setting it here would give /work, /labs and /resume the
 * homepage's URL. The per-page canonical (`alternates.canonical`) carries that
 * fact instead, on every page, correctly.
 */
export async function generateMetadata(): Promise<Metadata> {
  const identity = await getSettingsIdentity();

  const description = `${identity.name} — ${identity.role} in ${identity.location}, currently at ${identity.company}. A living dashboard: contribution telemetry, the platforms behind it, and how they were built.`;

  const handle = handleFrom(identity.x);

  return {
    /**
     * Every relative URL in the Metadata API — `alternates.canonical`, the
     * generated OG image, per-post cover images — is resolved against this.
     * It is the *production* origin regardless of which host served the
     * request (ADR 017), so a preview deployment points its canonicals at the
     * site it is previewing rather than competing with it.
     */
    metadataBase: METADATA_BASE,

    /**
     * A plain string, which in a layout means "the default title for any
     * descendant segment that does not set one". `{ default: … }` is not
     * available without a `template` beside it (the type requires the pair),
     * and there is no template here on purpose — see the docblock above.
     */
    title: `${identity.name} — ${identity.role}`,
    description,

    /**
     * ── ADR 018: the index gate ────────────────────────────────────────────
     *
     * Off until `NEXT_PUBLIC_SITE_INDEXABLE=true`, set once at cutover on the
     * production deployment. Until then every route in the app — public pages
     * included — carries `noindex, nofollow`, and `robots.ts` says the same
     * thing at the door. Two mechanisms because they fail differently: a
     * crawler that ignores robots.txt still reads the meta tag, and a page
     * reached from an inbound link is never offered robots.txt at all.
     *
     * After cutover the directives are the permissive ones, plus the Googlebot
     * block that lets a result show a full-size image and an untruncated
     * snippet — the site is image-led and the descriptions quote live figures,
     * so a 160-character truncation is throwing away the argument.
     *
     * `/admin` and `/api` remain excluded from crawling. See `@/lib/seo`.
     */
    robots: IS_INDEXABLE
      ? {
          index: true,
          follow: true,
          googleBot: {
            index: true,
            follow: true,
            "max-image-preview": "large",
            "max-snippet": -1,
            "max-video-preview": -1,
          },
        }
      : { index: false, follow: false, nocache: true },

    /**
     * Card identity only — **no `title` and no `description`.**
     *
     * Next fills `og:title` and `og:description` from the *resolved* metadata
     * of whichever page is rendering whenever the Open Graph object does not
     * state them itself. Spelling them out here would pin every page's card to
     * the site-wide sentence, so /work would share as "A living dashboard…"
     * rather than as what /work is. Leaving them out is what makes each page's
     * card carry that page's own live description.
     *
     * `url` is absent for the same reason, and `alternates.canonical` on each
     * page carries the fact instead. See the docblock above.
     */
    openGraph: {
      type: "website",
      siteName: identity.name,
      locale: "en_AU",
    },

    twitter: {
      card: "summary_large_image",
      ...(handle !== null ? { creator: handle } : null),
    },

    applicationName: identity.name,
    authors: [{ name: identity.name, url: `https://github.com/${identity.github}` }],
    creator: identity.name,
    publisher: identity.name,

    /**
     * Phone numbers, dates and addresses are not auto-linked by iOS Safari.
     * The site prints a lot of dates and one street-ish location string, and
     * having them turn into blue tap targets breaks the type.
     */
    formatDetection: { telephone: false, date: false, address: false },
  };
}

/**
 * `https://x.com/coreybaines` → `@coreybaines`, or `null`.
 *
 * `identity.x` is stored as a full profile URL (that is what the admin field
 * asks for and what the footer links to), but `twitter:creator` wants the
 * handle. Parsed rather than assumed: an unparseable or empty value returns
 * `null` and the tag is simply not emitted, which is better than
 * `twitter:creator: "@"`.
 */
function handleFrom(profileUrl: string): string | null {
  const slug = profileUrl.trim().replace(/\/+$/, "").split("/").pop();
  if (!slug || slug.includes(".")) return null;
  return slug.startsWith("@") ? slug : `@${slug}`;
}

/**
 * There is deliberately no auth provider in this layout.
 *
 * `ConvexClientProvider` (src/components/auth) used to wrap `children` here. It
 * was inert — with no Clerk or Convex keys set it renders `children` and nothing
 * else — but *inertness is not weightlessness*: `@clerk/nextjs` and
 * `convex/react-clerk` are static imports inside a `"use client"` module, so
 * wrapping the tree here put **+76 KB gzip** of auth SDK into the shared client
 * chunk of every public route. Measured: one 76.6 KB chunk, loaded by the
 * homepage, for a provider that rendered nothing. Unset `NEXT_PUBLIC_` variables
 * stay runtime `process.env` lookups rather than being inlined, so no
 * arrangement of the gate lets dead-code elimination remove the imports.
 *
 * The homepage JS budget is < 100 KB gzip and phase 3 enforces it in CI from the
 * first page, so the provider is mounted where it is actually used instead: the
 * `/admin` layout, once phase 2 creates it (ADR 006 — "the public site does not
 * depend on it; a Clerk outage cannot take the site down, only editing"). Two
 * notes for whoever writes that layout:
 *
 *   - Mount it *inside* `<body>`, never around `<html>`. Clerk v7 (Core 3)
 *     requires it, and a provider around `<html>` is incompatible with Next's
 *     cache components.
 *   - Nothing on the public site may import it. If a public page ever needs live
 *     Convex data, use a Convex client without Clerk rather than dragging the
 *     auth SDK back into the shared chunk.
 *
 * The `generateMetadata` above is the one place this layout now touches the
 * read layer, and it does so through `@/lib/data` — a `server-only` module — so
 * the rule above is unaffected: no Convex code reaches a client chunk.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en-AU"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
