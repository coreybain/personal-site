"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import {
  useTheme,
  type ThemePreference,
} from "@/components/theme/ThemeScope";
import { ThemeGlyph } from "@/components/theme/ThemeToggle";

const OPTIONS: {
  description: string;
  label: string;
  value: ThemePreference;
}[] = [
  { label: "System", description: "Follow this device", value: "system" },
  { label: "Light", description: "Always use light", value: "light" },
  { label: "Dark", description: "Always use dark", value: "dark" },
];

/**
 * Footer-level theme preference control.
 *
 * "System" removes the stored override, handing live control back to
 * `prefers-color-scheme`; Light and Dark remain deliberate persisted choices.
 */
export function FooterThemePicker() {
  const labelId = useId();
  const menuId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const { preference, setTheme, clearPreference } = useTheme();
  const currentLabel =
    OPTIONS.find((option) => option.value === preference)?.label ?? "System";

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const selectedIndex = Math.max(
      0,
      OPTIONS.findIndex((option) => option.value === preference),
    );

    optionRefs.current[selectedIndex]?.focus();

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen, preference]);

  const choose = (next: ThemePreference) => {
    if (next === "system") {
      clearPreference();
    } else {
      setTheme(next);
    }

    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const moveFocus = (index: number) => {
    const nextIndex = (index + OPTIONS.length) % OPTIONS.length;
    optionRefs.current[nextIndex]?.focus();
  };

  const handleOptionKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveFocus(index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveFocus(0);
    } else if (event.key === "End") {
      event.preventDefault();
      moveFocus(OPTIONS.length - 1);
    }
  };

  return (
    <div className="hor-theme-control" ref={rootRef}>
      <span className="hor-label" id={labelId}>
        Theme
      </span>
      <div className="hor-theme-picker">
        <button
          ref={triggerRef}
          type="button"
          className="hor-theme-trigger"
          aria-label={`Choose theme. Current preference: ${currentLabel}`}
          aria-labelledby={labelId}
          aria-haspopup="menu"
          aria-controls={menuId}
          aria-expanded={isOpen}
          data-state={isOpen ? "open" : "closed"}
          onClick={() => setIsOpen((open) => !open)}
        >
          <ThemeGlyph className="hor-theme-trigger-icon" />
        </button>

        {isOpen ? (
          <div
            id={menuId}
            className="hor-theme-menu"
            role="menu"
            aria-labelledby={labelId}
          >
            <div className="hor-theme-options">
              {OPTIONS.map((option, index) => {
                const isSelected = option.value === preference;

                return (
                  <button
                    key={option.value}
                    ref={(element) => {
                      optionRefs.current[index] = element;
                    }}
                    type="button"
                    className="hor-theme-option"
                    role="menuitemradio"
                    aria-checked={isSelected}
                    data-selected={isSelected ? "true" : "false"}
                    onClick={() => choose(option.value)}
                    onKeyDown={(event) => handleOptionKeyDown(event, index)}
                  >
                    <span className="hor-theme-option-copy">
                      <span className="hor-theme-option-label">
                        {option.label}
                      </span>
                      <span className="hor-theme-option-description">
                        {option.description}
                      </span>
                    </span>
                    {isSelected ? (
                      <span className="hor-theme-option-state">
                        Active
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
