import type { Metadata } from "next";
import type { ReactNode } from "react";

import "../blog/blog.css";
import "./preview.css";

/**
 * /preview — the private area for reviewing, scheduling and publishing posts
 * (docs/plans/preview-area.md). Never indexed: `noindex` here, `Disallow:
 * /preview` in robots.txt, and every page reads the session cookie so nothing
 * is cached.
 */
export const metadata: Metadata = {
  title: "Preview",
  robots: { index: false, follow: false, nocache: true },
};

export default function PreviewLayout({ children }: { children: ReactNode }) {
  return children;
}
