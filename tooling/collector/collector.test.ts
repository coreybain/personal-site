/**
 * collector.test.ts — the Verification plan's collector clause, executed.
 *
 *   "Collector privacy: unit-test that the payload contains only numeric
 *    aggregates and repo slugs. Assert no prompt or file content can reach it."
 *
 * That is two assertions, and they are tested two different ways:
 *
 *   • **"contains only …"** is tested *structurally*, by walking the serialised
 *     payload and requiring every key to be one of eight names and every string
 *     to be a date, an agent id, or a slug from the config. A new field carrying
 *     a number fails this as surely as one carrying a string, which is the point
 *     — the test is an allowlist, not a search for known-bad values.
 *
 *   • **"no prompt or file content can reach it"** is tested *adversarially*,
 *     with fixtures built to leak: transcripts whose prompts contain absolute
 *     paths, fake API keys and marker strings; session files whose second line
 *     is a wall of secrets; path tokens that are entire home directories. The
 *     assertion is that none of those markers appears anywhere in the bytes the
 *     collector would send.
 *
 * Everything here runs against fixtures in a temp directory. Nothing in this
 * file reads ~/.claude or ~/.codex — a test that passes only on the author's
 * laptop is not a test, and a test that reads real prompts to prove real prompts
 * stay private has already lost the argument.
 *
 *   cd tooling/collector && bun test
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AiUsageIngestSchema } from '../../packages/types/src/ingest';
import {
  encodePathLikeClaude,
  makeSlugResolver,
  resolveToken,
  type CollectorConfig,
  type RepoMapping,
} from './config';
import { buildPayload, scanSince, windowDays } from './payload';
import { endpointFor } from './push';
import { scanClaude, scanTimestamps } from './scan-claude';
import { parseSessionMeta, readFirstLine, scanCodex } from './scan-codex';
import { hoursFromGaps, hoursFromSpan, utcDay, type SessionSample } from './sessions';

/* ------------------------------------------------------------------ *
 * Fixture scaffolding
 * ------------------------------------------------------------------ */

const workspace = mkdtempSync(join(tmpdir(), 'home-collector-test-'));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

/**
 * Strings that must never appear in anything the collector would transmit.
 *
 * Deliberately shaped like the four things that actually leak from a tool like
 * this: an absolute path, a credential, a filename, and prose from a prompt.
 */
const CANARIES = [
  '/Users/coreybaines/GitHub',
  'sk-live-DO-NOT-LEAK-4f2a9',
  'apps/web/src/lib/snapshot.ts',
  'CANARY_PROMPT_TEXT_MUST_NOT_ESCAPE',
  'BEGIN RSA PRIVATE KEY',
] as const;

/**
 * The fixture mapping. Every `dir` here is **invented**.
 *
 * A test fixture is committed source, and this is a public repository — so
 * pasting the real `collector.config.json` in here would publish the private
 * checkout directory names that ADR 008 keeps on this machine, which is
 * precisely the leak the code under test exists to prevent. (It is also why
 * `collector.config.json` itself is gitignored.) The slugs are real because
 * slugs are already public; the left-hand side never is.
 *
 * Nothing is lost: the resolver takes its mapping as an argument, so a fabricated
 * one exercises exactly the same code paths.
 */
const REPOS: RepoMapping[] = [
  { dir: 'personal-site', slug: 'home' },
  { dir: 'client-app-v2', slug: 'quotecloud' },
  { dir: 'internal-tool', slug: 'zerorisk' },
];

const SLUGS = new Set(REPOS.map((repo) => repo.slug));

function testConfig(overrides: Partial<CollectorConfig> = {}): CollectorConfig {
  return {
    convexSiteUrl: 'https://example.convex.site',
    tokenEnvVar: 'COLLECTOR_INGEST_TOKEN',
    tokenFile: '~/.config/home-collector/token',
    claudeProjectsDir: join(workspace, 'claude'),
    codexSessionsDir: join(workspace, 'codex'),
    lookbackDays: 7,
    idleGapMinutes: 30,
    maxSessionHours: 6,
    repos: REPOS,
    ...overrides,
  };
}

