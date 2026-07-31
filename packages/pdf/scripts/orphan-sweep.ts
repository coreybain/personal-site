/**
 * orphan-sweep.ts — the page-break policy, proved rather than eyeballed.
 *
 *     bun run orphan-sweep        # from packages/pdf
 *
 * ── What this answers that render-fixture.ts cannot ────────────────────────
 *
 * `src/ResumePdf.tsx` makes three claims about page breaks: a section heading is
 * never the last thing on a page, a role's head group never straddles a break,
 * and a role never leaves its heading behind. Rendering four fixed fixtures
 * checks those claims at four arbitrary content lengths. It cannot check them at
 * the lengths that matter, because the failure is positional — a heading only
 * strands when it happens to land within a few points of the page foot, and no
 * hand-written fixture reliably puts it there.
 *
 * So this walks the content past the break instead. It renders the base document
 * once per step, adding one highlight line each time, which slides every
 * subsequent role heading down the page a line at a time until each one has
 * occupied every position within the break zone. If `minPresenceAhead` is wrong
 * — or silently disabled by a wrapper `View`, which is the failure mode
 * ResumePdf.tsx's flattening note describes — one of these steps lands a heading
 * at the foot of a page and this script says which one.
 *
 * ── How a break is judged ──────────────────────────────────────────────────
 *
 * The rendered PDF is read back as text, one block of lines per page, and each
 * page's last line is compared against the set of strings that must never be
 * last:
 *
 *   • a section label (EXPERIENCE / CAPABILITIES / EDUCATION)
 *   • a role title, or a role title followed only by its company and dates
 *
 * plus the orphan-*page* failure: a final page carrying almost nothing.
 *
 * Reading the text back needs a real extractor, and this script shells out to
 * Ghostscript's `txtwrite` device for it rather than shipping one. @react-pdf
 * embeds subsetted CID fonts with Identity encoding, so the `TJ` operands are
 * glyph indices, not characters; recovering strings means resolving each font's
 * `/ToUnicode` CMap and tracking `Tf` across the content stream. That is a
 * hundred lines of PDF plumbing to answer a question `gs -sDEVICE=txtwrite`
 * already answers exactly, and this is a QA script rather than shipped code.
 *
 * The dependency is therefore deliberate and it is checked: with no `gs` on
 * PATH the sweep **skips loudly and exits 0**, because a missing dev tool is not
 * a layout regression. It never silently passes — a run that proves nothing says
 * so on the first line of output.
 *
 *     brew install ghostscript
 *
 * Exit code 1 on any violation, so where `gs` exists this is a real gate.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { renderResumePdf } from '../src/render';
import type { ResumePdfProps } from '../src/props';

import { resumeFixture } from './fixture';

/* ------------------------------------------------------------------ *
 * Reading the rendered document back
 * ------------------------------------------------------------------ */

/** Is Ghostscript on PATH? Checked once; see this file's header. */
function hasGhostscript(): boolean {
  const probe = spawnSync('gs', ['--version'], { encoding: 'utf8' });
  return probe.status === 0;
}

/**
 * How many pages the document paginated to.
 *
 * Counted from the `/Type /Page` objects rather than asked of Ghostscript,
 * because it is one regex against a buffer already in memory and because the
 * page *count* is itself a thing the sweep reports. `/Type /Pages` (the tree
 * node) must not match, hence the trailing boundary.
 */
function pageCount(buffer: Buffer): number {
  const matches = buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 0;
}

/**
 * How much empty page sits between the last mark of content and the footer rule,
 * per page, in points.
 *
 * ── Why this exists alongside the text check ───────────────────────────────
 *
 * The text check asks "is the last *line* on this page a heading". That turns
 * out to be too narrow: a role's head group is a title, a company, a date and
 * two lines of summary, so when the group strands, the page's last line is a
 * sentence and the check sees nothing wrong. The first version of this script
 * passed a document whose page one ended with a stranded role head above 380pt
 * of white — the exact failure it was written to catch.
 *
 * Trailing whitespace catches that class without knowing anything about what
 * stranded or why. A page that is followed by more pages has, by definition,
 * run out of room; if it ran out of room with a third of the sheet still blank,
 * something atomic refused to fit and the break is bad regardless of which node
 * it was.
 *
 * Measured by rasterising the page and finding the last inked row above the
 * footer, because the footer and the running head are `fixed` and would
 * otherwise put ink at the bottom of every page. 72dpi is enough — the question
 * is answered to the nearest point and a 0.75pt hairline still marks a row.
 */
