/**
 * config.ts — the collector's settings, and the one place a local directory
 * becomes a public project slug.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THIS FILE IS THE PRIVACY BOUNDARY'S FIRST HALF.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Everything upstream of here deals in absolute paths and path-encoded
 * directory names — `-Users-coreybaines-GitHub-<repo>` from Claude, a real
 * `cwd` from Codex. Those are private repository names (ADR 008) and they must
 * not leave the machine. `resolveSlug` below is the funnel: it takes one of
 * those local tokens and returns either a **configured project slug** or
 * `null`. The payload builder (payload.ts) accepts nothing else, so a directory
 * with no mapping cannot be attributed — it rolls into the day's totals, which
 * are just numbers, and is otherwise invisible.
 *
 * ── Why the mapping lives in a local JSON file ──────────────────────────────
 *
 * The plan says "map repo → project slug via admin config". This implementation
 * keeps it in `collector.config.json`, next to the script, and that is a
 * deliberate simplification rather than an oversight:
 *
 *   1. The mapping's left-hand side is a **private repo directory name**. Admin
 *      config lives in Convex, which is the server. Storing the mapping there
 *      would mean uploading exactly the strings ADR 008 exists to keep local —
 *      the server would learn every repo name on this Mac in order to help the
 *      collector avoid telling it any repo name. That is backwards.
 *   2. The mapping is machine-specific. It describes where *this* laptop keeps
 *      its checkouts. A second machine would need a different one.
 *   3. It changes when a repo is cloned, i.e. roughly never, and editing it is a
 *      one-line change to a file that sits beside the job that reads it.
 *
 * The cost is that adding a mapping needs a text editor rather than the admin
 * UI, and that is the whole cost. Noted in README.md under "Deliberate
 * simplifications" so the divergence from the plan is on the record.
 *
 * ── …and why `collector.config.json` is gitignored ──────────────────────────
 *
 * Reasons 1 and 2 are also the reason the file itself is **not committed**.
 * `coreybain/personal-site` is a public repository. Committing the mapping would
 * publish, in the privacy funnel's own configuration, exactly the list of client
 * checkout directory names that ADR 008 says never leave this machine — a
 * quieter version of the leak the funnel prevents at run time, but permanent and
 * indexable. `collector.config.example.json` is committed instead: same shape,
 * same defaults, invented `dir` values. Copy it and edit.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Directory this file lives in. Config and launchd paths resolve against it. */
export const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ *
 * Shape
 * ------------------------------------------------------------------ */

/**
 * One local checkout directory ↔ one public project slug.
 *
 * `dir` is matched against the *segments* of a path — see `resolveSlug` — so one
 * entry covers the repo root, every package inside it, and every git worktree
 * cut from it. Several entries may share a `slug`; their sessions merge.
 */
export type RepoMapping = {
  /**
   * The repository's directory name as it appears on disk, e.g. `personal-site`.
   * Not a path: the collector does not care where the checkout lives, only what
   * the repo directory is called.
   */
  dir: string;
  /**
   * The `projects.slug` / `labs.slug` this repo's work is attributed to. Must be
   * a slug that actually exists in the deployment, because the fold joins on it.
   */
  slug: string;
  /** Free-form note for whoever reads this file in a year. Never transmitted. */
  note?: string;
};

