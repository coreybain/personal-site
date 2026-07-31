/**
 * seed.ts — push the machine-local repository→display-name mapping into Convex.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE LEFT-HAND SIDE OF EVERY MAPPING IS A PRIVATE REPOSITORY NAME.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This tool exists so that the heatmap's day popup can say `QuoteCloud · 5
 * commits` about work that lives in a repository nobody outside the client may
 * know the name of. ADR 008 permits the first half of that sentence — QuoteCloud
 * is a published, attributed case study — and forbids the second half
 * absolutely. The mapping between them is Corey's private knowledge, and this
 * script is the only path it takes to the server.
 *
 * Three properties make that safe, and all three are structural:
 *
 *   1. **The source file is gitignored.** `git-repo-map.json` is machine-local;
 *      `git-repo-map.example.json` is committed in its place and contains
 *      invented repository names. `coreybain/personal-site` is a *public*
 *      repository, so committing the real file would publish exactly the
 *      inventory the mapping exists to keep unpublished — the same reasoning,
 *      verbatim, as `tooling/collector/collector.config.json`.
 *   2. **The destination table has no public query.** `gitRepoMap` is fenced off
 *      in schema.ts under a box that says so, enumerated in `privateTables` in
 *      `@home/types` so it is testable rather than remembered, and read by
 *      exactly one caller (`gitStats.rebuild`) whose *output* is display names.
 *   3. **Nothing here prints a `repoFullName`.** Not on success, not in a
 *      validation error, not in a diff. The output is counts and display names,
 *      both of which are already public. A terminal is a scrollback buffer, a
 *      screenshot and quite often a pasted bug report, and this tool refuses to
 *      be the thing that puts a client's repo name into one.
 *
 * ── Usage ──────────────────────────────────────────────────────────────────
 *
 *     bun run tooling/git-repo-map/seed.ts              # validate, print, write nothing
 *     bun run tooling/git-repo-map/seed.ts --push       # upsert into Convex
 *     bun run tooling/git-repo-map/seed.ts --push --prune
 *                                                       # …and delete rows absent
 *                                                       # from the local file
 *     bun run tooling/git-repo-map/seed.ts --counts     # what does the table hold?
 *
 * Dry run by default, because the failure mode of the opposite default is
 * "I ran it to see what it would do".
 *
 * ── Why `bunx convex run` and not a client ─────────────────────────────────
 *
 * `repoMap:seed` is an `internalMutation`, which is unreachable from the public
 * function API by design — that is what stops anyone holding the deployment URL
 * from writing to this table. The Convex CLI reaches internal functions because
 * it authenticates with the deployment's **admin key**, so the CLI is the whole
 * authentication story here and there is nothing to invent. It is spawned with
 * `packages/convex` as its working directory so it picks up `CONVEX_DEPLOYMENT`
 * from that package's `.env.local`, exactly as `tooling/seed` does.
 *
 * `tooling/*` is not a workspace (see the root package.json), so it has no
 * `node_modules` and cannot import `@home/types`. Validation below is therefore
 * hand-rolled against the same rules `GitRepoMapEntrySchema` states — the same
 * trade the Collector's `config.ts` makes, for the same reason: this is the
 * local half of the system and its failure mode is a typo in a file the author
 * owns, so a clear thrown message beats a dependency.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Directory this file lives in. The config path resolves against it. */
const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));

/** The machine-local file. Gitignored. See the header. */
const CONFIG_FILE = resolve(PACKAGE_DIR, 'git-repo-map.json');

/** The committed template. Only ever named in the "you have no file" error. */
const EXAMPLE_FILE = resolve(PACKAGE_DIR, 'git-repo-map.example.json');

/** `packages/convex`, so the CLI reads that package's `.env.local`. */
const CONVEX_DIR = resolve(PACKAGE_DIR, '..', '..', 'packages', 'convex');

/* ------------------------------------------------------------------ *
 * Shape
 * ------------------------------------------------------------------ */

