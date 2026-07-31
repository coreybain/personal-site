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
import { homedir, hostname } from 'node:os';
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
   * Which computer this is. One short label, sent on every push.
   *
   * ═════════════════════════════════════════════════════════════════════════
   *  THIS IS A THIRD OF THE SERVER-SIDE UPSERT KEY. CHOOSE IT ONCE.
   * ═════════════════════════════════════════════════════════════════════════
   *
   * `aiUsageDays` is keyed on (`day`, `agent`, `machine`). Before `machine`
   * existed the key was (`day`, `agent`), which meant the second computer to
   * post a day *erased* the first — silently, with the endpoint answering
   * `daysUpdated: 1` as though that were the right answer. With the label in the
   * key, a push replaces only its own previous claim: N machines are additive,
   * and any machine may re-send any day as often as it likes.
   *
   * The corollary is that **renaming it splits history**. The old label's rows
   * stay where they are and keep counting, the new label starts from nothing and
   * re-sends the lookback window under its own name, and for `lookbackDays` the
   * overlap is counted twice. Pick a label per machine and leave it alone; if a
   * machine is retired, leave its rows alone too — they are history.
   *
   * ── What it may contain ───────────────────────────────────────────────────
   *
   * `MachineLabelSchema` in `@home/types`: lowercase letters, digits and
   * hyphens, 1–32 characters, first character alphanumeric. `laptop`,
   * `work-desktop`, `mini`. That shape is deliberately too narrow to hold a
   * path, a person's name with spaces, or a `.local` hostname — see
   * `sanitiseMachineId` below, and the header of `packages/types/src/ingest.ts`
   * for why the narrowness is a privacy control rather than tidiness.
   *
   * It is a *public-ish* label in the sense that matters here: it is stored on
   * the server, so choose something you would not mind an operator reading, and
   * override the derived default if the derivation produced your name. Nothing
   * public reads the field — no query returns it and the site cannot say how
   * many computers there are — but "not currently rendered" is a weaker promise
   * than "never sensitive in the first place".
   *
   * Resolution order (see `resolveMachineId`): `$COLLECTOR_MACHINE_ID`, then
   * `machineId` in the config file, then a sanitised short hostname as a last
   * resort. Only the first two are choices; the third is a fallback that warns.
   */
  machineId: string;
  /**
   * Where `machineId` came from. Not sent anywhere — the CLI prints it, and
   * `'hostname'` is the case that earns a warning.
   */
  machineIdSource: MachineIdSource;
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
   * endpoint upserts on (`day`, `agent`, `machineId`), so re-sending is
   * idempotent rather than additive — and idempotent *per machine*, which is the
   * part that matters once there are two (see packages/types/src/ingest.ts and
   * `machineId` above). A week of overlap costs a
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
 * The machine label
 * ------------------------------------------------------------------ */

/** Where a resolved `machineId` came from, worst last. */
export type MachineIdSource = 'env' | 'config' | 'hostname';

/**
 * `MachineLabelSchema`'s alphabet, restated.
 *
 * Restated rather than imported for the same reason `config.ts` hand-rolls the
 * rest of its validation: this is the local half, its failure mode is a typo in
 * a file the author owns, and a thrown sentence beats a Zod stack. The wire is
 * still validated by the real schema — `buildPayload` parses through
 * `AiUsageIngestSchema` before anything is sent, so a divergence between these
 * two patterns is a build-time throw, not a bad row on the server.
 */
export const MACHINE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** `MachineLabelSchema`'s ceiling. */
export const MACHINE_ID_MAX_LENGTH = 32;

/** Environment override, mostly for testing a second machine from one checkout. */
export const MACHINE_ID_ENV_VAR = 'COLLECTOR_MACHINE_ID';

/**
 * What a hostname degrades to when nothing legible survives sanitising.
 *
 * A valid label, and an obviously *unchosen* one, so an operator looking at the
 * rows can tell "nobody named this machine" from "somebody named it that".
 */
export const FALLBACK_MACHINE_ID = 'unnamed-machine';

/**
 * Force an arbitrary string into the machine-label shape, or refuse.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  A PATH CANNOT SURVIVE THIS FUNCTION AS A PATH. THAT IS ITS JOB.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every character outside `[a-z0-9]` — including `/`, `\`, `.`, `_`, spaces and
 * every non-ASCII byte — becomes a hyphen, runs of hyphens collapse, and the
 * result is trimmed and cut to 32 characters. So `/Users/coreybaines/GitHub`
 * cannot arrive at the server *as a path*: it arrives, if at all, as
 * `users-coreybaines-github`, which is a label and not a location. It is still
 * derived from something local, which is exactly why the derived case warns and
 * the documentation says to override it.
 *
 * Everything before the first `.` is taken first, which is the "strip domain
 * suffixes" step: `studio.local`, `studio.lan`, `studio.example.internal` all
 * reduce to `studio`. mDNS appends `.local` to every Mac on the network, so
 * without this step the default label would be the same word on every machine
 * with the suffix attached.
 *
 * @returns the label, or `null` when nothing usable is left (an empty string, a
 *   string of punctuation, a name that was entirely non-ASCII). `null` is a
 *   refusal, never a silent substitution — the caller decides what to do about
 *   it, because "your config is wrong" and "your hostname is unhelpful" want
 *   different answers.
 */
