# Design QA — footer theme picker

## Evidence

- Source/problem reference: `design-qa-theme-source-normalized.png`
- Live implementation: `design-qa-theme-implementation.png`
- Focused implementation crop: `design-qa-theme-implementation-crop.png`
- Side-by-side comparison: `design-qa-theme-comparison.png`
- Source state: native operating-system select open in dark mode at 620 × 314
- Implementation state: custom menu open in dark mode at 1311 × 964, with a 620 × 314 component crop used for comparison

The supplied image documents the broken state rather than a visual target: the
native select is visually disconnected from the site and its unselected options
do not meet readable contrast. The implementation preserves the compact footer
placement while replacing that browser-owned surface with the site's own panel,
border, type, spacing, and interaction language.

## Visual comparison

### 1. Content

- The picker retains all three required preferences: System, Light, and Dark.
- Each option now includes concise supporting copy.
- The current preference is shown only on its option as an `Active` state; the
  redundant menu header has been removed.

Result: passed.

### 2. Structure

- The visible field has been replaced with a single circular icon button.
- The custom menu opens above and right-aligns to the trigger, which keeps it
  inside the viewport at the footer edge.
- Removing the header tightens the menu to the three actionable choices.
- Footer stacking was raised so the opaque menu covers, rather than sits behind,
  nearby case-study cards.

Result: passed.

### 3. Style

- The menu uses the existing opaque panel token, strong border token, inset
  highlight, site typography, and restrained accent color.
- Light and dark screenshots both show readable option labels, descriptions,
  and selected state.
- The trigger reuses the existing sun/moon theme glyph instead of introducing a
  new icon style.

Result: passed.

### 4. Behavior

- Selecting System clears the persisted override and follows
  `prefers-color-scheme`.
- Light and Dark remain persisted explicit choices.
- The menu supports pointer selection, outside-click dismissal, Arrow Up/Down,
  Home/End, and Escape with focus returned to the trigger.
- No native `select` remains in the rendered theme control.

Result: passed.

### 5. Accessibility and system

- The trigger exposes `aria-haspopup`, `aria-expanded`, and `aria-controls`.
- Options use `menuitemradio` with the selected preference exposed through
  `aria-checked`.
- Focus-visible styling is present, and reduced-motion mode removes menu and
  control transitions.
- Lint, TypeScript, production build, and `git diff --check` all pass.

Result: passed.

## Findings

- P0: none
- P1: none
- P2: none

Final result: passed.
