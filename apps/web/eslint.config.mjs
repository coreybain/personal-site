import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * ADR 013 — the motion budget, enforced.
 *
 * `motion` is the fully-featured component: importing it pulls the whole
 * animation runtime into the initial bundle and quietly cancels the code-split
 * that `LazyMotion` + `m` exist to buy. It is a one-line change with no visible
 * symptom, which is exactly the kind of regression a lint rule is for.
 *
 * `framer-motion` is the same library under its old name — `motion` depends on
 * it — so importing it directly would ship a second copy of the runtime and
 * sidestep every rule below.
 *
 * Allowed, and deliberately not listed: `LazyMotion`, `MotionConfig`,
 * `AnimatePresence`, the hooks, and `domAnimation` — all featherweight — plus
 * `m` from `motion/react-m`.
 */
const MOTION_MESSAGE =
  "ADR 013: import `m` from 'motion/react-m' and render it beneath <MotionProvider> (src/components/motion). The `motion` component defeats LazyMotion's code-splitting.";

const FRAMER_MESSAGE =
  "ADR 013: use the 'motion' package, not 'framer-motion' — importing both ships the animation runtime twice. See src/components/motion.";

const motionBudget = {
  name: "adr-013/motion-budget",
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: [
          {
            name: "motion/react",
            importNames: ["motion"],
            message: MOTION_MESSAGE,
          },
          {
            name: "motion/react-client",
            importNames: ["motion"],
            message: MOTION_MESSAGE,
          },
          {
            name: "framer-motion",
            message: FRAMER_MESSAGE,
          },
        ],
        // Catches the subpaths a `paths` entry cannot: framer-motion/m, /client…
        patterns: [
          {
            group: ["framer-motion/*"],
            message: FRAMER_MESSAGE,
          },
        ],
      },
    ],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  motionBudget,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
