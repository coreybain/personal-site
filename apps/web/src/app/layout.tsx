import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "coreybaines.com — homepage style explorations",
  description:
    "Four full-fidelity homepage directions for coreybaines.com, all reading from one snapshot.",
};

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
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
