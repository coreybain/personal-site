"use client";

import { domAnimation } from "motion/react";

/**
 * The feature bundle, in its own module so it can be code-split.
 *
 * `LazyMotion` accepts either a bundle (loaded with the page) or a function
 * returning a promise of one (loaded after paint). We use the second form, and
 * this file is the chunk boundary — nothing else may import it statically, or
 * the whole point is lost. See `MotionProvider`.
 *
 * `domAnimation` is the middle bundle: renderer + animations (`initial`,
 * `animate`, `exit`) + gestures (`whileHover`, `whileTap`, `whileFocus`). It
 * leaves out `drag` and layout projection, which is what `domMax` adds and what
 * costs the most. If a future feature genuinely needs layout animation, swap
 * this one export — every call site stays as it is.
 */
export default domAnimation;
