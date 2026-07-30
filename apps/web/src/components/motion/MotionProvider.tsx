"use client";

import { LazyMotion, MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/**
 * Resolve the feature bundle after paint.
 *
 * `LazyMotion` treats a function as the async form: it calls this in an effect
 * and spreads the resolved bundle, so the promise must settle to the bundle
 * itself — hence the `.default` unwrap of the dynamic import.
 *
 * Declared at module scope, not inside the component: a new function identity
 * would be a new `features` prop, and the load would be re-issued on re-render.
 */
const loadFeatures = () => import("./features").then((mod) => mod.default);

/**
 * The site's one motion boundary (ADR 013).
 *
 * Two rules are enforced here rather than trusted to discipline at every call
 * site:
 *
 *   strict                 — `LazyMotion` throws if a full `motion.*` component
 *                            renders anywhere beneath it. Importing `motion`
 *                            pulls the entire feature set into the initial
 *                            bundle and silently undoes the code-split, so we
 *                            want that to fail loudly in development. The lint
 *                            rule in eslint.config.mjs catches it earlier still;
 *                            this is the runtime backstop.
 *   reducedMotion="user"   — every animation under this tree respects
 *                            `prefers-reduced-motion` without a single call
 *                            site opting in. Transform and layout animations
 *                            are dropped; opacity and colour still cross-fade,
 *                            which is the behaviour the guideline actually
 *                            asks for.
 *
 * Renders no DOM of its own — both children are context providers — so it can
 * be dropped into a layout without touching a single box.
 */
export function MotionProvider({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