function trailingWhitespace(dir: string, path: string, page: number): number {
  const raster = join(dir, `page-${page}.pgm`);
  const run = spawnSync(
    'gs',
    [
      '-q',
      '-dNOPAUSE',
      '-dBATCH',
      '-sDEVICE=pgmraw',
      '-r72',
      `-dFirstPage=${page}`,
      `-dLastPage=${page}`,
      `-sOutputFile=${raster}`,
      path,
    ],
    { encoding: 'utf8' },
  );
  if (run.status !== 0) throw new Error(`gs raster failed: ${run.stderr}`);

  const buf = readFileSync(raster);
  // `P5 <w> <h> <maxval>` then one whitespace byte then the raster. Tokenised
  // rather than regexed because Ghostscript writes a `# Image generated by …`
  // comment line straight after the magic, and a regex that assumes it away
  // fails on every file this script produces.
  const head = buf.subarray(0, 128).toString('latin1');
  const tokens: string[] = [];
  let i = 0;
  while (tokens.length < 4 && i < head.length) {
    while (i < head.length && /\s/.test(head[i] ?? '')) i += 1;
    if (head[i] === '#') {
      while (i < head.length && head[i] !== '\n') i += 1;
      continue;
    }
    let j = i;
    while (j < head.length && !/\s/.test(head[j] ?? '')) j += 1;
    tokens.push(head.slice(i, j));
    i = j;
  }
  if (tokens[0] !== 'P5' || tokens.length < 4) {
    throw new Error(`unexpected PGM header: ${tokens.join(' ')}`);
  }
  const width = Number(tokens[1]);
  const height = Number(tokens[2]);
  const start = i + 1; // the single whitespace byte that ends the header

  // Everything below FOOTER_TOP is furniture. Everything above CONTENT_TOP is
  // the running head, which is furniture too.
  const FOOTER_TOP = 790;
  const CONTENT_TOP = 34;
  const limit = Math.min(FOOTER_TOP, height);

  for (let y = limit - 1; y >= CONTENT_TOP; y -= 1) {
    const row = start + y * width;
    for (let x = 0; x < width; x += 1) {
      if ((buf[row + x] ?? 255) < 245) return FOOTER_TOP - y;
    }
  }
  return FOOTER_TOP - CONTENT_TOP;
}

/**
 * The document's text, one array of trimmed lines per page.
 *
 * Extracted a page at a time with `-dFirstPage`/`-dLastPage`. txtwrite does
 * *not* write a form feed between pages, so a single invocation returns one
 * undelimited blob — which is exactly the mistake that makes a sweep report "1
 * page" for a two-page document and pass everything. One call per page is
 * slower and unambiguous.
 *
 * Blank lines are dropped: `-dTextFormat=3` pads with whitespace to preserve
 * column positions, and the question here is only which content is on which
 * page.
 */
function pagesFromPdf(buffer: Buffer, dir: string): string[][] {
  const path = join(dir, 'sweep.pdf');
  writeFileSync(path, buffer);

  const total = pageCount(buffer);
  const pages: string[][] = [];

  for (let p = 1; p <= total; p += 1) {
    const run = spawnSync(
      'gs',
      [
        '-q',
        '-dNOPAUSE',
        '-dBATCH',
        '-sDEVICE=txtwrite',
        '-dTextFormat=3',
        `-dFirstPage=${p}`,
        `-dLastPage=${p}`,
        '-sOutputFile=-',
        path,
      ],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    );

    if (run.status !== 0) {
      throw new Error(`gs failed on page ${p}: ${run.stderr || run.stdout}`);
    }

    pages.push(
      run.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    );
  }

  return pages;
}

/* ------------------------------------------------------------------ *
 * The rules
 * ------------------------------------------------------------------ */

const SECTION_LABELS = ['EXPERIENCE', 'CAPABILITIES', 'EDUCATION'];

/** Footer and running-head runs, which are `fixed` and say nothing about flow. */
function isFurniture(run: string, props: ResumePdfProps): boolean {
  if (/^\d+\s*\/\s*\d+$/.test(run)) return true;
  if (run.startsWith('Generated ')) return true;
  if (run === props.identity.name.toUpperCase()) return true;
  if (run.includes('·') && run === run.toUpperCase() && run.includes('.COM'))
    return true;
  return false;
}

type Violation = { step: number; page: number; kind: string; detail: string };

/**
 * How much white a page may end with and still be a defensible break, in points.
 *
 * The tallest thing that legitimately refuses to split is a role's head group
 * (~70pt) plus the `minPresenceAhead={46}` it asks for below itself — about
 * 116pt. A page that breaks with more white than that under its last line broke
 * for a reason the layout did not intend.
 *
 * Deliberately generous. This is a gate, and a gate that cries wolf gets
 * disabled; every point of slack here is a real orphan it will not catch, which
 * is the trade being made.
 */
const MAX_TRAILING_WHITESPACE = 130;

