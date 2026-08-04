# Theme scope

Shared light/dark plumbing for the public Horizon design system.

---

## The contract in one paragraph

`<ThemeScope>` renders a `<div>` that carries `data-theme="light" | "dark"` and
`data-theme-preference="system" | "light" | "dark"`. The site passes its root
class to that div and declares **every** colour as a custom property under
`.hor[data-theme="…"]`. Nothing below the scope reads
`prefers-color-scheme` directly, and nothing below the scope hard-codes a
colour. Flip the attribute, the whole site re-skins.

---

## Usage

The page stays a **server component**. Only the scope and the toggle are client
components, and they are tiny.

```tsx
// src/app/(site)/layout.tsx  (server component)
import { ThemeScope } from "@/components/theme/ThemeScope";

export default function SiteLayout({ children }) {
  return (
    <ThemeScope className="hor" defaultTheme="dark">
      {children}
    </ThemeScope>
  );
}
```

`ThemeScope` accepts `children`, `className`, `style` and `defaultTheme`.

## Styling: custom properties, scoped to your wrapper

```css
/* src/app/(site)/horizon.css — imported by the route layout */

.hor {
  /* Structural tokens that don't change with the theme live here. */
  --hor-measure: 68ch;
  --hor-radius: 14px;

  background: var(--hor-bg);
  color: var(--hor-ink);
  transition: background-color 220ms ease, color 220ms ease;
}

.hor[data-theme="light"] {
  --hor-bg: #f7f7fb;
  --hor-ink: #14141c;
  --hor-accent: #4b46d8;
}

.hor[data-theme="dark"] {
  --hor-bg: #08080d;
  --hor-ink: #e9e9f2;
  --hor-accent: #9d99ff;
}

/* Everything else only ever references the vars. */
.hor .card {
  background: var(--hor-surface);
  border: 1px solid var(--hor-line);
}
```

Rules:

1. **Namespace custom properties** under `--hor-*`. CSS Modules hash class names
   but never custom property names, so an unprefixed `--bg` can leak.
2. **Every selector nests under the root class.**
3. **Only the root class declares the light/dark pairs.** Deeper components read
   vars; they never branch on `data-theme` themselves. That keeps the theme to
   exactly two places to look when a colour is wrong.
4. **Never use `@media (prefers-color-scheme: …)` below the scope.** The scope
   already resolved it, and the user may have overridden it.
5. Pair colour changes with a short `transition` on the root so toggling reads
   as a deliberate change rather than a jump. Respect
   `@media (prefers-reduced-motion: reduce)`.

CSS Modules work identically — use `.root[data-theme="dark"]` inside your
`*.module.css` and pass `styles.root` as the scope's `className`.

## Reading the theme in JS

Rarely needed — prefer CSS. When you do need it, the component must be a client
component and sit inside the scope:

```tsx
"use client";
import { useTheme } from "@/components/theme/ThemeScope";

export function Backdrop() {
  const { theme, isExplicit, setTheme, toggleTheme, clearPreference } = useTheme();
  return <canvas data-mode={theme} />;
}
```

`useTheme()` throws if it is called outside a `<ThemeScope>`.

## The toggle

```tsx
<ThemeToggle />                                  // thin base style
<ThemeToggle className="my-toggle" />            // base + your class
<ThemeToggle className="my-toggle" replaceClassName />  // yours only
```

Restyle hooks (set them on the button, or inherit from an ancestor):

| Property                 | Default        | Notes                       |
| ------------------------ | -------------- | --------------------------- |
| `--cb-toggle-size`       | `2.25rem`      | Hit area, square            |
| `--cb-toggle-icon-size`  | `1.125rem`     | Glyph box                   |
| `--cb-toggle-radius`     | `999px`        |                             |
| `--cb-toggle-ring`       | `currentColor` | `:focus-visible` outline    |
| `color`                  | inherited      | Icons are `currentColor`    |

Accessibility: it is a real `<button>` (tab/Enter/Space), its accessible name is
"Switch to dark theme" / "Switch to light theme", and both the glyph and that
name are swapped **in CSS** off the scope's `data-theme` — so they are correct
on the first painted frame and can never desync from the DOM. Pass `label` to
override the name with a static string.

## How the no-flash guarantee works

1. The server renders the wrapper with `data-theme={defaultTheme}` (`"light"`)
   and `data-theme-preference="system"`.
2. Immediately after the wrapper's opening tag — as its first child — sits an
   inline `<script>` (`InlineScript.tsx`). The browser executes it **while
   parsing**, before the first paint and long before React loads. It reads
   `localStorage["cb-theme"]`, falls back to `prefers-color-scheme`, and sets
   `data-theme`, `data-theme-preference` + `style.color-scheme` on the wrapper.
3. The wrapper has `suppressHydrationWarning`, so React keeps the DOM value
   rather than treating the difference as a hydration error. This matters: in
   React 19 an unsuppressed mismatch makes React client-render the whole
   boundary, which throws away the script's correction.
4. `ThemeScope`'s `useState` lazy initialisers read the *same two inputs in the
   same order* as the script, so React's first client render already agrees
   with the DOM.

Consequences to respect:

- **Keep `InlineScript` as the wrapper's first child.** Moving it after the
  content reintroduces a flash for everything above it.
- **Never read `window` during render** outside a lazy initialiser or effect.
  The scope is SSR'd.
- Storage is accessed in `try/catch` throughout — Safari private mode and
  sandboxed iframes throw on `localStorage`.
- The script is inline. If a strict CSP ever lands, it needs a nonce.

## System-preference and cross-tab behaviour

- No stored value → the scope follows `prefers-color-scheme` live, via a
  `matchMedia` `change` listener.
- Once the user toggles, the choice is written to `cb-theme` and the OS stops
  driving it. `clearPreference()` deletes the key and hands control back.
- A `storage` listener keeps other open tabs in sync.

## Files

| File                | Role                                                          |
| ------------------- | ------------------------------------------------------------- |
| `ThemeScope.tsx`    | Client. Wrapper div, inline boot script, context, listeners.  |
| `ThemeToggle.tsx`   | Client. Accessible sun/moon button.                            |
| `InlineScript.tsx`  | Renders a parse-time `<script>` that is inert on soft nav.     |
| `theme.module.css`  | Thin base style + CSS-driven light/dark swap for the toggle.   |
| `index.ts`          | Barrel.                                                        |