/** Mirrors `GitRepoMapEntrySchema` in `@home/types`. */
type Entry = {
  /** `owner/name`. Lowercased on the way out. ⚠️ MAY BE PRIVATE. NEVER PRINTED. */
  repoFullName: string;
  /** The public label that reaches the tooltip. */
  displayName: string;
  kind: 'project' | 'lab' | 'ignore';
};

const KINDS = new Set(['project', 'lab', 'ignore']);

/** `owner/name`, one slash, no whitespace. The same regex the Zod schema uses. */
const REPO_FULL_NAME = /^[^\s/]+\/[^\s/]+$/;

/**
 * Read and validate the local file.
 *
 * ⚠️ Every error message below identifies the offending entry **by index**, not
 * by value. `entries[3].kind is not one of …` is as much as a message may say;
 * quoting the repository name back would defeat the whole tool. The one
 * exception is `kind`, which is a closed enum of three public words.
 */
function loadEntries(path: string): Entry[] {
  if (!existsSync(path)) {
    const hint = existsSync(EXAMPLE_FILE)
      ? '\n  cp tooling/git-repo-map/git-repo-map.example.json tooling/git-repo-map/git-repo-map.json' +
        '\nThe real file is machine-local and gitignored: its `repoFullName` values' +
        '\nare private repository names, and this monorepo is public (ADR 008).'
      : '';
    throw new Error(`No mapping file at ${path}${hint}`);
  }

  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${path} is not a JSON object`);
  }

  const list = (raw as Record<string, unknown>).entries;
  if (!Array.isArray(list)) {
    throw new Error('mapping file: "entries" must be an array');
  }

  const seen = new Set<string>();

  return list.map((value, index) => {
    if (typeof value !== 'object' || value === null) {
      throw new Error(`mapping file: entries[${index}] is not an object`);
    }
    const { repoFullName, displayName, kind } = value as Record<string, unknown>;

    if (typeof repoFullName !== 'string' || !REPO_FULL_NAME.test(repoFullName.trim())) {
      throw new Error(
        `mapping file: entries[${index}].repoFullName is not in GitHub \`owner/name\` form ` +
          '(the value is withheld from this message on purpose — see the file header)',
      );
    }
    if (typeof displayName !== 'string' || displayName.trim().length === 0) {
      throw new Error(`mapping file: entries[${index}].displayName must be a non-empty string`);
    }
    if (displayName.includes('/')) {
      // The one shape ADR 008 forbids unconditionally. Caught here as well as in
      // the cron's own seatbelt, because a mapping row is the only way such a
      // string could ever be introduced deliberately.
      throw new Error(
        `mapping file: entries[${index}].displayName contains "/" — a display name is a ` +
          'case-study or Lab title, never a repository identifier (ADR 008)',
      );
    }
    if (typeof kind !== 'string' || !KINDS.has(kind)) {
      throw new Error(
        `mapping file: entries[${index}].kind must be one of project | lab | ignore`,
      );
    }

    const key = repoFullName.trim().toLowerCase();
    if (seen.has(key)) {
      throw new Error(
        `mapping file: entries[${index}] repeats a repository already listed above ` +
          '(value withheld). Merge the two rows.',
      );
    }
    seen.add(key);

    return {
      repoFullName: key,
      displayName: displayName.trim(),
      kind: kind as Entry['kind'],
    };
  });
}

/* ------------------------------------------------------------------ *
 * Convex
 * ------------------------------------------------------------------ */

/**
 * `bunx convex run <fn> <json>`, returning the function's parsed return value.
 *
 * The arguments go through `Bun.spawn`'s argv array and never a shell string, so
 * nothing in the payload can be interpreted as shell syntax — which matters more
 * than usual here, since the payload is the one thing in this repository that
 * must not end up in a shell history file.
 */
