"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

const COMMANDS = [
  "npx coreybaines",
  "bunx coreybaines",
  "pnpm dlx coreybaines",
  "yarn dlx coreybaines",
] as const;

type Command = (typeof COMMANDS)[number];
type CopyState = "idle" | "copied" | "failed";

/**
 * Copy the package-runner command from the profile card.
 *
 * The copy icon owns the menu-button interaction. Each menu item is an
 * immediate copy action; the visible command stays `npx coreybaines`.
 */
export function CommandCopyPicker() {
  const menuId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  const focusItem = (index: number) => {
    requestAnimationFrame(() => itemRefs.current[index]?.focus());
  };

  const openAndFocus = (index: number) => {
    setIsOpen(true);
    focusItem(index);
  };

  const copy = async (command: Command) => {
    let next: CopyState = "copied";

    try {
      await navigator.clipboard.writeText(command);
    } catch {
      next = "failed";
    }

    setCopyState(next);
    setStatusMessage(
      next === "copied" ? `Copied ${command}` : `Could not copy ${command}`,
    );
    setIsOpen(false);
    triggerRef.current?.focus();
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => {
      setCopyState("idle");
      setStatusMessage("");
    }, 2400);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isOpen && event.target === triggerRef.current) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        openAndFocus(0);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        openAndFocus(COMMANDS.length - 1);
      }
      return;
    }

    if (!isOpen) return;

    if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
      return;
    }

    const focusedIndex = itemRefs.current.findIndex(
      (item) => item === document.activeElement,
    );
    if (focusedIndex < 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusItem((focusedIndex + 1) % COMMANDS.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusItem((focusedIndex - 1 + COMMANDS.length) % COMMANDS.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusItem(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusItem(COMMANDS.length - 1);
    }
  };

  return (
    <div
      ref={rootRef}
      className="hor-command-picker"
      data-state={isOpen ? "open" : "closed"}
      data-copy-state={copyState}
      onKeyDown={onKeyDown}
    >
      <div className="hor-command-control">
        <code className="hor-command-value">{COMMANDS[0]}</code>

        <button
          ref={triggerRef}
          type="button"
          className="hor-command-copy"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          aria-controls={menuId}
          aria-label="Choose a command to copy"
          onClick={() => {
            if (isOpen) {
              setIsOpen(false);
            } else {
              openAndFocus(0);
            }
          }}
        >
          {copyState === "copied" ? (
            <svg
              width="15"
              height="15"
              viewBox="0 0 15 15"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="m3 7.8 2.8 2.8L12 4.4"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg
              width="15"
              height="15"
              viewBox="0 0 15 15"
              fill="none"
              aria-hidden="true"
            >
              <rect
                x="5"
                y="5"
                width="8"
                height="8"
                rx="1.7"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <path
                d="M10 5V3.5A1.5 1.5 0 0 0 8.5 2h-5A1.5 1.5 0 0 0 2 3.5v5A1.5 1.5 0 0 0 3.5 10H5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          )}
        </button>
      </div>

      {isOpen ? (
        <div id={menuId} className="hor-command-menu" role="menu">
          {COMMANDS.map((command, index) => (
            <button
              key={command}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              type="button"
              className="hor-command-option"
              role="menuitem"
              data-primary={index === 0 ? "true" : undefined}
              onClick={() => copy(command)}
            >
              <code>{command}</code>
            </button>
          ))}
        </div>
      ) : null}

      <span className="hor-command-status" role="status" aria-live="polite">
        {statusMessage}
      </span>
    </div>
  );
}