function checkDocument(
  pages: string[][],
  props: ResumePdfProps,
  step: number,
  whitespace: number[],
): Violation[] {
  const out: Violation[] = [];

  // A page that ran out of room with a third of the sheet blank did not run out
  // of room. Checked on every page but the last, which is allowed to end early
  // by definition.
  whitespace.slice(0, -1).forEach((white, i) => {
    if (white > MAX_TRAILING_WHITESPACE) {
      out.push({
        step,
        page: i + 1,
        kind: 'bad-break',
        detail:
          `page breaks with ${Math.round(white)}pt of white below its last line ` +
          `(budget ${MAX_TRAILING_WHITESPACE}pt) — something atomic refused to fit`,
      });
    }
  });
  const titles = new Set(props.resume.experience.map((r) => r.title));
  const companies = new Set(props.resume.experience.map((r) => r.company));

  pages.forEach((runs, i) => {
    const flow = runs.filter((r) => !isFurniture(r, props));
    if (flow.length === 0) {
      out.push({
        step,
        page: i + 1,
        kind: 'empty-page',
        detail: 'no flow content recovered — extractor or layout broke',
      });
      return;
    }

    const last = flow[flow.length - 1] ?? '';
    const isLastPage = i === pages.length - 1;

    // A section label must never be the last thing on a page.
    if (SECTION_LABELS.includes(last)) {
      out.push({
        step,
        page: i + 1,
        kind: 'stranded-section-heading',
        detail: `page ends with "${last}"`,
      });
    }

    // A role title must never be the last thing on a page, nor a title
    // trailed only by its company (the head group split across the break).
    const tail = flow.slice(-3);
    const titleIdx = tail.findIndex((r) => titles.has(r));
    if (titleIdx !== -1) {
      const after = tail.slice(titleIdx + 1);
      const onlyOrgOrDates = after.every(
        (r) => companies.has(r) || /\d{4}|Present/.test(r),
      );
      if (onlyOrgOrDates) {
        out.push({
          step,
          page: i + 1,
          kind: 'stranded-role-head',
          detail: `page ends with role "${tail[titleIdx]}" and nothing under it`,
        });
      }
    }

    // The mirror failure: a page whose last flow run is a role summary, with
    // the bullets it belongs to starting the next page, is acceptable; a page
    // that *ends* on a heading is not. Also flag a final page carrying almost
    // nothing, which is the orphan-page failure rather than the orphan-line one.
    if (isLastPage && pages.length > 1 && flow.length <= 6) {
      out.push({
        step,
        page: i + 1,
        kind: 'orphan-final-page',
        detail: `last page carries only ${flow.length} flow runs: ${flow.join(' | ')}`,
      });
    }
  });

  return out;
}

/* ------------------------------------------------------------------ *
 * The sweep
 * ------------------------------------------------------------------ */

/** How many one-line highlights to add before giving up. 24 lines ≈ 1.6 pages. */
const STEPS = 24;

/**
 * The base document with `n` filler highlights appended to its first role.
 *
 * The filler is one line at 9pt within `MEASURE`, so every step moves everything
 * below it down by exactly one line-height and the sweep is a true scan rather
 * than a set of jumps.
 */
function withFiller(n: number): ResumePdfProps {
  const [first, ...rest] = resumeFixture.resume.experience;
  if (!first) throw new Error('fixture has no experience entries');

  const filler = Array.from(
    { length: n },
    (_, i) => `Sweep filler line ${String(i + 1).padStart(2, '0')}`,
  );

  return {
    ...resumeFixture,
    resume: {
      ...resumeFixture.resume,
      experience: [
        { ...first, highlights: [...first.highlights, ...filler] },
        ...rest,
      ],
    },
  };
}

async function main(): Promise<void> {
  if (!hasGhostscript()) {
    console.log(
      '  SKIPPED — Ghostscript not on PATH, so this run proves nothing.\n' +
        '  Install it (brew install ghostscript) to make the sweep a real gate.\n',
    );
    return;
  }

  const dir = mkdtempSync(join(tmpdir(), 'resume-sweep-'));
  const violations: Violation[] = [];
  let pagesSeen = 0;

  try {
    for (let n = 0; n <= STEPS; n += 1) {
      const props = withFiller(n);
      const buffer = await renderResumePdf(props);
      const pages = pagesFromPdf(buffer, dir);

      if (pages.length === 0) {
        throw new Error(`step ${n}: recovered no pages — the sweep proves nothing`);
      }
      pagesSeen += pages.length;

      const white = pages.map((_, i) =>
        trailingWhitespace(dir, join(dir, 'sweep.pdf'), i + 1),
      );
      const found = checkDocument(pages, props, n, white);
      violations.push(...found);

      const mark = found.length === 0 ? 'ok  ' : 'FAIL';
      console.log(
        `  ${mark} +${String(n).padStart(2, '0')} filler → ${pages.length}pp` +
          `  trailing white: ${white.map((w) => `${Math.round(w)}pt`).join(', ')}` +
          (found.length ? `  (${found.length} violation(s))` : ''),
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(`\n  swept ${STEPS + 1} documents / ${pagesSeen} pages`);

  if (violations.length > 0) {
    console.error(`\n  ${violations.length} violation(s):\n`);
    for (const v of violations) {
      console.error(`   step +${v.step} page ${v.page}  ${v.kind}\n     ${v.detail}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('  no stranded headings, no split head groups, no orphan pages\n');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
