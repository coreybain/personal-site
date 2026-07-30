/**
 * check.ts — "assert no private repo name appears in any public response".
 *
 * That sentence is from the plan's Verification section, and it is the one
 * assertion in this project that protects somebody other than Corey: the repos
 * are client-owned (ADR 008, Ownership vs. Attribution in the glossary), so a
 * leak here is a disclosure of Corporate Interactive's and SpiritDevs' code
 * inventory, not merely an embarrassment.
 *
 * It runs against a **live deployment**, unauthenticated, and exits non-zero on
 * any finding, so it works as a pre-cutover gate and as CI.
 *
 *     bun run tooling/privacy-check/check.ts
 *     bun run tooling/privacy-check/check.ts --url https://<deployment>.convex.cloud
 *     bun run tooling/privacy-check/check.ts --site http://localhost:3001
 *     bun run tooling/privacy-check/check.ts --tree
 *
 * ── What it actually proves, and what it does not ─────────────────────────
 *
 * It proves that no name from the corpus in repos.ts appears in the bytes a
 * stranger can pull from the deployment's public queries (and, with `--site`,
 * from the rendered HTML too — because the site is where a leak becomes
 * *indexable*, and a page can print something no single query response
 * contains).
 *
 * `--tree` adds a third surface that is easy to forget and was in fact missed
 * once: **the repository's own tracked files**. `coreybain/personal-site` is a
 * public repo, so a private name written into a comment, a README table or a
 * test fixture is published just as surely as one rendered on a page — and the
 * deployment sweep is structurally blind to it, because source code is not a
 * query response. Tracked files only, via `git ls-files`, which means a
 * gitignored machine-local file (`tooling/collector/collector.config.json`) is
 * excluded by construction rather than by an exception list: not committed, not
 * public, not this tool's business.
 *
 * It does not prove the absence of a leak in general. A paraphrase ("the Mounties
 * bowling site"), a screenshot with a repo name in a terminal, or an OG image
 * are all invisible to a text search. This is a regression gate on the mechanical
 * failure mode — a pipeline that starts emitting a name it used to suppress —
 * which is the failure mode that happens silently and at 3am. The judgement
 * calls stay with phase 8.
 */

import { buildCorpus, type PrivateName } from './repos';
import { readPublicSurface, type Capture } from './surface';

/* ------------------------------------------------------------------ *
 * Arguments
 * ------------------------------------------------------------------ */

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

const deploymentUrl =
  arg('--url') ?? process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;

if (deploymentUrl === undefined || deploymentUrl === '') {
  console.error(
    'No deployment URL. Pass --url https://<name>.convex.cloud, or run via\n' +
      '`bun --env-file=.env run tooling/privacy-check/check.ts` so that\n' +
      'NEXT_PUBLIC_CONVEX_URL is set.',
  );
  process.exit(2);
}

/** Optional: also sweep rendered pages from a running site. */
const siteUrl = arg('--site');
const SITE_PAGES = ['/', '/work', '/labs', '/resume', '/fun', '/blog', '/contact'];

/** Optional: also sweep this repository's tracked source. See the header. */
const sweepTree = process.argv.includes('--tree');

/**
 * Extensions worth reading as text when sweeping the tree.
 *
 * An allowlist rather than a binary sniff: the point is to cover the files a
 * human writes prose and identifiers into. A private name inside a PNG is a real
 * exposure and a real blind spot, and it is the same blind spot the header
 * already admits to for screenshots and OG images — a text search was never
 * going to find it.
 */
const TREE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'json', 'jsonc', 'md', 'mdx', 'txt',
  'css', 'html', 'yml', 'yaml', 'toml',
  'sh', 'bash', 'zsh', 'plist', 'template', 'env', 'example',
]);

/** Skip a file this large: a lockfile is not prose and it is 90% of the bytes. */
const TREE_MAX_BYTES = 512 * 1024;