const HOUR = 3_600_000;
const NOW = new Date();

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60_000);
}

/* ------------------------------------------------------------------ *
 * Payload inspection helpers
 * ------------------------------------------------------------------ */

/** Every key name appearing anywhere in a JSON value. */
function keysIn(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) keysIn(item, out);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      out.add(key);
      keysIn(item, out);
    }
  }
  return out;
}

/** Every string *value* appearing anywhere in a JSON value. */
function stringsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) stringsIn(item, out);
  } else if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) stringsIn(item, out);
  }
  return out;
}

/** Every non-string leaf. Used to prove the rest of the payload is numeric. */
function nonStringLeavesIn(value: unknown, out: unknown[] = []): unknown[] {
  if (Array.isArray(value)) {
    for (const item of value) nonStringLeavesIn(item, out);
  } else if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) nonStringLeavesIn(item, out);
  } else if (typeof value !== 'string') {
    out.push(value);
  }
  return out;
}

const ALLOWED_KEYS = new Set([
  'days',
  'postedAt',
  'day',
  'agent',
  'sessions',
  'hours',
  'projects',
  'projectSlug',
]);

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

/**
 * The allowlist assertion, factored out because four tests need it.
 *
 * Reads as the sentence the plan asks for: this payload contains only numeric
 * aggregates, day strings, agent names and slugs.
 */
function assertOnlyAggregatesAndSlugs(payload: unknown, allowedSlugs: ReadonlySet<string>): void {
  for (const key of keysIn(payload)) {
    expect(ALLOWED_KEYS).toContain(key);
  }

  for (const value of stringsIn(payload)) {
    const isDay = ISO_DAY.test(value);
    const isInstant = ISO_INSTANT.test(value);
    const isAgent = value === 'claude' || value === 'codex';
    const isSlug = allowedSlugs.has(value);
    if (!(isDay || isInstant || isAgent || isSlug)) {
      throw new Error(
        `Payload contains a string that is not a date, an agent id or a configured slug: ${JSON.stringify(value)}`,
      );
    }
  }

  for (const leaf of nonStringLeavesIn(payload)) {
    expect(typeof leaf).toBe('number');
    expect(Number.isFinite(leaf as number)).toBe(true);
    expect(leaf as number).toBeGreaterThanOrEqual(0);
  }
}

/** No canary — and no path separator at all — survives into the bytes sent. */
function assertNoCanaries(payload: unknown): void {
  const serialised = JSON.stringify(payload);
  for (const canary of CANARIES) {
    expect(serialised).not.toContain(canary);
  }
  // Stronger and simpler than any canary list: nothing the payload may contain
  // has a path separator in it. Slugs are kebab-case, dates use dashes.
  expect(serialised).not.toContain('/');
  expect(serialised).not.toContain('\\');
  expect(serialised.toLowerCase()).not.toContain('users');
}

/* ------------------------------------------------------------------ *
 * 1. The builder — the payload contract
 * ------------------------------------------------------------------ */

