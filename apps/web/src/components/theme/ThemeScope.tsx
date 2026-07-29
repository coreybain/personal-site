"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { InlineScript } from "./InlineScript";

export type Theme = "light" | "dark";
export type ThemePreference = Theme | "system";

/** The one and only localStorage key. Shared by the inline script and React. */
export const THEME_STORAGE_KEY = "cb-theme";

const MEDIA_QUERY = "(prefers-color-scheme: dark)";

type ThemeContextValue = {
  /** The theme currently applied to the nearest scope. */
  theme: Theme;
  /** The user's selected source: the OS, light, or dark. */
  preference: ThemePreference;
  /** `true` once the user has explicitly picked; `false` while following the OS. */
  isExplicit: boolean;
  /** Set and persist. Marks the choice explicit — the OS stops driving it. */
  setTheme: (theme: Theme) => void;
  /** Flip light ⇄ dark. */
  toggleTheme: () => void;
  /** Forget the stored choice and go back to following `prefers-color-scheme`. */
  clearPreference: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Read the current scope. Throws if called outside a `<ThemeScope>`. */
export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useTheme() must be used inside a <ThemeScope>.");
  }
  return value;
}

function readStoredTheme(): Theme | null {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : null;
  } catch {
    // Private mode, disabled storage, sandboxed iframe — all non-fatal.
    return null;
  }
}

function readSystemTheme(): Theme {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(MEDIA_QUERY).matches
    ? "dark"
    : "light";
}

/**
 * The inline script, as source text. It is the *only* thing that decides the
 * theme on first paint; React's lazy state initialiser below reads the same two
 * inputs in the same order, so the two can never disagree.
 */
function bootScript(elementId: string): string {
  return `(function(){try{var e=document.getElementById(${JSON.stringify(
    elementId,
  )});if(!e)return;var t=null;try{t=window.localStorage.getItem(${JSON.stringify(
    THEME_STORAGE_KEY,
  )})}catch(_){}var p=t==="light"||t==="dark"?t:"system";if(p==="system"){t=window.matchMedia&&window.matchMedia(${JSON.stringify(
    MEDIA_QUERY,
  )}).matches?"dark":"light"}e.setAttribute("data-theme",t);e.setAttribute("data-theme-preference",p);e.style.colorScheme=t}catch(_){}})()`;
}

export type ThemeScopeProps = {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /**
   * What the server renders before the inline script corrects it. Only ever
   * visible to a client with JavaScript disabled. Defaults to `"light"`.
   */
  defaultTheme?: Theme;
};

/**
 * Wraps a variant in a themed scope.
 *
 * Renders a plain `<div>` carrying `data-theme="light" | "dark"` and a matching
 * `color-scheme`. Style everything beneath it off custom properties declared
 * under `.your-variant[data-theme="…"]` — see README.md in this directory.
 *
 * Flash-free by construction: an inline script placed immediately after the
 * wrapper's opening tag sets the attribute while the browser is still parsing,
 * so the first painted frame is already correct. `suppressHydrationWarning`
 * tells React to keep that DOM value instead of the server's placeholder.
 */
export function ThemeScope({
  children,
  className,
  style,
  defaultTheme = "light",
}: ThemeScopeProps) {
  const id = useId();

  // The first React render must match the server exactly. The inline script has
  // already corrected the wrapper attributes before paint; the effect below
  // then brings the context state into line without hydrating different child
  // content (for example, the footer picker's accessible label).
  const [theme, setThemeState] = useState<Theme>(defaultTheme);
  const [isExplicit, setIsExplicit] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const stored = readStoredTheme();
      setThemeState(stored ?? readSystemTheme());
      setIsExplicit(stored !== null);
      setHasMounted(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    setIsExplicit(true);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Persistence is best-effort; the session still themes correctly.
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const next: Theme = current === "dark" ? "light" : "dark";
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // ignore
      }
      return next;
    });
    setIsExplicit(true);
  }, []);

  const clearPreference = useCallback(() => {
    try {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } catch {
      // ignore
    }
    setIsExplicit(false);
    setThemeState(readSystemTheme());
  }, []);

  // Follow the OS, but only while the user hasn't overridden it.
  useEffect(() => {
    if (!hasMounted || isExplicit || typeof window.matchMedia !== "function") {
      return;
    }

    const mql = window.matchMedia(MEDIA_QUERY);
    const apply = (matches: boolean) => setThemeState(matches ? "dark" : "light");

    apply(mql.matches);
    const onChange = (event: MediaQueryListEvent) => apply(event.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [hasMounted, isExplicit]);

  // Keep other tabs in sync when the preference changes.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      if (event.newValue === "light" || event.newValue === "dark") {
        setIsExplicit(true);
        setThemeState(event.newValue);
      } else {
        setIsExplicit(false);
        setThemeState(readSystemTheme());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      preference: isExplicit ? theme : "system",
      isExplicit,
      setTheme,
      toggleTheme,
      clearPreference,
    }),
    [theme, isExplicit, setTheme, toggleTheme, clearPreference],
  );

  return (
    <div
      id={id}
      className={className}
      data-theme={theme}
      data-theme-preference={isExplicit ? theme : "system"}
      style={{ colorScheme: theme, ...style }}
      suppressHydrationWarning
    >
      {/* Must stay the first child: it runs the instant the div's tag is parsed. */}
      <InlineScript html={bootScript(id)} />
      <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
    </div>
  );
}