export type CollectorConfig = {
  /**
   * Convex **HTTP actions** origin — `https://<deployment>.convex.site`, not
   * `.convex.cloud`. Those are two different hosts serving two different things:
   * `.cloud` is the sync/function API the web app talks to, `.site` is where
   * `convex/http.ts` routes are exposed. Overridable with
   * `COLLECTOR_CONVEX_SITE_URL` so the same checkout can push to prod.
   */
  convexSiteUrl: string;
  /**
   * Environment variable holding the plaintext bearer token (`ing_…`).
   *
   * The token itself is never written to this file — this file is committed.
   * See `resolveToken` and README.md § Issuing a token.
   */
  tokenEnvVar: string;
  /**
   * Fallback location for the token when the environment has none, e.g. under
   * launchd, which inherits no shell profile. `~` is expanded. The file must
   * contain the token and nothing else; whitespace is trimmed.
   */
  tokenFile: string;
  /** Where Claude Code keeps one directory per project. `~` is expanded. */
  claudeProjectsDir: string;
  /** Where Codex keeps `YYYY/MM/DD/rollout-*.jsonl`. `~` is expanded. */
  codexSessionsDir: string;
  /**
   * How many days back to recompute and re-send, inclusive of today.
   *
   * Every emitted day is a *complete* recomputation of that day, and the ingest
   * endpoint upserts on (`day`, `agent`), so re-sending is idempotent rather
   * than additive (see packages/types/src/ingest.ts). A week of overlap costs a
   * few hundred milliseconds and covers a laptop that was shut for the weekend,
   * a failed run nobody noticed, and yesterday's session that was appended to
   * after midnight.
   */
  lookbackDays: number;
  /**
   * Longest pause inside a session still counted as working time, in minutes.
   *
   * Session duration is the sum of gaps between consecutive events, with each
   * gap capped at this value. Without the cap, walking away for lunch mid-session
   * would bill the afternoon; without gap-summing at all, first-to-last span
   * would do the same. 30 minutes is a guess, honestly labelled as one.
   */
  idleGapMinutes: number;
  /**
   * Hard ceiling on a single session's estimated hours.
   *
   * Load-bearing for Codex only, where duration is a span (see scan-codex.ts)
   * and a file appended to hours later would otherwise report a whole day. Also
   * a backstop for a Claude transcript containing a bogus timestamp.
   */
  maxSessionHours: number;
  /** Local directory ↔ public slug. The funnel. See the file header. */
  repos: RepoMapping[];
};

/* ------------------------------------------------------------------ *
 * Loading
 * ------------------------------------------------------------------ */

const DEFAULT_CONFIG_FILE = resolve(PACKAGE_DIR, 'collector.config.json');

/** The committed template. Only ever named in the "you have no config" error. */
const EXAMPLE_CONFIG_FILE = resolve(PACKAGE_DIR, 'collector.config.example.json');

/** Expand a leading `~` and make the result absolute. */
export function expandHome(pathLike: string): string {
  const expanded = pathLike.startsWith('~')
    ? resolve(homedir(), pathLike.slice(1).replace(/^[/\\]/, ''))
    : pathLike;
  return isAbsolute(expanded) ? expanded : resolve(PACKAGE_DIR, expanded);
}

/**
 * Read and validate `collector.config.json`.
 *
 * Validation is hand-rolled rather than Zod: this is the *local* half of the
 * system and its failure mode is a typo in a file the author owns, so a clear
 * thrown message beats a dependency. The half that actually crosses the network
 * is validated by the shared Zod contract — see payload.ts.
 */