async function convexRun<T>(fn: string, args: unknown): Promise<T> {
  const proc = Bun.spawn(['bunx', 'convex', 'run', fn, JSON.stringify(args)], {
    cwd: CONVEX_DIR,
    stdout: 'pipe',
    // `inherit` would echo Convex's own error text, which on a validator failure
    // quotes the rejected argument — i.e. the mapping. Captured and summarised
    // instead.
    stderr: 'pipe',
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const status = await proc.exited;

  if (status !== 0) {
    // Deliberately not printing `stderr` verbatim: see above. The first line is
    // enough to tell "no deployment configured" from "function rejected it", and
    // the full text is in the Convex dashboard where it is admin-only anyway.
    const firstLine = stderr.split('\n').find((line) => line.trim().length > 0) ?? '';
    throw new Error(
      `convex run ${fn} exited ${status}. First line of its output:\n  ${firstLine}\n` +
        '(the rest is suppressed because Convex echoes rejected arguments back, and the ' +
        'arguments are private repository names)',
    );
  }

  // `convex run` prints progress lines above the return value, so walk `{`
  // positions from the end backwards and take the first that parses — the same
  // trick, and the same reason, as `tooling/seed/seed.ts`.
  for (let i = stdout.lastIndexOf('{'); i !== -1; i = stdout.lastIndexOf('{', i - 1)) {
    try {
      return JSON.parse(stdout.slice(i)) as T;
    } catch {
      // Not the start of the return value. Keep walking left.
    }
  }

  throw new Error(`Could not parse a return value out of \`convex run ${fn}\`.`);
}

/* ------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------ */

type SeedSummary = {
  submitted: number;
  inserted: number;
  updated: number;
  unchanged: number;
  pruned: number;
  totals: { project: number; lab: number; ignore: number };
};

const push = process.argv.includes('--push');
const prune = process.argv.includes('--prune');
const countsOnly = process.argv.includes('--counts');

console.log('git repo map — private attribution seed (ADR 008)');

if (countsOnly) {
  const counts = await convexRun<{ total: number; project: number; lab: number; ignore: number }>(
    'repoMap:counts',
    {},
  );
  console.log(
    `  deployment holds ${counts.total} row(s): ` +
      `${counts.project} project, ${counts.lab} lab, ${counts.ignore} ignore`,
  );
  process.exit(0);
}

const entries = loadEntries(CONFIG_FILE);

// Display names are public — they are literally what gets rendered — so they are
// the one half of each row that is safe to show, and showing them is what makes
// a typo ("QuoteCLoud") visible before it reaches a tooltip.
const byName = new Map<string, { kind: Entry['kind']; repos: number }>();
for (const entry of entries) {
  const running = byName.get(entry.displayName) ?? { kind: entry.kind, repos: 0 };
  running.repos += 1;
  byName.set(entry.displayName, running);
}

console.log(`  file        ${entries.length} mapping(s) → ${byName.size} display name(s)`);
console.log('');
for (const [name, info] of [...byName].sort()) {
  console.log(`    ${info.kind.padEnd(7)}  ${name}  (${info.repos} repo${info.repos === 1 ? '' : 's'})`);
}
console.log('');
console.log('  (repository names are deliberately not printed — see the file header)');
console.log('');

if (!push) {
  console.log('Dry run. Nothing was written. Re-run with --push to upsert.');
  if (prune) console.log('(--prune has no effect without --push.)');
  process.exit(0);
}

const summary = await convexRun<SeedSummary>('repoMap:seed', { entries, prune });

console.log(
  `PUSHED — ${summary.submitted} submitted: ` +
    `${summary.inserted} inserted, ${summary.updated} updated, ` +
    `${summary.unchanged} unchanged, ${summary.pruned} pruned.`,
);
console.log(
  `  table now holds ${summary.totals.project} project, ` +
    `${summary.totals.lab} lab, ${summary.totals.ignore} ignore row(s).`,
);
console.log('');
console.log('Next: `bunx convex run gitStats:rebuild \'{}\'` in packages/convex to');
console.log('rebuild the Snapshot with the new attribution.');