describe('buildPayload — the privacy boundary', () => {
  /**
   * Hostile input: every sample's `pathToken` is a real absolute path carrying
   * every canary at once. Two of them map to a slug, one does not.
   */
  const hostileSamples: SessionSample[] = [
    {
      agent: 'claude',
      startedAt: minutesAgo(120),
      hours: 1.5,
      pathToken: encodePathLikeClaude(
        `/Users/coreybaines/GitHub/personal-site/${CANARIES[3]}/${CANARIES[1]}`,
      ),
    },
    {
      agent: 'codex',
      startedAt: minutesAgo(180),
      hours: 2,
      pathToken: encodePathLikeClaude('/Users/coreybaines/GitHub/client-app-v2/apps/zapier'),
    },
    {
      agent: 'codex',
      startedAt: minutesAgo(200),
      hours: 3,
      // No mapping. Its name is a private repo name and must not appear.
      pathToken: encodePathLikeClaude(
        `/Users/coreybaines/GitHub/${CANARIES[4].replace(/[^a-z]/gi, '-')}`,
      ),
    },
  ];

  const resolveSlug = makeSlugResolver(REPOS);
  const { payload, summary } = buildPayload(hostileSamples, resolveSlug, {
    now: NOW,
    lookbackDays: 7,
  });

  test('produces a payload for in-window samples', () => {
    expect(payload).not.toBeNull();
  });

  test('contains only numeric aggregates, days, agent ids and configured slugs', () => {
    assertOnlyAggregatesAndSlugs(payload, SLUGS);
  });

  test('no path fragment, credential or prompt text survives serialisation', () => {
    assertNoCanaries(payload);
  });

  test('the result satisfies the shared Zod contract', () => {
    // Redundant by construction — buildPayload parses before returning — and
    // kept anyway, because "redundant by construction" is exactly the kind of
    // claim a refactor quietly falsifies.
    expect(() => AiUsageIngestSchema.parse(payload)).not.toThrow();
  });

  test('an unmapped repo lands in the totals and in no project breakdown', () => {
    expect(summary.unattributedSessions).toBe(1);
    expect(summary.unmappedRepoCount).toBe(1);

    const slugsUsed = new Set(
      payload!.days.flatMap((day) => day.projects.map((project) => project.projectSlug)),
    );
    expect([...slugsUsed].sort()).toEqual(['home', 'quotecloud']);

    const totalSessions = payload!.days.reduce((sum, day) => sum + day.sessions, 0);
    const breakdownSessions = payload!.days.reduce(
      (sum, day) => sum + day.projects.reduce((inner, project) => inner + project.sessions, 0),
      0,
    );
    expect(totalSessions).toBe(3);
    expect(breakdownSessions).toBe(2);
  });

  test('day totals are never less than their project breakdown', () => {
    for (const day of payload!.days) {
      const sessions = day.projects.reduce((sum, project) => sum + project.sessions, 0);
      const hours = day.projects.reduce((sum, project) => sum + project.hours, 0);
      expect(day.sessions).toBeGreaterThanOrEqual(sessions);
      expect(day.hours).toBeGreaterThanOrEqual(hours);
    }
  });

  test('the wire schema rejects a smuggled field rather than stripping it', () => {
    // The load-bearing property behind every assertion above: `strictObject`
    // means a future `cwd`, `hostname` or `prompt` on a payload is a thrown
    // error at build time, not a silent extra key on the wire.
    const smuggled = {
      days: [
        {
          day: utcDay(NOW),
          agent: 'claude',
          sessions: 1,
          hours: 1,
          projects: [],
          cwd: '/Users/coreybaines/GitHub/personal-site',
        },
      ],
      postedAt: NOW.toISOString(),
    };
    expect(() => AiUsageIngestSchema.parse(smuggled)).toThrow();
  });

  test('samples outside the window are dropped, not clamped into it', () => {
    const stale: SessionSample = {
      agent: 'claude',
      startedAt: new Date(NOW.getTime() - 90 * 24 * HOUR),
      hours: 4,
      pathToken: encodePathLikeClaude('/Users/coreybaines/GitHub/personal-site'),
    };
    const { payload: only, summary: staleSummary } = buildPayload([stale], resolveSlug, {
      now: NOW,
      lookbackDays: 7,
    });
    expect(only).toBeNull();
    expect(staleSummary.droppedOutsideWindow).toBe(1);
  });

  test('an empty window posts nothing rather than posting zeroes', () => {
    const { payload: none } = buildPayload([], resolveSlug, { now: NOW, lookbackDays: 7 });
    expect(none).toBeNull();
  });

  test('the summary printed by the dry run is itself aggregate-only', () => {
    // The dry run prints this object to a terminal and, under launchd, to a log
    // file. It has to be as safe as the payload, and it is checked the same way:
    // every string is a date, an agent id or a configured slug, and everything
    // else is a number. `unmappedRepoCount` is why that holds — the unmapped
    // repos are counted, never named.
    for (const value of stringsIn(summary)) {
      const ok =
        ISO_DAY.test(value) || value === 'claude' || value === 'codex' || SLUGS.has(value);
      if (!ok) {
        throw new Error(`Dry-run summary contains a non-aggregate string: ${JSON.stringify(value)}`);
      }
    }
    for (const leaf of nonStringLeavesIn(summary)) {
      expect(typeof leaf).toBe('number');
    }
    assertNoCanaries(summary);
  });
});

