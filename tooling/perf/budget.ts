/**
 * budget.ts — the JS side of "these are gates, not aspirations".
 *
 *     bun run tooling/perf/budget.ts            # after a production build
 *     bun run tooling/perf/budget.ts --verbose  # + per-chunk breakdown
 *     bun run tooling/perf/budget.ts --json     # machine-readable
 *
 * Exits non-zero on a breach. Nothing else about it is clever.
 *
 * ── What "first-load JS" means here, precisely ───────────────────────────────
 *
 * The bytes a browser executes before the page is interactive, for a cold visit
 * to that URL, gzipped. Concretely: every `<script src>` the **prerendered HTML
 * for that route** references, deduplicated, each chunk gzipped individually and
 * summed.
 *
 * Reading it out of the emitted HTML rather than out of `build-manifest.json` is
 * the load-bearing choice, and it was not the first thing tried:
 *
 *   • `build-manifest.json` under Turbopack carries `rootMainFiles` and nothing
 *     per-route — there is no `app-build-manifest.json` in this build at all.
 *     Believing it would have measured the shared runtime and reported it as the
 *     homepage.
 *   • The HTML is also the only artefact that knows about `noModule`. Next emits
 *     a 38.6 KB gzipped legacy polyfill chunk that no browser released this
 *     decade downloads; counting it would inflate every route by ~22% and make
 *     the number a fiction. It is excluded here, by attribute, not by filename.
 *   • The HTML is what actually ships. A manifest is a description of intent.
 *
 * Chunks are gzipped at level 9, individually, which is what `gzip-size` (and
 * therefore Next's own historical build output) does — so the numbers here are
 * comparable to numbers from that era rather than to a whole-response gzip.
 * Brotli is printed alongside because it is what a CDN will actually serve, but
 * the plan says "gzipped" and so the gate is gzip.
 *
 * ── The second assertion: contraband ─────────────────────────────────────────
 *
 * The public pages are async RSC and must ship **zero Convex bytes** to the
 * client. That invariant is invisible to a byte total — a Convex client that
 * fits inside the existing headroom passes a size check and violates the
 * architecture. So the same walk that measures the chunks also greps them for
 * markers of the four packages that are allowed to exist in this app but never
 * on a public route. See `CONTRABAND`.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';

import { BUDGETS, FLOOR_ROUTE, IGNORED_PREFIXES, type Budget } from './budgets';

/* ------------------------------------------------------------------ *
 * Arguments
 * ------------------------------------------------------------------ */

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

const verbose = process.argv.includes('--verbose');
const asJson = process.argv.includes('--json');

/** The build to measure. Defaults to the web app's, resolved from this file. */
const distDir = resolve(arg('--dist') ?? join(import.meta.dir, '..', '..', 'apps', 'web', '.next'));

/**
 * Client bundles that are legitimate somewhere in this app and are a **defect**
 * on any public route.
 *
 * Each marker is an identifier that survives minification — chosen by grepping
 * the real emitted chunks, not guessed. Note what is deliberately *not* here:
 * the bare string `convex`. The contact page prints "convex · stored, then read
 * by one person" as visible copy, and a check that fails on the site's own
 * honest description of where a message goes is a check that gets deleted.
 */
const CONTRABAND: { marker: string; what: string }[] = [
  { marker: 'ConvexReactClient', what: 'the Convex React client' },
  { marker: 'ConvexHttpClient', what: 'the Convex HTTP client' },
  { marker: 'ClerkProvider', what: 'Clerk' },
  { marker: '__clerk', what: 'Clerk' },
  { marker: 'ProseMirror', what: 'Tiptap / ProseMirror' },
  { marker: 'uploadthing', what: 'UploadThing' },
];

/* ------------------------------------------------------------------ *
 * Locating prerendered routes
 * ------------------------------------------------------------------ */

/** Every `.html` Next prerendered, as an absolute path. */
function prerenderedPages(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith('.html')) out.push(path);
    }
  };
  walk(root);
  return out.sort();
}

/**
 * `…/server/app/work/quotecloud.html` → `/work/quotecloud`.
 *
 * `index.html` is the root of its directory, so `…/server/app/index.html` is
 * `/` and (were there one) `…/server/app/blog/index.html` would be `/blog`.
 */
function routeOf(appDir: string, page: string): string {
  const rel = relative(appDir, page).replace(/\.html$/, '');
  if (rel === 'index') return '/';
  return `/${rel.replace(/\/index$/, '')}`;
}