export function sanitiseMachineId(raw: string): string | null {
  const label = raw
    .trim()
    .toLowerCase()
    // Strip the domain part. `hostname()` on a Mac is routinely `name.local`.
    .split('.')[0]!
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MACHINE_ID_MAX_LENGTH)
    // The slice can leave a trailing hyphen behind. Trim again rather than
    // before, or a 33-character name would keep one.
    .replace(/-+$/, '');

  return label.length > 0 && MACHINE_ID_PATTERN.test(label) ? label : null;
}

/**
 * This machine's default label: the short hostname, sanitised.
 *
 * ── The disagreement this function represents, stated out loud ─────────────
 *
 * `packages/types/src/ingest.ts` says the label is "operator-chosen … never
 * derived from the environment", and it is right that a *transmitted* hostname
 * is a privacy regression: `os.hostname()` on a personal Mac is habitually
 * `Coreys-MacBook-Pro.local`, which is a first name and a device model.
 *
 * This function derives one anyway, as a **last-resort fallback**, and the
 * reasoning is worth being explicit about rather than burying:
 *
 *   • The alternative is a collector that refuses to run until a config is
 *     edited. On a second machine, at the moment the operator is trying to prove
 *     multi-machine ingest works, that is a worse first experience than a label
 *     they can see and change.
 *   • The value is sanitised into a shape that cannot be a hostname *as such* —
 *     no dots, no domain, no case, 32 characters — so what reaches the server is
 *     a word, not an identifier resolvable back to a device.
 *   • It is announced. `collector.ts` prints the label and, when it came from
 *     here, prints a line telling the operator to pin it in the config.
 *
 * The cost is real and is not hidden: if the operator ignores the warning, a
 * label derived from their computer's name is stored server-side. Nothing public
 * reads it, but "unread" is not "absent". Set `machineId` and the derivation
 * never runs.
 *
 * @param name - injectable so the tests do not depend on the machine they run
 *   on. Defaults to `os.hostname()`.
 */
export function defaultMachineId(name: string = hostname()): string {
  return sanitiseMachineId(name) ?? FALLBACK_MACHINE_ID;
}

/**
 * Resolve the label: environment, then config, then hostname.
 *
 * The environment comes first because it is the per-run override — one checkout
 * can push as a different machine without editing a file, which is how the
 * multi-machine behaviour gets exercised without inventing a second laptop.
 *
 * A configured value is **validated, not sanitised**. Silently rewriting
 * `Work Laptop` to `work-laptop` would mean the operator's file and the server's
 * rows disagree about what this machine is called, and the first symptom would
 * be a duplicated history the day somebody "fixed" the config to match. A typo
 * in a value that forms part of a key should be loud.
 */
export function resolveMachineId(
  configured: unknown,
  environment: NodeJS.ProcessEnv = process.env,
): { machineId: string; machineIdSource: MachineIdSource } {
  const fromEnv = environment[MACHINE_ID_ENV_VAR];
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    const value = fromEnv.trim();
    if (!MACHINE_ID_PATTERN.test(value) || value.length > MACHINE_ID_MAX_LENGTH) {
      throw new Error(
        `$${MACHINE_ID_ENV_VAR} ("${value}") is not a machine label: lowercase letters,` +
          ` digits and hyphens, 1–${MACHINE_ID_MAX_LENGTH} characters, starting with a letter or digit.`,
      );
    }
    return { machineId: value, machineIdSource: 'env' };
  }

  if (configured !== undefined) {
    if (
      typeof configured !== 'string' ||
      !MACHINE_ID_PATTERN.test(configured) ||
      configured.length > MACHINE_ID_MAX_LENGTH
    ) {
      throw new Error(
        `collector config: "machineId" (${JSON.stringify(configured)}) is not a machine label:` +
          ` lowercase letters, digits and hyphens, 1–${MACHINE_ID_MAX_LENGTH} characters, starting` +
          ' with a letter or digit. It is part of the server-side upsert key — see config.ts.',
      );
    }
    return { machineId: configured, machineIdSource: 'config' };
  }

  return { machineId: defaultMachineId(), machineIdSource: 'hostname' };
}

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

  // Env → config → hostname. Throws on a configured value that is not a label;
  // see `resolveMachineId` for why that is not sanitised into shape instead.
  const { machineId, machineIdSource } = resolveMachineId(record.machineId);

  return {
    machineId,
    machineIdSource,
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