/* ------------------------------------------------------------------ *
 * 2. The Claude scanner
 * ------------------------------------------------------------------ */

describe('scanClaude — transcripts in, timestamps out', () => {
  const projectsRoot = join(workspace, 'claude');

  /** A transcript line shaped like the real thing, stuffed with canaries. */
  function transcriptLine(instant: Date, extra: Record<string, unknown> = {}): string {
    return JSON.stringify({
      parentUuid: null,
      type: 'user',
      cwd: '/Users/coreybaines/GitHub/personal-site',
      sessionId: 'fixture',
      version: '1.0.0',
      gitBranch: 'main',
      timestamp: instant.toISOString(),
      message: {
        role: 'user',
        content: `${CANARIES[3]} — please read ${CANARIES[2]} using ${CANARIES[1]}`,
      },
      toolUseResult: { stdout: CANARIES[4] },
      ...extra,
    });
  }

  const mappedDir = join(projectsRoot, '-Users-coreybaines-GitHub-personal-site');
  const unmappedDir = join(projectsRoot, '-Users-coreybaines-Documents-something-private');
  mkdirSync(mappedDir, { recursive: true });
  mkdirSync(unmappedDir, { recursive: true });

  // A session with three events spanning 40 minutes, 10 of them idle.
  writeFileSync(
    join(mappedDir, 'aaaaaaaa-1111-2222-3333-444444444444.jsonl'),
    [
      transcriptLine(minutesAgo(60)),
      transcriptLine(minutesAgo(50)),
      transcriptLine(minutesAgo(20)),
    ].join('\n') + '\n',
  );

  // A nested directory of subagent transcripts. Must be ignored entirely: these
  // are not sessions, and counting them would multiply-count one session.
  mkdirSync(join(mappedDir, 'aaaaaaaa-1111-2222-3333-444444444444', 'subagents'), {
    recursive: true,
  });
  writeFileSync(
    join(mappedDir, 'aaaaaaaa-1111-2222-3333-444444444444', 'subagents', 'sub.jsonl'),
    [transcriptLine(minutesAgo(55)), transcriptLine(minutesAgo(45))].join('\n') + '\n',
  );

  writeFileSync(
    join(unmappedDir, 'bbbbbbbb-1111-2222-3333-444444444444.jsonl'),
    [transcriptLine(minutesAgo(30)), transcriptLine(minutesAgo(25))].join('\n') + '\n',
  );

  test('extracts timestamps without decoding a single message', async () => {
    const instants = await scanTimestamps(
      join(mappedDir, 'aaaaaaaa-1111-2222-3333-444444444444.jsonl'),
      NOW.getTime(),
    );
    expect(instants.length).toBeGreaterThanOrEqual(3);
    for (const instant of instants) {
      expect(instant).toBeInstanceOf(Date);
      expect(Number.isNaN(instant.getTime())).toBe(false);
    }
  });

  test('counts one session per top-level file and ignores nested directories', async () => {
    const result = await scanClaude(testConfig(), minutesAgo(60 * 24));
    expect(result.samples.length).toBe(2);
    expect(result.samples.every((sample) => sample.agent === 'claude')).toBe(true);
  });

  test('a sample carries nothing but an agent, an instant, hours and a path token', async () => {
    const result = await scanClaude(testConfig(), minutesAgo(60 * 24));
    for (const sample of result.samples) {
      expect(Object.keys(sample).sort()).toEqual(['agent', 'hours', 'pathToken', 'startedAt']);
      // The path token is the *directory name*, never a file name and never a
      // line of the transcript.
      expect(sample.pathToken.includes('.jsonl')).toBe(false);
      for (const canary of CANARIES) {
        expect(sample.pathToken).not.toContain(canary);
      }
    }
  });

  test('end to end, a payload built from those transcripts leaks nothing', async () => {
    const result = await scanClaude(testConfig(), minutesAgo(60 * 24));
    const { payload } = buildPayload(result.samples, makeSlugResolver(REPOS), {
      now: NOW,
      lookbackDays: 7,
    });
    expect(payload).not.toBeNull();
    assertOnlyAggregatesAndSlugs(payload, SLUGS);
    assertNoCanaries(payload);
  });

  test('a transcript with no timestamp is not counted as a session', async () => {
    const emptyDir = join(projectsRoot, '-Users-coreybaines-GitHub-zerorisk');
    mkdirSync(emptyDir, { recursive: true });
    writeFileSync(
      join(emptyDir, 'cccccccc-1111-2222-3333-444444444444.jsonl'),
      `${JSON.stringify({ type: 'summary', message: CANARIES[3] })}\n`,
    );

    const result = await scanClaude(testConfig(), minutesAgo(60 * 24));
    expect(result.filesWithoutTimestamps).toBe(1);
    expect(result.samples.some((sample) => sample.pathToken.includes('zerorisk'))).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * 3. The Codex scanner
 * ------------------------------------------------------------------ */

describe('scanCodex — line 1 and nothing else', () => {
  const sessionsRoot = join(workspace, 'codex');

  function sessionMetaLine(instant: Date, cwd: string): string {
    return JSON.stringify({
      timestamp: instant.toISOString(),
      type: 'session_meta',
      payload: {
        session_id: 'fixture',
        timestamp: instant.toISOString(),
        cwd,
        originator: 'Codex Desktop',
        cli_version: '0.0.0',
        // The real records carry the entire system prompt here. If anything in
        // this package regexed for `"cwd"` instead of reading the field, this
        // line would poison it.
        base_instructions: { text: `You are Codex. cwd is "${CANARIES[0]}/decoy".` },
      },
    });
  }

  /** Everything after line 1 is what must never be read. */
  const SECRET_BODY = [
    JSON.stringify({ type: 'message', text: CANARIES[3] }),
    JSON.stringify({ type: 'message', text: CANARIES[1] }),
    JSON.stringify({ type: 'file', path: CANARIES[2], contents: CANARIES[4] }),
  ].join('\n');

  function writeSession(instant: Date, cwd: string, name: string): void {
    const year = instant.getFullYear();
    const month = `${instant.getMonth() + 1}`.padStart(2, '0');
    const day = `${instant.getDate()}`.padStart(2, '0');
    const dir = join(sessionsRoot, `${year}`, month, day);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `rollout-${name}.jsonl`), `${sessionMetaLine(instant, cwd)}\n${SECRET_BODY}\n`);
  }

  writeSession(minutesAgo(150), '/Users/coreybaines/GitHub/client-app-v2', 'a');
  writeSession(minutesAgo(90), '/Users/coreybaines/.codex-worktrees/3a1a/client-app-v2', 'b');
  writeSession(minutesAgo(45), '/Users/coreybaines/Documents/private-thing', 'c');

  test('reads the first line and stops', async () => {
    const dir = join(
      sessionsRoot,
      `${minutesAgo(150).getFullYear()}`,
      `${minutesAgo(150).getMonth() + 1}`.padStart(2, '0'),
      `${minutesAgo(150).getDate()}`.padStart(2, '0'),
    );
    const line = await readFirstLine(join(dir, 'rollout-a.jsonl'));
    expect(line).not.toBeNull();
    for (const canary of CANARIES.slice(1)) {
      expect(line!).not.toContain(canary);
    }
    // Line 1 legitimately mentions a path inside `base_instructions`; the point
    // is that `parseSessionMeta` does not take it.
    expect(line!).toContain('session_meta');
  });

  test('a file with no newline within the cap is skipped rather than slurped', async () => {
    const dir = join(sessionsRoot, '2099', '01', '01');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'rollout-huge.jsonl'), 'x'.repeat(2_000_000));
    expect(await readFirstLine(join(dir, 'rollout-huge.jsonl'))).toBeNull();
    rmSync(join(dir, 'rollout-huge.jsonl'));
  });

  test('parseSessionMeta returns exactly two fields, and takes cwd structurally', () => {
    const instant = minutesAgo(150);
    const meta = parseSessionMeta(
      sessionMetaLine(instant, '/Users/coreybaines/GitHub/client-app-v2'),
    );
    expect(meta).not.toBeNull();
    expect(Object.keys(meta!).sort()).toEqual(['cwd', 'startedAt']);
    // The decoy path inside `base_instructions` must not have been picked up.
    expect(meta!.cwd).toBe('/Users/coreybaines/GitHub/client-app-v2');
    expect(meta!.startedAt.toISOString()).toBe(instant.toISOString());
  });

  test('a malformed or non-session_meta line 1 is skipped, not thrown on', () => {
    expect(parseSessionMeta('{not json')).toBeNull();
    expect(parseSessionMeta(JSON.stringify({ type: 'message', payload: { cwd: '/x' } }))).toBeNull();
    expect(parseSessionMeta(JSON.stringify({ type: 'session_meta', payload: {} }))).toBeNull();
  });

  test('end to end, a payload built from those sessions leaks nothing', async () => {
    const result = await scanCodex(testConfig(), minutesAgo(60 * 24));
    expect(result.samples.length).toBe(3);

    const { payload, summary } = buildPayload(result.samples, makeSlugResolver(REPOS), {
      now: NOW,
      lookbackDays: 7,
    });
    expect(payload).not.toBeNull();
    assertOnlyAggregatesAndSlugs(payload, SLUGS);
    assertNoCanaries(payload);

    // Two mapped (repo + worktree, merged under one slug), one not.
    expect(summary.unattributedSessions).toBe(1);
    expect(summary.perProject).toEqual([
      { projectSlug: 'quotecloud', sessions: 2, hours: expect.any(Number) },
    ]);
  });
});

