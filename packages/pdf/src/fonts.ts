/**
 * fonts.ts — font registration for @react-pdf/renderer.
 *
 * ── Why fonts are vendored rather than fetched ─────────────────────────────
 *
 * @react-pdf ships four "standard" PDF base-14 faces (Helvetica, Times, Courier,
 * Symbol). Using one of those would make the PDF look like a 1998 fax, and the
 * whole point of ADR 011 is a *real* document with selectable text and the
 * site's own voice. So the family has to be registered, and `Font.register`
 * takes either a URL or an absolute filesystem path.
 *
 * It must be a path. A URL means a network round-trip on every cold start of the
 * route that renders this — from a serverless function, to a CDN, before a byte
 * of PDF is written — which is precisely the class of latency ADR 011 rejected
 * headless Chrome to avoid. Worse, it makes the résumé un-renderable when the
 * font host is down. The files are therefore committed under `assets/fonts/` and
 * read off disk. **Nothing in this package performs a network request.**
 *
 * ── Which family, and the licence ──────────────────────────────────────────
 *
 * Geist — the same family apps/web loads through `next/font/google`, so the PDF
 * and the web résumé are the same typeface rather than merely similar ones. It
 * is licensed under the SIL Open Font License 1.1 (© 2023 Vercel, in
 * collaboration with basement.studio); the full text is committed beside the
 * files as `assets/fonts/OFL.txt`, which is what the licence requires of anyone
 * redistributing the binaries. Embedding a subset in a generated PDF is an
 * ordinary permitted use.
 *
 * `next/font/google` only ever materialises `.woff2`, which @react-pdf cannot
 * read. The `.woff` builds vendored here come from the Fontsource packaging of
 * the same upstream release (`@fontsource/geist-sans@5.3.0`,
 * `@fontsource/geist-mono@5.3.0`, latin subset), which publishes both formats.
 * WOFF is one of the two formats @react-pdf's fontkit fork accepts (the other is
 * TTF) and is roughly 40% smaller on disk for identical outlines.
 *
 * Five files, deliberately: sans at 400/500/600 and mono at 400/500. A print
 * document needs a regular, a medium for headings and a semibold for the name —
 * no italics (the design never uses one) and no 700+ (Geist 600 is already
 * emphatic at 26pt, and every unused weight is a file the deployment has to
 * carry).
 *
 * ── Resolving the path ─────────────────────────────────────────────────────
 *
 * `import.meta.url` rather than `__dirname` or `process.cwd()`: this is an ESM
 * package (`"type": "module"`) consumed by a bundler, and cwd is whatever the
 * host process happened to start in. See `RESUME_FONT_FILES` for the deployment
 * caveat that follows from reading files at runtime.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Font } from '@react-pdf/renderer';

/* ------------------------------------------------------------------ *
 * Family names
 * ------------------------------------------------------------------ */

/**
 * The registered family names, exported because a style object referring to a
 * family that was never registered fails at *render* time with a thrown error
 * rather than at compile time. Spelling them once means `theme.ts` cannot
 * mistype one.
 */
export const FONT_FAMILY = {
  sans: 'Geist',
  mono: 'GeistMono',
} as const;

/**
 * The weights actually registered, as constants.
 *
 * @react-pdf resolves a requested weight against the registered set with CSS
 * fallback rules, so asking for 700 when only 600 exists silently gets 600 —
 * a synthetic-looking result nobody notices until it is printed. Naming the
 * three that exist makes "use a weight that was vendored" a typecheck.
 */
export const FONT_WEIGHT = {
  regular: 400,
  medium: 500,
  semibold: 600,
} as const;

/* ------------------------------------------------------------------ *
 * Asset paths
 * ------------------------------------------------------------------ */

