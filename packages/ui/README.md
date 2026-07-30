# `@home/ui`

The shared design system (plan phase 1, "design tokens"). Today it is **tokens
only** — one stylesheet, no React surface.

```
packages/ui/
├── src/
│   ├── tokens.css   # every design token, for every consumer
│   └── index.ts     # stub; shared primitives migrate here later
└── package.json
```

## `tokens.css`

The single place a colour, radius, shadow, ramp stop or easing curve is
*defined*. Two sections:

| Section     | Selector                             | What it is                                                                 |
| ----------- | ------------------------------------ | -------------------------------------------------------------------------- |
| **Base**    | `:root` + `prefers-color-scheme`     | Neutral page surface — `--background`, `--foreground`. Used by `/variants`. |
| **Horizon** | `.hor`, `.hor[data-theme="light\|dark"]` | The design system the real site runs on.                                |

Both moved verbatim out of `apps/web` (`src/app/globals.css` and
`src/app/(site)/horizon.css`) when this package was created. No name and no
value changed in the move.

Horizon is keyed off the `data-theme` attribute that `<ThemeScope>` writes, not
off `prefers-color-scheme` — the user may have overridden the OS. The contract
is documented in `apps/web/src/components/theme/README.md`; this file is the
"only the root class declares the light/dark pairs" half of it.

### What belongs here, and what does not

Tokens are definitions with more than one caller. These are **not** tokens and
stay with the component that owns them in `apps/web`:

- `--hor-nav-*` (nav pill corner radii), `--labs-*`, `--fun-h` — one consumer each.
- `--cb-toggle-*` — restyle hooks declared inside a CSS Module (`theme.module.css`).
  They are part of `<ThemeToggle>`'s public API, not the palette.
- `@theme inline { … }` in `apps/web/src/app/globals.css` — that is Tailwind
  *configuration*, and it maps `--font-geist-*` variables that `next/font`
  creates in the app. It reads tokens; it does not define them.

Route-level overrides are legal and live with the route:
`apps/web/src/app/(site)/resume/resume.css` re-declares the Horizon palette for
print at specificity (0,2,1) so it wins regardless of stylesheet order.

## Consuming it

```css
/* apps/web/src/app/globals.css */
@import "tailwindcss";
@import "@home/ui/tokens.css";
```

Tailwind v4's CSS resolver (`enhanced-resolve`, `conditionNames: ["style"]`)
reads the bare specifier through this package's `exports` map and inlines the
file, so the tokens land in the importing stylesheet's cascade position. The
import lives in `globals.css` rather than in a route stylesheet because
`globals.css` is loaded by the root layout: one import, every route, no
duplicated bytes.

## Adding shared components later

`src/index.ts` is a deliberate stub. Primitives migrate here when a second
consumer forces the API to be honest — `packages/pdf` (ADR 011) and the
`/admin` route group are the two on the horizon. Components read tokens through
`var(--…)` and never hardcode a colour, radius or easing curve.

## Scripts

| Script      | What it does                                       |
| ----------- | -------------------------------------------------- |
| `typecheck` | `tsc --noEmit`. No build step — `exports` points at source. |
