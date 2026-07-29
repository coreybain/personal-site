# Design QA — Pyrmont location card

## Evidence

- Source card state: `design-qa-contact-map-source.png`
- Source card crop: `design-qa-contact-map-source-crop.png`
- Live implementation: `design-qa-contact-map-implementation.png`
- Implementation crop: `design-qa-contact-map-implementation-crop.png`
- Side-by-side comparison: `design-qa-contact-map-comparison.png`
- Generated map asset: `apps/web/public/images/pyrmont-map.webp`
- Viewport: 1311 × 964, dark system theme

The source state was captured from the same local page and viewport with the
new decorative layer temporarily disabled, reproducing the selected card before
the requested map treatment. The implementation capture immediately restores
the final asset and styles.

## Design direction

Claude Opus was used as the requested design review. Its guidance informed the
bottom-right placement, low-opacity luminosity blend in dark mode, lighter
multiply treatment, protected text zone, mobile crop, and forced-colors
fallback.

## Visual comparison

### 1. Content

- `Based in` and `Sydney, Australia` remain unchanged.
- The existing location pin remains the sole semantic icon.
- The map contains no generated labels, logos, or competing text.

Result: passed.

### 2. Structure

- Card dimensions, padding, grid position, and content alignment are unchanged.
- The map is absolutely positioned behind the card content and cannot affect
  layout.
- The oversized raster extends beyond the card and is clipped by its existing
  rounded boundary.

Result: passed.

### 3. Style

- The asset uses the site's midnight, cool-grey, and violet-blue palette.
- A smaller wide Pyrmont/Darling Harbour crop now reveals more shoreline and
  street detail in the right corner while the left-side text stays quiet and
  legible.
- Dark mode uses a masked 26% soft-light frame; light mode uses 7.5% multiply
  with an inverted, higher-contrast map treatment.

Result: passed.

### 4. Behavior and responsiveness

- The image is decorative, non-interactive, non-selectable, and ignores pointer
  events.
- Below 640px the map frame narrows, moves farther outward, and reduces opacity.
- Forced-colors mode removes the decorative map and scrim entirely.

Result: passed.

### 5. Accessibility and system

- The map is rendered with an empty alternative and `aria-hidden="true"`.
- Location text and the pin remain above the map and protective scrim.
- The persisted light-theme hydration path was corrected so the visual check
  reloads without a React mismatch warning.
- The final WebP is 960 × 263 and approximately 15 KB.

Result: passed.

## Findings

- P0: none
- P1: none
- P2: none

Final result: passed.