/* ------------------------------------------------------------------ *
 * 4. Repo → slug resolution
 * ------------------------------------------------------------------ */

describe('makeSlugResolver', () => {
  const resolve = makeSlugResolver([
    { dir: 'personal-site', slug: 'home' },
    { dir: 'client-app', slug: 'client-app-legacy' },
    { dir: 'client-app-v2', slug: 'quotecloud' },
  ]);

  const token = (path: string): string => encodePathLikeClaude(path);

  test('matches the repo root', () => {
    expect(resolve(token('/Users/me/GitHub/personal-site'))).toBe('home');
  });

  test('matches a package inside the repo', () => {
    expect(resolve(token('/Users/me/GitHub/personal-site/packages/convex'))).toBe('home');
  });

  test('matches both agent worktree encodings', () => {
    // `.claude` survives as `-.claude-` in one Claude version and `--claude-` in
    // another. Both appear in the real projects directory.
    expect(resolve('-Users-me-GitHub-client-app-v2-.claude-worktrees-abc123')).toBe('quotecloud');
    expect(resolve('-Users-me-GitHub-client-app-v2--claude-worktrees-abc123')).toBe('quotecloud');
  });

  test('matches a worktree parked outside the repo', () => {
    expect(resolve(token('/Users/me/.codex-worktrees/3a1a/client-app-v2'))).toBe('quotecloud');
  });

  test('longest match wins, so a prefix repo does not swallow a longer one', () => {
    expect(resolve(token('/Users/me/GitHub/client-app-v2'))).toBe('quotecloud');
    expect(resolve(token('/Users/me/GitHub/client-app'))).toBe('client-app-legacy');
  });

  test('matching is segment-wise, not substring', () => {
    // `home` is not configured here, but if it were, this must not match it.
    const withHome = makeSlugResolver([{ dir: 'home', slug: 'home' }]);
    expect(withHome(token('/Users/me/GitHub/home'))).toBe('home');
    expect(withHome(token('/opt/homebrew/lib'))).toBeNull();
    expect(withHome(token('/Users/me/GitHub/homepage'))).toBeNull();
  });

  test('an unconfigured repo resolves to null', () => {
    expect(resolve(token('/Users/me/GitHub/something-else'))).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * 5. Estimators and the window
 * ------------------------------------------------------------------ */

describe('duration estimation', () => {
  const config = { idleGapMinutes: 30, maxSessionHours: 6 };

  test('gap summing caps an idle stretch', () => {
    const start = new Date('2026-07-30T00:00:00Z');
    const instants = [
      start,
      new Date(start.getTime() + 10 * 60_000), // 10 min of work
      new Date(start.getTime() + 190 * 60_000), // 3 h away → capped at 30 min
      new Date(start.getTime() + 200 * 60_000), // 10 min more
    ];
    // Rounded to two decimals by `roundHours`, so compare at that precision.
    expect(hoursFromGaps(instants, config)).toBeCloseTo((10 + 30 + 10) / 60, 2);
  });

  test('order does not matter', () => {
    const start = new Date('2026-07-30T00:00:00Z');
    const forwards = [start, new Date(start.getTime() + 5 * 60_000)];
    expect(hoursFromGaps([...forwards].reverse(), config)).toBe(hoursFromGaps(forwards, config));
  });

  test('a single event is a session with no elapsed time', () => {
    expect(hoursFromGaps([new Date()], config)).toBe(0);
    expect(hoursFromGaps([], config)).toBe(0);
  });

  test('spans are capped at maxSessionHours', () => {
    const start = new Date('2026-07-30T00:00:00Z');
    expect(hoursFromSpan(start, new Date(start.getTime() + 2 * HOUR), config)).toBe(2);
    expect(hoursFromSpan(start, new Date(start.getTime() + 40 * HOUR), config)).toBe(6);
  });

  test('a negative or zero span is zero, never negative', () => {
    const start = new Date('2026-07-30T00:00:00Z');
    expect(hoursFromSpan(start, new Date(start.getTime() - HOUR), config)).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * 6. The push surface — checked without opening a socket
 * ------------------------------------------------------------------ */

describe('push configuration', () => {
  test('posts to the HTTP-actions origin and path the route will serve', () => {
    expect(endpointFor('https://hip-dragon-50.convex.site')).toBe(
      'https://hip-dragon-50.convex.site/ingest/ai-usage',
    );
    // A trailing slash in config must not produce a double slash in the URL.
    expect(endpointFor('https://example.convex.site/')).toBe(
      'https://example.convex.site/ingest/ai-usage',
    );
  });

  test('a missing token resolves to null rather than throwing or guessing', () => {
    // Both sources absent: an unset variable and a path with no file. The CLI
    // turns this into an exit code and a pointer at the README — it must never
    // proceed to a request with an empty Authorization header.
    const config = testConfig({
      tokenEnvVar: 'COLLECTOR_TOKEN_THAT_IS_NOT_SET_ANYWHERE',
      tokenFile: join(workspace, 'no-such-token-file'),
    });
    expect(resolveToken(config)).toBeNull();
  });

  test('a token file is read and trimmed', () => {
    const tokenFile = join(workspace, 'token');
    writeFileSync(tokenFile, '  ing_deadbeef\n');
    const config = testConfig({
      tokenEnvVar: 'COLLECTOR_TOKEN_THAT_IS_NOT_SET_ANYWHERE',
      tokenFile,
    });
    expect(resolveToken(config)).toBe('ing_deadbeef');
  });
});

describe('the reporting window', () => {
  test('is inclusive of today and lookbackDays long', () => {
    const days = windowDays(new Date('2026-07-31T09:00:00Z'), 7);
    expect(days).toEqual([
      '2026-07-25',
      '2026-07-26',
      '2026-07-27',
      '2026-07-28',
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
    ]);
  });

  test('scanning starts a day before the window so the edges are complete', () => {
    const since = scanSince(new Date('2026-07-31T09:00:00Z'), 7);
    expect(since.toISOString()).toBe('2026-07-24T00:00:00.000Z');
  });

  test('a session is attributed to the UTC day it started, across midnight', () => {
    const crossesMidnight: SessionSample = {
      agent: 'codex',
      startedAt: new Date('2026-07-30T23:30:00Z'),
      hours: 2,
      pathToken: '-Users-me-GitHub-personal-site',
    };
    const { payload } = buildPayload([crossesMidnight], makeSlugResolver(REPOS), {
      now: new Date('2026-07-31T09:00:00Z'),
      lookbackDays: 7,
    });
    expect(payload!.days).toHaveLength(1);
    expect(payload!.days[0]!.day).toBe('2026-07-30');
    expect(payload!.days[0]!.hours).toBe(2);
  });
});
