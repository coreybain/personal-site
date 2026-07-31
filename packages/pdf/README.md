# `@home/pdf`

The PDF résumé (ADR 011). `@react-pdf/renderer`, rendered server-side from the
same **Resume Document** the web résumé renders — real, selectable text, no
headless Chrome.

```ts
import { renderResumePdf, resumePdfFilename } from '@home/pdf';

const pdf = await renderResumePdf({
  identity,        // Pick<Identity, …> — apps/web's own value works by structure
  resume,          // ResumeDocument
  gitStats,        // Pick<GitStats, 'totalContributionsYear' | 'privateContributions'>
  computedAt,      // ISO instant of the snapshot behind gitStats
});
```

Full contract in [`src/props.ts`](./src/props.ts). Everything on it is a
`Pick<>` of `@home/types`, so **nothing here imports from `apps/web`** and a
schema rename breaks both renderers at once.

## Layout of the package

| Path | What it is |
|---|---|
| `src/props.ts` | `ResumePdfProps` — the input contract |
| `src/ResumePdf.tsx` | The document. Header, summary, ADR-012 live strip, experience, capabilities, education, footer |
| `src/theme.ts` | The print palette, the type scale, the page geometry |
| `src/fonts.ts` | `Font.register` for the vendored Geist files, and the word-break policy |
| `src/format.ts` | Deterministic, UTC-only formatting — a near-copy of apps/web's `format.tsx` |
| `src/render.ts` | `renderResumePdf` / `streamResumePdf` / `resumePdfFilename` |
| `scripts/` | The dev harness and its fixtures. Not shipped |
| `assets/fonts/` | Geist Sans 400/500/600 and Geist Mono 400/500, WOFF, plus `OFL.txt` |

## The harness

```sh
bun run render-fixture      # from packages/pdf
```

Writes five PDFs to `tmp/` (gitignored) from a copy of the web mock — no site,
no Convex, no environment. Read them.

| File | The question it answers |
|---|---|
| `fixture.pdf` | The real content. Two pages, breaking between EXPERIENCE and CAPABILITIES. Is page one full? Does the hierarchy read? |
| `fixture-long.pdf` | Six roles, long highlights, a 60-character URL. Do the breaks land sanely? Is a heading ever stranded? |
| `fixture-no-stats.pdf` | `embedGitStats: false`. The live strip must be **absent**, not empty |
| `fixture-maximal.pdf` | Every axis long at once. A load test for the page-break policy, not a plausible résumé |
| `fixture-minimal.pdf` | One role, three capabilities, **no education**, no strip. Does it degrade gracefully, or print an empty section? |

```bash
bun run orphan-sweep      # from packages/pdf
```

The eyeball pass above samples five content lengths. This one walks the content
past the page break a line at a time and checks every intermediate document for
stranded headings, split head groups and bad breaks — which is how the
`marginBottom` defect described below was found, at a 12pt-wide target that all
five fixtures missed. Needs Ghostscript (`brew install ghostscript`); without it
the sweep skips loudly and exits 0 rather than pretending to pass.

## Two things to know before you touch it

**Fonts are read from disk at render time.** They are committed under
`assets/fonts/` and registered from `new URL('../assets/fonts/…',
import.meta.url)`, because a URL would mean a network round-trip on every
serverless cold start — the latency ADR 011 rejected headless Chrome to avoid.

`outputFileTracingIncludes` is **not** needed for this, and `apps/web/next.config.ts`
deliberately does not set it. Turbopack recognises each of those expressions as
an asset reference, copies the file to `.next/server/assets/<name>.<hash>.woff`
and rewrites the expression to point there; the route's `.nft.json` then lists
all five copies, so they ship with the function. Verified against a real build —
the five `.woff` files appear under `.next/server/assets/`, the route's trace
includes them, the compiled route contains no reference to the source tree, and
`/api/resume.pdf` prerenders a 33 KB body during `next build`.

What that behaviour depends on is that **every font specifier stays a string
literal**. Build a path from a variable and Turbopack cannot see the reference,
nothing is copied, and the relative path resolves inside `.next` where the source
tree is not — see the note in `src/fonts.ts`, which sits next to the bug that
taught us. `registerResumeFonts()` turns that failure into one legible error
instead of an `ENOENT` deep inside fontkit; `RESUME_FONT_FILES` is exported so a
build assertion can check the same thing earlier.

**The page-break rules are load-bearing, and the tree is flat because of them.**
Two independent constraints, both easy to undo by accident:

*No wrappers.* Sections are not wrapped in per-section `<View>`s: @react-pdf
ignores `minPresenceAhead` on a node with no preceding sibling *within its own
container*, so a heading inside a wrapper strands at the foot of a page.

*No `marginBottom` in the wrapping flow.* @react-pdf decides "can this node
split" from the border box but "does this node fit" from the border box **plus
its bottom margin**, so a node whose content fits and whose margin does not is
relocated whole rather than split. With the bullet list in a wrapper carrying
`marginBottom: 12`, a role whose highlights ended within 12pt of the page foot
sent every one of them to the next page, adding a page and leaving 377pt of
white. Every gap in the flow is therefore a `marginTop` on whatever comes next.
`sectionHead` and the role head group keep their bottom margins deliberately —
they are `wrap={false}` or heading-like, where "relocate whole" is wanted.

Both, and the two @react-pdf behaviours worked around in the footer, are
documented at the point of use in `src/ResumePdf.tsx` and `src/theme.ts`. After
any structural change: re-run the harness, read `fixture-long.pdf`, and run
`orphan-sweep` — the second defect above is invisible to the first two.

## Licence

Geist is © 2023 Vercel, made in collaboration with basement.studio, licensed
under the SIL Open Font License 1.1. The full text is at
[`assets/fonts/OFL.txt`](./assets/fonts/OFL.txt). The `.woff` builds are taken
from `@fontsource/geist-sans@5.3.0` and `@fontsource/geist-mono@5.3.0` (latin
subset); `next/font/google`, which apps/web uses for the same family, only
materialises `.woff2`, which @react-pdf cannot read.