/**
 * The five vendored files, as absolute paths.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  One `new URL` per file, with a **literal** specifier. Never a variable.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * This was a two-line helper — `fontPath(file)` returning
 * `fileURLToPath(new URL(`../assets/fonts/${file}`, import.meta.url))` — and it
 * is correct everywhere the source tree is what runs: Bun, Node, the
 * `render-fixture` harness. It is silently wrong the moment a bundler is
 * between this file and the process, which is the only way it is ever reached
 * in production (`apps/web`'s `/api/resume.pdf` route).
 *
 * Turbopack and webpack both treat `new URL(<literal>, import.meta.url)` as an
 * **asset reference**: the file is copied into the build output and the
 * expression is rewritten to point at the copy, because `packages/pdf/assets`
 * does not exist next to a serverless bundle. That analysis requires the
 * specifier to be statically known. Given a template with a hole, Turbopack
 * emits every candidate in the directory — and then rewrites the single call
 * site to a single constant asset. Every call to the helper returned the same
 * path. Compiled, it read:
 *
 *     function l(t){return fileURLToPath(new URL(e.R(82028)))}   // t unused
 *
 * where 82028 was, arbitrarily, `GeistMono-Medium.woff`. The result of
 * `next build && curl /api/resume.pdf` was a résumé whose every glyph came from
 * one face:
 *
 *     /BaseFont /ASPDOI+GeistMono-Medium      ← the whole document
 *     …against the harness's correct five:
 *     /BaseFont /HTSLNW+Geist-Regular, +Geist-Medium, +Geist-SemiBold,
 *     /BaseFont /KSPXHZ+GeistMono-Medium, +GeistMono-Regular
 *
 * Nothing threw, and nothing could have: `assertResumeFontsPresent()` below
 * read one real file five times and was satisfied, `Font.register` bound the
 * sans family to the mono file without complaint, and the document rendered —
 * in monospace, at 16 KB instead of 34. The failure was visible only by reading
 * the produced PDF. A guard cannot catch a path that resolves to a file that
 * exists; only the literals below prevent it.
 *
 * So the repetition is deliberate: it is the contract with the bundler. **A new
 * weight means a new literal here.** Any refactor that reintroduces a computed
 * specifier reintroduces the bug, without an error to show for it.
 *
 * ── On file tracing ────────────────────────────────────────────────────────
 *
 * Because the bundler rewrites these to its own emitted copies, the deployed
 * function reads `.next/server/assets/GeistSans-Regular.<hash>.woff`, not the
 * repo path — so `outputFileTracingIncludes` is *not* what makes this work, and
 * `apps/web/next.config.ts` deliberately declares none. It would not help
 * either: a build that failed to rewrite the URL would be resolving
 * `../assets/fonts/` relative to a chunk inside `.next`, where a traced copy of
 * the source tree is not. The real guard is the literal.
 */
const SANS_REGULAR = fileURLToPath(
  new URL('../assets/fonts/GeistSans-Regular.woff', import.meta.url),
);
const SANS_MEDIUM = fileURLToPath(
  new URL('../assets/fonts/GeistSans-Medium.woff', import.meta.url),
);
const SANS_SEMIBOLD = fileURLToPath(
  new URL('../assets/fonts/GeistSans-SemiBold.woff', import.meta.url),
);
const MONO_REGULAR = fileURLToPath(
  new URL('../assets/fonts/GeistMono-Regular.woff', import.meta.url),
);
const MONO_MEDIUM = fileURLToPath(
  new URL('../assets/fonts/GeistMono-Medium.woff', import.meta.url),
);

/**
 * Every font file this package needs, as absolute paths.
 *
 * Exported for diagnosis: `assertResumeFontsPresent()` below turns a missing
 * asset from "ENOENT somewhere inside fontkit, during render, after the
 * response headers were sent" into one legible error at registration time. It
 * is also the list a build assertion can walk.
 *
 * It does **not** catch the misresolution described above — see that note.
 */
export const RESUME_FONT_FILES: readonly string[] = [
  SANS_REGULAR,
  SANS_MEDIUM,
  SANS_SEMIBOLD,
  MONO_REGULAR,
  MONO_MEDIUM,
];

/* ------------------------------------------------------------------ *
 * Hyphenation
 * ------------------------------------------------------------------ */

