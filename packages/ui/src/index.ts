/**
 * @home/ui — the shared design system.
 *
 * Right now this package is **tokens only**. Every design token the site uses
 * lives in `./tokens.css`, which consumers pull in as a stylesheet:
 *
 *   @import "@home/ui/tokens.css";   // apps/web/src/app/globals.css
 *
 * There is deliberately no React surface yet. Shared primitives migrate here as
 * a second consumer appears and forces the API to be honest — `packages/pdf`
 * (the @react-pdf resume, ADR 011) and the `/admin` route group are the two on
 * the horizon. Until then a "shared" component would only ever have one caller,
 * and the abstraction would be guesswork rather than a distillation.
 *
 * When that day comes: components land in `src/<Name>.tsx`, get re-exported
 * from here, and read tokens through `var(--…)` — they never hardcode a colour,
 * radius or easing curve, exactly like the CSS in apps/web does today.
 */

export {};
