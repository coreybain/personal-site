"use client";

import { useEffect } from "react";

const RETURN_POINT_KEY = "coreybaines:work-return-point";
const RETURN_PENDING_KEY = "coreybaines:work-return-pending";

type ReturnPoint = {
  x: number;
  y: number;
};

function readReturnPoint(): ReturnPoint | null {
  try {
    const value = sessionStorage.getItem(RETURN_POINT_KEY);
    if (!value) return null;

    const point = JSON.parse(value) as Partial<ReturnPoint>;
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;

    return { x: point.x ?? 0, y: point.y ?? 0 };
  } catch {
    return null;
  }
}

function isCaseStudyLink(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;

  const anchor = target.closest<HTMLAnchorElement>("a[href]");
  if (!anchor) return false;

  const url = new URL(anchor.href, window.location.href);
  return (
    url.origin === window.location.origin &&
    /^\/work\/[^/]+\/?$/.test(url.pathname)
  );
}

/**
 * Remembers the exact index position when a case study is opened, then restores
 * it on the next visit to `/work`. The pending flag prevents an old position
 * from affecting direct visits to the work index.
 */
export function WorkScrollRestoration() {
  useEffect(() => {
    let firstFrame = 0;
    let secondFrame = 0;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;

    try {
      if (sessionStorage.getItem(RETURN_PENDING_KEY) === "true") {
        const point = readReturnPoint();

        if (point) {
          const restore = () => {
            window.scrollTo(point.x, point.y);
            sessionStorage.removeItem(RETURN_PENDING_KEY);
          };

          firstFrame = window.requestAnimationFrame(() => {
            secondFrame = window.requestAnimationFrame(restore);
          });
          settleTimer = setTimeout(restore, 120);
        } else {
          sessionStorage.removeItem(RETURN_PENDING_KEY);
        }
      }
    } catch {
      // Storage can be unavailable in privacy-restricted browsing contexts.
    }

    const captureReturnPoint = (event: MouseEvent) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !isCaseStudyLink(event.target)
      ) {
        return;
      }

      try {
        sessionStorage.setItem(
          RETURN_POINT_KEY,
          JSON.stringify({ x: window.scrollX, y: window.scrollY }),
        );
        sessionStorage.setItem(RETURN_PENDING_KEY, "true");
      } catch {
        // Navigation should still work if storage is unavailable.
      }
    };

    document.addEventListener("click", captureReturnPoint, true);

    return () => {
      document.removeEventListener("click", captureReturnPoint, true);
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      if (settleTimer) clearTimeout(settleTimer);
    };
  }, []);

  return null;
}