/** Every tracked path in the repo, relative to its root. */
async function trackedFiles(): Promise<{ root: string; paths: string[] }> {
  const run = async (args: string[]): Promise<string> => {
    const proc = Bun.spawn(['git', ...args], { stdout: 'pipe', stderr: 'pipe' });
    const out = await new Response(proc.stdout).text();
    const status = await proc.exited;
    if (status !== 0) {
      const err = await new Response(proc.stderr).text();
      throw new Error(`git ${args[0]} failed (${status}): ${err.trim()}`);
    }
    return out;
  };

  const root = (await run(['rev-parse', '--show-toplevel'])).trim();
  // `--cached --others --exclude-standard` is the load-bearing part, not `-z`.
  //
  // Tracked files alone would have been useless for the case that motivated
  // this: a leak arrives in a *new, not-yet-committed* file, which is exactly
  // when it is still cheap to fix and exactly what `git ls-files` on its own
  // cannot see. `--others` adds untracked files and `--exclude-standard` then
  // subtracts everything `.gitignore` covers, so the set is "what is public or
  // about to become public" — which is the question ADR 008 asks.
  //
  // `-z`, so a path containing a newline or a space survives intact.
  const paths = (
    await run(['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'])
  )
    .split('\0')
    .filter((path) => path.length > 0);
  return { root, paths };
}

/* ------------------------------------------------------------------ *
 * Matching
 * ------------------------------------------------------------------ */

/**
 * Match on token boundaries rather than raw substrings.
 *
 * A raw `includes()` is unusable here: several private repos are named with a
 * three-letter acronym, and three letters occur inside ordinary words all day.
 * Boundaries are defined as "not a letter or digit", which deliberately treats
 * `-`, `/`, `_`, `.` and whitespace as separators — so a token like
 * `client-app` still fires inside `client-app-v2` and inside a URL path, which
 * is what a leak looks like, while `abc` no longer fires inside `aabcd`.
 */
function findAll(haystack: string, token: string): number[] {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'gi');
  const hits: number[] = [];
  for (let m = re.exec(haystack); m !== null; m = re.exec(haystack)) hits.push(m.index);
  return hits;
}

/** ±60 characters around a hit, whitespace-collapsed, for the report. */
function context(text: string, at: number, len: number): string {
  return text
    .slice(Math.max(0, at - 60), Math.min(text.length, at + len + 60))
    .replace(/\s+/g, ' ')
    .trim();
}

type Finding = {
  severity: 'LEAK' | 'REVIEW';
  name: PrivateName;
  where: string;
  context: string;
};

/* ------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------ */

console.log('ADR 008 privacy check');
console.log(`  deployment  ${deploymentUrl}`);
if (siteUrl !== undefined) console.log(`  site        ${siteUrl}`);
if (sweepTree) console.log('  tree        tracked files in this repository');
console.log('');

const corpus = await buildCorpus();
console.log(
  `  corpus      ${corpus.names.length} names ` +
    `(${corpus.stats.privateReposOnGitHub} private repos on GitHub, ` +
    `${corpus.stats.localPrivate}/${corpus.stats.localDirectories} local working copies private, ` +
    `${corpus.stats.skippedAsGeneric} skipped as too generic)`,
);

const surface = await readPublicSurface(deploymentUrl);
const captures: Capture[] = [...surface.captures];

if (siteUrl !== undefined) {
  for (const page of SITE_PAGES) {
    try {
      const response = await fetch(`${siteUrl}${page}`);
      captures.push({
        label: `GET ${page} (${response.status})`,
        text: await response.text(),
        status: response.ok ? 'success' : 'error',
      });
    } catch (error) {
      console.log(`  (skipped ${page}: ${(error as Error).message})`);
    }
  }
}

const bytes = captures.reduce((sum, c) => sum + c.text.length, 0);
console.log(`  surface     ${captures.length} responses, ${(bytes / 1024).toFixed(1)} KB`);

/**
 * The tracked-source sweep.
 *
 * Kept in the same `captures` array as the network responses so it goes through
 * one matcher and one sanction rule — a private name is a private name whether a
 * query returned it or a comment contains it.
 *
 * The path is scanned as well as the contents: `docs/<client>-notes.md` would
 * leak from its own filename with nothing incriminating inside it.
 */
