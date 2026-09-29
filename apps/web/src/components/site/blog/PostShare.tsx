"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

/**
 * Share this post: copy the link, hand it to a network, or — where the browser
 * offers one — the system share sheet.
 *
 * Every network target is a plain link to that network's own compose page.
 * There are no SDKs, no embedded buttons and no counters, so nothing third-party
 * loads until the reader chooses to go there. They open in a new tab because
 * the reader is leaving to do something and coming back to finish the post.
 *
 * `url` is the canonical address from the server (`SITE_URL`), not
 * `location.href`, so a share from a preview deployment or a URL carrying a
 * `#heading` fragment still points at the post.
 */

type CopyState = "idle" | "copied" | "failed";

const noopSubscribe = () => () => {};

/** `navigator.share` exists — false on the server, so hydration matches. */
function useCanNativeShare(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => typeof navigator.share === "function",
    () => false,
  );
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function PostShare({ url, title }: { url: string; title: string }) {
  const [copy, setCopy] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canShare = useCanNativeShare();

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function copyLink() {
    let next: CopyState = "copied";
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      next = "failed";
    }
    setCopy(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopy("idle"), 2400);
  }

  async function nativeShare() {
    try {
      await navigator.share({ title, url });
    } catch {
      // Dismissing the sheet rejects with AbortError; there is nothing to report.
    }
  }

  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title);

  const targets = [
    {
      label: "Share on X",
      href: `https://x.com/intent/post?text=${t}&url=${u}`,
      icon: (
        <Icon>
          <path d="M3 2.5l10 11M13 2.5l-10 11" />
        </Icon>
      ),
    },
    {
      label: "Share on LinkedIn",
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}`,
      icon: (
        <Icon>
          <rect x="2" y="2" width="12" height="12" rx="2.5" />
          <path d="M5.2 7.2v3.8M5.2 5v.01M7.8 11V8.6c0-.9.7-1.5 1.5-1.5s1.5.6 1.5 1.5V11M7.8 7.2V11" />
        </Icon>
      ),
    },
    {
      label: "Share on Bluesky",
      href: `https://bsky.app/intent/compose?text=${encodeURIComponent(`${title} ${url}`)}`,
      icon: (
        <Icon>
          <path d="M8 7.4C7 5.4 4.6 2.8 3 2.8c-1 0-1 1-1 1.7 0 .9.5 3.6 1.9 4.1 1.1.4 2.4.1 2.4.1S4 9.3 4.6 10.8c.6 1.4 2.3.6 3.4-1.6 1.1 2.2 2.8 3 3.4 1.6.6-1.5-1.7-2.1-1.7-2.1s1.3.3 2.4-.1C13.5 8.1 14 5.4 14 4.5c0-.7 0-1.7-1-1.7-1.6 0-4 2.6-5 4.6z" />
        </Icon>
      ),
    },
    {
      label: "Share by email",
      href: `mailto:?subject=${t}&body=${u}`,
      icon: (
        <Icon>
          <rect x="2" y="3.5" width="12" height="9" rx="2" />
          <path d="M2.5 4.5L8 8.6l5.5-4.1" />
        </Icon>
      ),
    },
  ];

  const copyLabel =
    copy === "copied" ? "Link copied" : copy === "failed" ? "Copy failed" : "Copy link";

  return (
    <div className="blog-share">
      <p className="blog-aside-label">Share</p>
      <div className="blog-share-row">
        <button
          type="button"
          className="blog-share-copy"
          onClick={copyLink}
          data-state={copy}
        >
          <Icon>
            {copy === "copied" ? (
              <path d="M3.5 8.4l3 3 6-7" />
            ) : (
              <>
                <path d="M6.8 9.2a2.8 2.8 0 004 0l2-2a2.8 2.8 0 00-4-4l-.6.6" />
                <path d="M9.2 6.8a2.8 2.8 0 00-4 0l-2 2a2.8 2.8 0 004 4l.6-.6" />
              </>
            )}
          </Icon>
          <span aria-live="polite">{copyLabel}</span>
        </button>

        <ul className="blog-share-targets">
          {targets.map((target) => (
            <li key={target.label}>
              <a
                href={target.href}
                target="_blank"
                rel="noopener noreferrer"
                className="blog-share-btn"
                aria-label={target.label}
                title={target.label}
              >
                {target.icon}
              </a>
            </li>
          ))}
          {canShare ? (
            <li>
              <button
                type="button"
                className="blog-share-btn"
                onClick={nativeShare}
                aria-label="More sharing options"
                title="More sharing options"
              >
                <Icon>
                  <path d="M8 2.5v7.5M5.2 5.2L8 2.5l2.8 2.7M4.5 7.5H4a1.5 1.5 0 00-1.5 1.5v3A1.5 1.5 0 004 13.5h8a1.5 1.5 0 001.5-1.5V9A1.5 1.5 0 0012 7.5h-.5" />
                </Icon>
              </button>
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
