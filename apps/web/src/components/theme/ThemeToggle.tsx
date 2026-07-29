"use client";

import type { ButtonHTMLAttributes } from "react";

import { useTheme } from "./ThemeScope";
import styles from "./theme.module.css";

type ThemeToggleProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick" | "type" | "children"
> & {
  /**
   * Appended to the thin base style, or used on its own when
   * `replaceClassName` is true.
   */
  className?: string;
  replaceClassName?: boolean;
  /**
   * Static override for the accessible name. Leave unset to get the
   * state-aware default ("Switch to dark theme" / "Switch to light theme").
   */
  label?: string;
};

type ThemeGlyphProps = {
  className?: string;
};

/**
 * The shared theme glyph used by theme controls across the site.
 *
 * The active sun/moon is selected entirely in CSS from the nearest
 * `data-theme` scope, keeping the icon correct before React hydrates.
 */
export function ThemeGlyph({ className }: ThemeGlyphProps) {
  const iconClassName = [styles.icon, className].filter(Boolean).join(" ");

  return (
    <>
      {/* Sun — visible while the scope is light. */}
      <svg
        className={`${iconClassName} ${styles.light}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.6v2.4M12 19v2.4M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2.6 12h2.4M19 12h2.4M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7" />
      </svg>

      {/* Moon — visible while the scope is dark. */}
      <svg
        className={`${iconClassName} ${styles.dark}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M20.4 14.2A8.4 8.4 0 0 1 9.8 3.6a8.4 8.4 0 1 0 10.6 10.6Z" />
      </svg>
    </>
  );
}

/**
 * Icon button that flips the nearest `<ThemeScope>`.
 *
 * Accessibility notes:
 * - A real `<button>`: tabbable, activates on Enter and Space, focus ring on
 *   `:focus-visible`.
 * - The accessible name comes from two visually-hidden spans that CSS shows or
 *   hides based on the scope's `data-theme`. Because the swap is CSS and not
 *   React state, the name is already correct on the first painted frame — no
 *   `aria-pressed` that could go stale between paint and hydration.
 * - Icons are `currentColor`, so a variant restyles them just by setting
 *   `color` on the button.
 */
export function ThemeToggle({
  className,
  replaceClassName = false,
  label,
  ...rest
}: ThemeToggleProps) {
  const { toggleTheme } = useTheme();

  const classes = replaceClassName
    ? className
    : [styles.toggle, className].filter(Boolean).join(" ");

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      className={classes}
      {...rest}
    >
      <ThemeGlyph />

      <span className={`${styles.srOnly} ${styles.light}`}>
        Switch to dark theme
      </span>
      <span className={`${styles.srOnly} ${styles.dark}`}>
        Switch to light theme
      </span>
    </button>
  );
}
