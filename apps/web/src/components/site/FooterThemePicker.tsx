"use client";

import { useId } from "react";

import {
  useTheme,
  type ThemePreference,
} from "@/components/theme/ThemeScope";

const OPTIONS: { label: string; value: ThemePreference }[] = [
  { label: "System", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];

/**
 * Footer-level theme preference control.
 *
 * The native select keeps the compact footer control keyboard- and
 * screen-reader-friendly. "System" removes the stored override, handing live
 * control back to `prefers-color-scheme`; Light and Dark remain deliberate
 * persisted choices.
 */
export function FooterThemePicker() {
  const id = useId();
  const { preference, setTheme, clearPreference } = useTheme();

  const choose = (next: ThemePreference) => {
    if (next === "system") {
      clearPreference();
      return;
    }

    setTheme(next);
  };

  return (
    <div className="hor-theme-control">
      <label className="hor-label" htmlFor={id}>
        Theme
      </label>
      <div className="hor-theme-select-wrap">
        <select
          id={id}
          className="hor-theme-select"
          value={preference}
          onChange={(event) =>
            choose(event.currentTarget.value as ThemePreference)
          }
        >
          {OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <svg
          className="hor-theme-select-icon"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="m3 4.5 3 3 3-3"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}