export function loadConfig(configPath: string = DEFAULT_CONFIG_FILE): CollectorConfig {
  if (!existsSync(configPath)) {
    // Expected on a fresh clone: the real config is gitignored (see the header),
    // so "missing" is the default state rather than a broken one. Say what to do
    // about it instead of just what is wrong.
    const hint =
      configPath === DEFAULT_CONFIG_FILE && existsSync(EXAMPLE_CONFIG_FILE)
        ? '\n  cp collector.config.example.json collector.config.json' +
          '\nThe real file is machine-local and gitignored: its `repos` entries name' +
          '\nprivate checkout directories, and this monorepo is public (ADR 008).'
        : '';
    throw new Error(`No collector config at ${configPath}${hint}`);
  }

  const raw: unknown = JSON.parse(readFileSync(configPath, 'utf8'));
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${configPath} is not a JSON object`);
  }
  const record = raw as Record<string, unknown>;

  const str = (key: string, fallback?: string): string => {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
    if (fallback !== undefined) return fallback;
    throw new Error(`collector config: "${key}" must be a non-empty string`);
  };

  const num = (key: string, fallback: number): number => {
    const value = record[key];
    if (value === undefined) return fallback;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error(`collector config: "${key}" must be a positive number`);
    }
    return value;
  };

  const reposRaw = record.repos;
  if (!Array.isArray(reposRaw)) {
    throw new Error('collector config: "repos" must be an array');
  }

  const repos: RepoMapping[] = reposRaw.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`collector config: repos[${index}] is not an object`);
    }
    const { dir, slug, note } = entry as Record<string, unknown>;
    if (typeof dir !== 'string' || dir.length === 0) {
      throw new Error(`collector config: repos[${index}].dir must be a non-empty string`);
    }
    if (typeof slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      // Checked here rather than at the wire, because the wire check would fail
      // the whole push for one bad character in a file nobody had looked at.
      throw new Error(
        `collector config: repos[${index}].slug ("${String(slug)}") is not a lowercase kebab-case slug`,
      );
    }
    return note === undefined ? { dir, slug } : { dir, slug, note: String(note) };
  });

  return {
    convexSiteUrl: (process.env.COLLECTOR_CONVEX_SITE_URL ?? str('convexSiteUrl')).replace(
      /\/+$/,
      '',
    ),
    tokenEnvVar: str('tokenEnvVar', 'COLLECTOR_INGEST_TOKEN'),
    tokenFile: str('tokenFile', '~/.config/home-collector/token'),
    claudeProjectsDir: str('claudeProjectsDir', '~/.claude/projects'),
    codexSessionsDir: str('codexSessionsDir', '~/.codex/sessions'),
    lookbackDays: Math.floor(num('lookbackDays', 7)),
    idleGapMinutes: num('idleGapMinutes', 30),
    maxSessionHours: num('maxSessionHours', 6),
    repos,
  };
}

/**
 * The bearer token, from the environment or the token file — never from config.
 *
 * Returns `null` rather than throwing so `--dry-run` works on a machine that has
 * never been issued a token. Only `--push` requires one.
 */
export function resolveToken(config: CollectorConfig): string | null {
  const fromEnv = process.env[config.tokenEnvVar];
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }

  const tokenFile = expandHome(config.tokenFile);
  if (existsSync(tokenFile)) {
    const contents = readFileSync(tokenFile, 'utf8').trim();
    if (contents.length > 0) return contents;
  }

  return null;
}

/* ------------------------------------------------------------------ *
 * Path tokens → slugs
 * ------------------------------------------------------------------ */

/**
 * Render a path in Claude's encoding: every separator becomes `-`.
 *
 * `/Users/me/GitHub/personal-site` → `-Users-me-GitHub-personal-site`, which is
 * exactly what `~/.claude/projects` names its directories. Encoding Codex's real
 * `cwd` the same way means both agents' location data arrives at `resolveSlug`
 * in one format, and there is one matcher rather than two.
 *
 * The encoding is famously **not** reversible — `personal-site` and
 * `personal/site` encode identically — which is why nothing here tries to decode
 * it back into a path. It does not need to: the question is only ever "does this
 * token contain a directory I have a mapping for?".
 */
export function encodePathLikeClaude(pathLike: string): string {
  return pathLike.replace(/[/\\]/g, '-');
}

/** Split an encoded token into its `-`-delimited segments, dropping empties. */
function segmentsOf(token: string): string[] {
  return token.split('-').filter((segment) => segment.length > 0);
}

/** Does `needle` appear as a contiguous run of segments inside `haystack`? */
function containsRun(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  outer: for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * A prepared matcher: local path token → configured slug, or `null`.
 *
 * ── How matching works, and why ────────────────────────────────────────────
 *
 * The token is compared **segment-wise**, not by string containment, so `home`
 * matches `…-GitHub-home` and `…-GitHub-home-apps-web` but not `…-homebrew-…`.
 *
 * Matching is *containment* rather than "the segment after a known root",
 * because the real directories are messier than a root plus a name:
 *
 *   -Users-…-GitHub-<repo>-packages-convex        a package inside the repo
 *   -Users-…-GitHub-<repo>-.claude-worktrees-…    an agent worktree beside it
 *   -Users-…-.codex-worktrees-<hash>-<repo>       an agent worktree elsewhere
 *
 * All three are work on `<repo>`, and containment catches all three without the
 * collector needing to know the worktree conventions of two different agents.
 *
 * **Longest match wins**, measured in segments, which is the property that keeps
 * a two-word repo from being swallowed by a one-word one when the shorter name
 * is a prefix of the longer. Ties break toward the entry declared first.
 *
 * The failure mode is a false positive: a path that happens to contain a mapped
 * repo's name as a directory somewhere else attributes to that project. The
 * mapping is the author's own list of their own checkouts, the consequence is a
 * slightly wrong session count on their own site, and the alternative — anchored
 * roots — misses the three real shapes above. Documented, accepted.
 */
export function makeSlugResolver(
  repos: readonly RepoMapping[],
): (pathToken: string) => string | null {
  const prepared = repos
    .map((repo) => ({ slug: repo.slug, needle: segmentsOf(encodePathLikeClaude(repo.dir)) }))
    .filter((repo) => repo.needle.length > 0)
    .sort((a, b) => b.needle.length - a.needle.length);

  return (pathToken: string): string | null => {
    const haystack = segmentsOf(pathToken);
    for (const repo of prepared) {
      if (containsRun(haystack, repo.needle)) return repo.slug;
    }
    return null;
  };
}
