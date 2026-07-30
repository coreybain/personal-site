# ADR 0013 — Motion (formerly Framer Motion) via `LazyMotion` + `m`

- **Date:** 2026-07-30
- **Status:** Accepted

## Context

The design direction calls for subtle, physical motion — Apple-style ease curves on entrance and
interaction. That argues for a real animation library rather than hand-written CSS transitions.
It also collides directly with a hard performance gate: homepage JS under 100 KB gzipped, LCP
under 1.2 s.

Importing `motion` pulls in the full feature set eagerly, roughly 34 KB+ before any of the site's
own code. Motion's `LazyMotion` wrapper plus the lightweight `m` component loads features
asynchronously instead, giving the full API for about 5 KB up front.

## Decision

Use **Motion**, wrapping the app in `LazyMotion` with async feature loading, and import **`m`**
rather than `motion` everywhere. Add a **lint rule banning direct `motion` imports** so the
bundle cannot silently regress. Respect `prefers-reduced-motion` throughout.

## Consequences

- Roughly 5 KB initial instead of ~34 KB+, which preserves the JS budget while keeping the full
  animation API available.
- The lint gate is the actual enforcement mechanism. Without it, one convenient `import { motion }`
  reintroduces the whole bundle, and the regression is invisible in review — this is listed in the
  plan's Risks for exactly that reason.
- The motion setup and its lint gate land in build phase 1, before there is any UI to regress.
- Motion applies to entrance and interaction only, never to data arrival: dashboard widgets render
  server-side at fixed dimensions, so there are no skeletons and no layout shift (CLS < 0.05).
