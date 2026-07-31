/**
 * render-fixture.ts — the dev harness.
 *
 *     bun run render-fixture        # from packages/pdf
 *
 * Renders the document from `./fixture.ts` and writes it to `tmp/`, which this
 * package gitignores. No site, no dev server, no Convex deployment, no
 * environment variables — the whole point is that the résumé's layout can be
 * iterated on in a two-second loop, and that a reviewer can open the artefact
 * without standing anything up.
 *
 * Two files, because they answer different questions:
 *
 *   tmp/fixture.pdf        the real content — two pages, breaking cleanly
 *                          between EXPERIENCE and CAPABILITIES. Does the
 *                          hierarchy read? Is the live strip legible at 100%?
 *                          Does page one look full rather than padded?
 *   tmp/fixture-long.pdf   the stress case. Do the page breaks land in sane
 *                          places? Does a role ever get separated from its
 *                          first bullet? Does a 60-character URL overflow the
 *                          measure?
 *
 * A third file, `tmp/fixture-no-stats.pdf`, renders the same content with
 * `embedGitStats: false`. That branch is a real admin setting and it is the one
 * nobody looks at, so the harness renders it every time rather than on request.
 *
 * Two more bracket the range the document has to survive rather than the range
 * it expects:
 *
 *   tmp/fixture-maximal.pdf  every axis long at once. Not a plausible résumé —
 *                            a load test for the page-break policy. Does a
 *                            heading orphan? Does a head group split?
 *   tmp/fixture-minimal.pdf  one role, three capabilities, **no education**,
 *                            no strip. Does the layout degrade gracefully, and
 *                            does an empty `education` array print a heading
 *                            with nothing under it?
 *
 * `orphan-sweep.ts` beside this file answers the heading question exhaustively
 * rather than at these five sample lengths; this harness is the eyeball pass.
 *
 * The exit code is meaningful: a failure to register the vendored fonts, or a
 * layout engine error, fails the script. It is not a test — there are no
 * assertions about the *output* — but it does catch every error that makes the
 * document un-renderable, which is most of them.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { renderResumePdf } from '../src/render';
import type { ResumePdfProps } from '../src/props';

import {
  longResumeFixture,
  maximalResumeFixture,
  minimalResumeFixture,
  resumeFixture,
} from './fixture';

/** `packages/pdf/tmp/` — resolved from this file, not from cwd. */
const OUT_DIR = fileURLToPath(new URL('../tmp/', import.meta.url));

type Job = {
  file: string;
  props: ResumePdfProps;
  /** Printed beside the result so the console output explains itself. */
  note: string;
};

const jobs: Job[] = [
  {
    file: 'fixture.pdf',
    props: resumeFixture,
    note: 'real content — two pages, breaking before CAPABILITIES',
  },
  {
    file: 'fixture-long.pdf',
    props: longResumeFixture,
    note: 'stress case — page breaks, long URLs, wrapping titles',
  },
  {
    file: 'fixture-no-stats.pdf',
    props: {
      ...resumeFixture,
      resume: { ...resumeFixture.resume, embedGitStats: false },
    },
    note: 'embedGitStats: false — the live strip must be absent, not empty',
  },
  {
    file: 'fixture-maximal.pdf',
    props: maximalResumeFixture,
    note: 'upper bound — every axis long at once; headings must not orphan',
  },
  {
    file: 'fixture-minimal.pdf',
    props: minimalResumeFixture,
    note: 'lower bound — one role, no education, no strip; must not collapse',
  },
];

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });

  // Sequential rather than `Promise.all`: @react-pdf's font store is a module
  // singleton and the first render is what populates it. Racing three renders
  // through it buys nothing on a script that finishes in two seconds, and makes
  // any font error report against an arbitrary one of them.
  for (const job of jobs) {
    const started = performance.now();
    const buffer = await renderResumePdf(job.props);
    const path = `${OUT_DIR}${job.file}`;
    await writeFile(path, buffer);

    const ms = Math.round(performance.now() - started);
    const kb = (buffer.byteLength / 1024).toFixed(1);
    console.log(`  ${path}  ${kb} KB  ${ms}ms  — ${job.note}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