if (sweepTree) {
  const { root, paths } = await trackedFiles();
  let read = 0;
  let skipped = 0;

  for (const path of paths) {
    const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
    if (!TREE_EXTENSIONS.has(extension)) {
      skipped += 1;
      continue;
    }
    const file = Bun.file(`${root}/${path}`);
    if (file.size > TREE_MAX_BYTES) {
      skipped += 1;
      continue;
    }
    captures.push({
      label: `file ${path}`,
      text: `${path}\n${await file.text()}`,
      status: 'success',
    });
    read += 1;
  }

  console.log(`  tree        ${read} tracked files read, ${skipped} skipped (binary or large)`);
}

/**
 * The ADR 008 sanction list: names the site has *published*.
 *
 * See the header of repos.ts. A bare private-repo name that equals a published
 * case study or lab title is the documented, required behaviour ("named CI
 * projects"), so it is reported as REVIEW rather than LEAK — visible, counted,
 * but not a failure. A repository *identifier* is never sanctioned by anything.
 *
 * This applies to `directory` names on the same terms, which is not obvious.
 * The working copy of QuoteCloud is the folder `~/GitHub/QuoteCloud`, so the
 * directory name and the sanctioned product name are the same string, and
 * nothing about a hit can tell you which one produced it. Treating those hits as
 * leaks would fail the check on precisely the content ADR 008 mandates. What the
 * `directory` kind still uniquely catches is every folder whose name is *not* a
 * published product — a deploy checkout, a `copy 2` left behind by Finder, an
 * unreleased internal tool — and those are the ones only the Collector could
 * ever have emitted. (Invented illustrations only; see the header of repos.ts
 * for why this file names no real repository.)
 */
const published = new Set(
  surface.publishedNames.map((n) => n.toLowerCase().replace(/[^a-z0-9]/g, '')),
);

const findings: Finding[] = [];

for (const capture of captures) {
  for (const name of corpus.names) {
    for (const at of findAll(capture.text, name.value)) {
      const normalised = name.value.toLowerCase().replace(/[^a-z0-9]/g, '');
      const sanctioned = name.kind !== 'identifier' && published.has(normalised);
      findings.push({
        severity: sanctioned ? 'REVIEW' : 'LEAK',
        name,
        where: capture.label,
        context: context(capture.text, at, name.value.length),
      });
    }
  }
}

const leaks = findings.filter((f) => f.severity === 'LEAK');
const reviews = findings.filter((f) => f.severity === 'REVIEW');

console.log('');

if (reviews.length > 0) {
  // Collapsed to one line per name: a case study title legitimately appears
  // dozens of times and printing each hit would bury the leaks below it.
  const byName = new Map<string, number>();
  for (const r of reviews) byName.set(r.name.value, (byName.get(r.name.value) ?? 0) + 1);
  console.log(`REVIEW — ${byName.size} name(s) published as case studies (ADR 008 permits this):`);
  for (const [value, count] of [...byName].sort()) {
    console.log(`  ${value}  ×${count}  — also a private repo name; published, so allowed`);
  }
  console.log('');
}

for (const finding of surface.authFindings) {
  console.log(`AUTH   — ${finding}`);
}
if (surface.authFindings.length > 0) console.log('');

if (leaks.length === 0) {
  console.log(
    `PASS — no private repo identifier, name or directory in ${captures.length} ` +
      `public ${sweepTree ? 'responses and tracked files' : 'responses'}.`,
  );
} else {
  console.log(`FAIL — ${leaks.length} leak(s):`);
  for (const leak of leaks) {
    console.log(`  [${leak.name.kind}] ${leak.name.value}`);
    console.log(`      in   ${leak.where}`);
    console.log(`      from ${leak.name.source}`);
    console.log(`      …${leak.context}…`);
  }
}

process.exit(leaks.length === 0 && surface.authFindings.length === 0 ? 0 : 1);
