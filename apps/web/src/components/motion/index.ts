/**
 * Motion, as the rest of the app is allowed to see it (ADR 013).
 *
 * The budget is the point: `LazyMotion` + `m` keeps the animation runtime out
 * of the initial bundle, and eslint.config.mjs makes importing the full
 * `motion` component — or `framer-motion` at all — an error rather than a
 * regression nobody notices for six months.
 *
 * `./features` is deliberately absent from this barrel. It is a chunk boundary,
 * not an export; only `MotionProvider`'s dynamic import may reach it.
 */
export { MotionProvider } from "./MotionProvider";
export { Rise, type RiseProps } from "./Rise";