/** A budget row's route, as a matcher. `[slug]` matches one path segment. */
function matches(pattern: string, route: string): boolean {
  if (pattern === route) return true;
  if (!pattern.includes('[')) return false;
  const source = pattern
    .split('/')
    .map((seg) => (seg.startsWith('[') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^${source}$`).test(route);
}

/* ------------------------------------------------------------------ *
 * Measuring one page
 * ------------------------------------------------------------------ */

type Chunk = { file: string; raw: number; gzip: number; brotli: number };

/**
 * The script tags a browser will actually run.
 *
 * `(?![^>]*noModule)` is the whole trick: Next writes the legacy polyfill
 * bundle as `<script src="…" noModule="">`, which every module-supporting
 * browser skips. Attribute order is stable in Next's output (src first), and a
 * `>` cannot appear inside the attribute value, so the negative lookahead is
 * scoped to the remainder of the same tag.
 */
const SCRIPT_RE = /<script src="(\/_next\/([^"]+\.js))"(?![^>]*noModule)/g;

const measured = new Map<string, Chunk>();

function measureChunk(distRoot: string, url: string, file: string): Chunk {
  const cached = measured.get(file);
  if (cached !== undefined) return cached;
  const bytes = readFileSync(join(distRoot, file));
  const chunk: Chunk = {
    file: url,
    raw: bytes.length,
    // Level 9, individually per chunk — see the header for why this and not a
    // whole-response gzip.
    gzip: gzipSync(bytes, { level: 9 }).length,
    brotli: brotliCompressSync(bytes).length,
  };
  measured.set(file, chunk);
  return chunk;
}

type Page = {
  route: string;
  page: string;
  chunks: Chunk[];
  gzip: number;
  brotli: number;
  contraband: { marker: string; what: string; chunk: string }[];
};

function measurePage(distRoot: string, appDir: string, page: string): Page {
  const html = readFileSync(page, 'utf8');
  const urls = [...new Set([...html.matchAll(SCRIPT_RE)].map((m) => m[1]!))];
  const chunks = urls.map((url) => measureChunk(distRoot, url, url.replace('/_next/', '')));

  const contraband: Page['contraband'] = [];
  for (const url of urls) {
    const source = readFileSync(join(distRoot, url.replace('/_next/', '')), 'utf8');
    for (const { marker, what } of CONTRABAND) {
      if (source.includes(marker)) contraband.push({ marker, what, chunk: url });
    }
  }

  return {
    route: routeOf(appDir, page),
    page,
    chunks,
    gzip: chunks.reduce((n, c) => n + c.gzip, 0),
    brotli: chunks.reduce((n, c) => n + c.brotli, 0),
    contraband,
  };
}

/* ------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------ */

const appDir = join(distDir, 'server', 'app');
let pages: Page[];
try {
  const found = prerenderedPages(appDir);
  if (found.length === 0) throw new Error('no prerendered HTML');
  pages = found.map((page) => measurePage(distDir, appDir, page));
} catch (error) {
  console.error(
    `No build to measure at ${distDir}\n` +
      `  (${(error as Error).message})\n` +
      'Run a production build first:\n' +
      '  cd apps/web && bun run build',
  );
  process.exit(2);
}

const KB = (bytes: number): number => Math.round((bytes / 1024) * 10) / 10;

type Row = {
  budget: Budget;
  /** The worst prerendered instance of this route, or `null` if there are none. */
  worst: Page | null;
  /** How many instances the route matched (a dynamic route can have several). */
  instances: number;
  status: 'PASS' | 'FAIL' | 'EMPTY';
};

const rows: Row[] = [];
const claimed = new Set<string>();

for (const budget of BUDGETS) {
  // Exact routes win over patterns: `/work` must not be swallowed by a pattern
  // that happens to also match it, and an instance must be counted once.
  const mine = pages.filter((p) => !claimed.has(p.page) && matches(budget.route, p.route));
  for (const p of mine) claimed.add(p.page);
  const worst = mine.reduce<Page | null>((a, b) => (a === null || b.gzip > a.gzip ? b : a), null);
  rows.push({
    budget,
    worst,
    instances: mine.length,
    status: worst === null ? 'EMPTY' : KB(worst.gzip) > budget.budget ? 'FAIL' : 'PASS',
  });
}

/**
 * Public routes nobody budgeted.
 *
 * A failure, not a warning. A new public page is exactly the moment somebody
 * should have to write down what it is allowed to weigh, and "we added /ask and
 * it shipped 400 KB" is precisely the regression this file exists to catch.
 */
const unbudgeted = pages.filter(
  (p) => !claimed.has(p.page) && !IGNORED_PREFIXES.some((prefix) => p.route.startsWith(prefix)),
);

const contraband = pages.filter(
  (p) => p.contraband.length > 0 && !IGNORED_PREFIXES.some((x) => p.route.startsWith(x)),
);

/* ---------------------------------- output ---------------------------------- */

if (asJson) {
  console.log(
    JSON.stringify(
      {
        dist: distDir,
        routes: rows.map((r) => ({
          route: r.budget.route,
          status: r.status,
          instances: r.instances,
          gzipKB: r.worst === null ? null : KB(r.worst.gzip),
          brotliKB: r.worst === null ? null : KB(r.worst.brotli),
          chunks: r.worst?.chunks.length ?? null,
          budgetKB: r.budget.budget,
          planKB: r.budget.plan,
        })),
        unbudgeted: unbudgeted.map((p) => ({ route: p.route, gzipKB: KB(p.gzip) })),
        contraband: contraband.flatMap((p) => p.contraband.map((c) => ({ route: p.route, ...c }))),
      },
      null,
      2,
    ),
  );
} else {
  const pad = (s: string, n: number): string => s.padEnd(n);
  const num = (s: string, n: number): string => s.padStart(n);

  console.log('First-load JS budget — gzipped, per public route\n');
  console.log(`  build   ${distDir}`);
  console.log(`  chunks  ${measured.size} unique, ${KB([...measured.values()].reduce((n, c) => n + c.raw, 0))} KB raw total\n`);

  console.log(
    `  ${pad('route', 16)} ${num('gzip', 9)} ${num('brotli', 8)} ${num('budget', 8)} ${num('plan', 6)}  status`,
  );
  console.log(`  ${'─'.repeat(16)} ${'─'.repeat(9)} ${'─'.repeat(8)} ${'─'.repeat(8)} ${'─'.repeat(6)}  ──────`);

  for (const row of rows) {
    const { budget, worst, status } = row;
    const gzip = worst === null ? '—' : `${KB(worst.gzip)} KB`;
    const brotli = worst === null ? '—' : `${KB(worst.brotli)} KB`;
    const plan = budget.plan === null ? '—' : `${budget.plan}`;
    const mark = status === 'FAIL' ? 'FAIL ✗' : status === 'EMPTY' ? 'none  ' : 'pass  ';
    console.log(
      `  ${pad(budget.route, 16)} ${num(gzip, 9)} ${num(brotli, 8)} ${num(`${budget.budget} KB`, 8)} ${num(plan, 6)}  ${mark}`,
    );
  }

  console.log('');
  for (const row of rows) console.log(`  ${pad(row.budget.route, 16)} ${row.budget.note}`);

  if (verbose) {
    for (const row of rows) {
      if (row.worst === null) continue;
      console.log(`\n  ${row.budget.route}  (${row.instances} prerendered, worst: ${relative(distDir, row.worst.page)})`);
      for (const chunk of [...row.worst.chunks].sort((a, b) => b.gzip - a.gzip)) {
        console.log(`    ${num(`${KB(chunk.gzip)} KB`, 9)} gz  ${num(`${KB(chunk.raw)} KB`, 9)} raw  ${chunk.file}`);
      }
    }
  }

  // The gap, stated rather than buried. The plan's number is a real number that
  // a real person wrote down; if it is not being met, that is news every run.
  const gaps = rows.filter((r) => r.budget.plan !== null && r.worst !== null && KB(r.worst.gzip) > r.budget.plan);
  if (gaps.length > 0) {
    console.log('\n  TODO — over the build plan target (gated on the ratchet above, not on this):');
    for (const row of gaps) {
      const over = KB(row.worst!.gzip) - row.budget.plan!;
      console.log(
        `    ${row.budget.route}  ${KB(row.worst!.gzip)} KB vs plan ${row.budget.plan} KB — ${Math.round((over / row.budget.plan!) * 100)}% over (${over.toFixed(1)} KB)`,
      );
    }
    const floor = rows.find((r) => r.budget.route === FLOOR_ROUTE)?.worst;
    if (floor !== undefined && floor !== null) {
      console.log(
        `    the framework floor alone (${FLOOR_ROUTE}, no app code) is ${KB(floor.gzip)} KB — see tooling/perf/README.md`,
      );
    }
  }

  // Ratchet hint. Only when the slack is big enough to be a real win rather
  // than noise between two builds of the same tree.
  const slack = rows.filter((r) => r.worst !== null && r.budget.budget - KB(r.worst.gzip) >= 10);
  if (slack.length > 0) {
    console.log('\n  Ratchet — comfortably under budget; lower these in tooling/perf/budgets.ts:');
    for (const row of slack) {
      console.log(`    ${row.budget.route}  ${KB(row.worst!.gzip)} KB measured vs ${row.budget.budget} KB budget`);
    }
  }
}

/* --------------------------------- verdict --------------------------------- */

const failures = rows.filter((r) => r.status === 'FAIL');

if (!asJson) {
  console.log('');
  for (const page of contraband) {
    for (const item of page.contraband) {
      console.log(`CONTRABAND — ${item.what} (\`${item.marker}\`) in ${item.chunk}, loaded by ${page.route}`);
    }
  }
  for (const page of unbudgeted) {
    console.log(
      `UNBUDGETED — ${page.route} ships ${KB(page.gzip)} KB gzipped and has no row in tooling/perf/budgets.ts`,
    );
  }
  for (const row of failures) {
    console.log(
      `OVER BUDGET — ${row.budget.route}  ${KB(row.worst!.gzip)} KB > ${row.budget.budget} KB ` +
        `(+${(KB(row.worst!.gzip) - row.budget.budget).toFixed(1)} KB)`,
    );
  }

  const bad = failures.length + unbudgeted.length + contraband.length;
  console.log(
    bad === 0
      ? `PASS — ${rows.filter((r) => r.status === 'PASS').length} routes within budget, no Convex/Clerk/Tiptap bytes on any public route.`
      : `FAIL — ${bad} problem(s).`,
  );
}

process.exit(failures.length + unbudgeted.length + contraband.length === 0 ? 0 : 1);