/**
 * Word-break policy for the whole document: **never break a word.**
 *
 * ── Why the default is wrong here ──────────────────────────────────────────
 *
 * @react-pdf hyphenates by default, with the en-US Liang patterns, and inserts a
 * real hyphen glyph at the break (`insertGlyph(…, HYPHEN, …)` in
 * `@react-pdf/textkit`'s `breakLines`). On a magazine column that is correct
 * typography. On a résumé it is not: hyphenation is a device for justified text
 * and every measure in this document is ragged-right, where a broken word buys
 * nothing and costs a reader a beat on a page they are skimming in ten seconds.
 * Returning `[word]` is the documented way to switch it off.
 *
 * ── Why URLs are not the exception they look like ──────────────────────────
 *
 * The tempting refinement is to keep hyphenation off for prose but split long
 * URLs at their slashes, since an unbreakable token wider than its column
 * overflows silently — @react-pdf does not clip it, it draws past the edge and
 * into the margin. That refinement was written, rendered, and reverted, because
 * the hyphen is inserted at *every* break the callback authorises, whatever the
 * reason for it. A URL split after `https://` printed as
 *
 *     …the measured results at https://-
 *     coreybaines.com/labs/agent-assisted-delivery-measurements
 *
 * — a character that is not in the URL, in a string whose entire value is being
 * transcribable. Corrupting an address is strictly worse than letting a rare
 * long one run wide, and there is no way to authorise the break without also
 * authorising the glyph.
 *
 * ── What that leaves ───────────────────────────────────────────────────────
 *
 * A token wider than its measure overflows rather than wrapping. The measures
 * here make that a theoretical problem: body copy runs to ~440pt, which is about
 * 95 characters at 9pt, and the narrowest column in the document (the header's
 * contact values) takes ~28 characters at 8.5pt — enough for
 * `linkedin.com/in/coreybaines` with the `www.` stripped, which is why
 * `bareUrl` in format.ts strips it. A URL longer than that belongs in the case
 * study it points at, not on the résumé.
 *
 * Exported, and kept as a named function rather than an inline arrow, so a test
 * can assert the policy directly rather than by rendering a PDF and reading it.
 */
export function resumeHyphenationCallback(word: string): string[] {
  return [word];
}

/* ------------------------------------------------------------------ *
 * Registration
 * ------------------------------------------------------------------ */

/**
 * `Font` is a module-scoped singleton inside @react-pdf, so registering twice in
 * one process appends duplicate sources to the family. Harmless, but it means
 * every render after the first re-resolves a longer list, and in a long-lived
 * server that list grows without bound. This flag makes registration idempotent.
 */
let registered = false;

/**
 * Fail loudly, at registration, if the vendored files did not make it into the
 * deployment. See `RESUME_FONT_FILES` for why that can happen.
 *
 * `readFileSync` rather than `existsSync`: the failure mode being guarded is
 * "the bundler copied a directory entry but not its contents", and only a read
 * proves otherwise. One byte is enough — the file is not kept, @react-pdf reads
 * it again itself.
 */
function assertResumeFontsPresent(): void {
  for (const file of RESUME_FONT_FILES) {
    try {
      readFileSync(file);
    } catch (cause) {
      throw new Error(
        `@home/pdf: font asset missing at ${file}. The vendored Geist files are ` +
          'committed under packages/pdf/assets/fonts; in a bundled deployment they ' +
          'are read from the copies the bundler emits for each `new URL(…, ' +
          'import.meta.url)` in fonts.ts, so this means that rewrite did not happen. ' +
          'Check that every specifier there is still a string literal — see the note ' +
          'on RESUME_FONT_FILES.',
        { cause },
      );
    }
  }
}

/**
 * Register Geist (sans 400/500/600, mono 400/500) and the document's word-break
 * policy. Idempotent; call it before every render rather than at module scope,
 * so that importing this package for its *types* never touches the filesystem.
 */
export function registerResumeFonts(): void {
  if (registered) return;

  assertResumeFontsPresent();

  Font.register({
    family: FONT_FAMILY.sans,
    fonts: [
      { src: SANS_REGULAR, fontWeight: FONT_WEIGHT.regular },
      { src: SANS_MEDIUM, fontWeight: FONT_WEIGHT.medium },
      { src: SANS_SEMIBOLD, fontWeight: FONT_WEIGHT.semibold },
    ],
  });

  Font.register({
    family: FONT_FAMILY.mono,
    fonts: [
      { src: MONO_REGULAR, fontWeight: FONT_WEIGHT.regular },
      { src: MONO_MEDIUM, fontWeight: FONT_WEIGHT.medium },
    ],
  });

  Font.registerHyphenationCallback(resumeHyphenationCallback);

  registered = true;
}
