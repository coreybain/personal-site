#!/usr/bin/env bun
/**
 * collector.ts — Pipeline 2's entry point. Runs daily under launchd.
 *
 *   cd tooling/collector
 *   bun run collect                # dry run: scan, aggregate, print. No network.
 *   bun run collect -- --push      # the same, then POST /ingest/ai-usage
 *   bun run inventory              # LOCAL diagnostic: which repo dirs map where
 *   bun test                       # the privacy tests
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  DRY RUN IS THE DEFAULT. `--push` IS THE ONLY WAY TO REACH THE NETWORK.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Inverted from the usual `--dry-run` flag on purpose. This script reads a
 * directory of everything its author has thought about for a year and then talks
 * to the internet; the version of that mistake where you forget a flag and see
 * some output is strictly better than the version where you forget a flag and
 * discover what you sent afterwards.
 *
 * ── The shape of a run ─────────────────────────────────────────────────────
 *
 *   1. loadConfig()          settings + the repo→slug mapping   (config.ts)
 *   2. scanClaude/scanCodex  disk → SessionSample[]             (scan-*.ts)
 *   3. buildPayload()        samples → the wire body            (payload.ts)
 *   4. pushAiUsage()         the only socket in the package     (push.ts)
 *
 * Step 3 is the privacy boundary: everything before it holds paths, nothing
 * after it does. See the header of payload.ts for the enforcement.
 */

import {
  loadConfig,
  makeSlugResolver,
  resolveToken,
  type CollectorConfig,
} from './config';
import { buildPayload, scanSince, windowDays } from './payload';
import { endpointFor, pushAiUsage } from './push';
import { scanClaude } from './scan-claude';
import { scanCodex } from './scan-codex';
import type { SessionSample } from './sessions';

/* ------------------------------------------------------------------ *
 * Arguments
 * ------------------------------------------------------------------ */

type Options = {
  push: boolean;
  inventory: boolean;
  json: boolean;
  quiet: boolean;
  lookbackDays: number | null;
  configPath: string | undefined;
};

function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    push: false,
    inventory: false,
    json: false,
    quiet: false,
    lookbackDays: null,
    configPath: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    switch (arg) {
      case '--push':
        options.push = true;
        break;
      case '--dry-run':
        // Accepted and ignored: it is already the default, and rejecting it
        // would punish the cautious.
        options.push = false;
        break;
      case '--inventory':
        options.inventory = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--quiet':
        options.quiet = true;
        break;
      case '--days': {
        const value = Number(argv[index + 1]);
        if (!Number.isFinite(value) || value < 1) {
          throw new Error('--days needs a positive integer');
        }
        options.lookbackDays = Math.floor(value);
        index += 1;
        break;
      }
      case '--config': {
        const value = argv[index + 1];
        if (value === undefined || value.startsWith('--')) {
          throw new Error('--config needs a path');
        }
        options.configPath = value;
        index += 1;
        break;
      }
      case '--help':
      case '-h':
        printUsage();
        // Typed `never`, so the switch does not fall through to `default`.
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printUsage(): void {
  console.log(
    [
      'Usage: bun run collector.ts [options]',
      '',
      '  (default)      Dry run. Scans, aggregates and prints. Never opens a socket.',
      '  --push         Also POST the payload to /ingest/ai-usage.',
      '  --json         Print the payload as raw JSON and nothing else.',
      '  --inventory    LOCAL ONLY. List the repo directories found on this machine',
      '                 and how they map to slugs. Prints private directory names —',
      '                 it is how you write collector.config.json. Never transmitted.',
      '  --days N       Override lookbackDays for this run.',
      '  --config PATH  Use a different collector.config.json.',
      '  --quiet        Only print warnings and errors.',
      '',
      'The bearer token comes from $COLLECTOR_INGEST_TOKEN or the tokenFile in',
      'the config. See README.md § Issuing a token.',
    ].join('\n'),
  );
}

/* ------------------------------------------------------------------ *
 * Scanning
 * ------------------------------------------------------------------ */

async function scanAll(
  config: CollectorConfig,
  lookbackDays: number,
  now: Date,
): Promise<{ samples: SessionSample[]; note: string }> {
  const since = scanSince(now, lookbackDays);

  const [claude, codex] = await Promise.all([
    scanClaude(config, since),
    scanCodex(config, since),
  ]);

  const note = [
    `claude: ${claude.filesScanned} transcripts read`,
    `${claude.filesSkippedOld} older than window`,
    `${claude.filesWithoutTimestamps} unusable`,
    `codex: ${codex.filesScanned} first-lines read`,
    `${codex.dayDirsSkipped} day dirs skipped`,
    `${codex.filesUnparsed} unusable`,
  ].join(', ');

  return { samples: [...claude.samples, ...codex.samples], note };
}

/* ------------------------------------------------------------------ *
 * Inventory — local diagnostic
 * ------------------------------------------------------------------ */

/**
 * Print every repo directory this machine has agent sessions for, and the slug
 * it maps to. **This is the one command that prints private directory names**,
 * which is exactly why it is a separate command and not part of the normal
 * output: writing `collector.config.json` requires knowing what is there, and
 * nothing else does.
 */
function printInventory(samples: readonly SessionSample[], config: CollectorConfig): void {
  const resolveSlug = makeSlugResolver(config.repos);
  const seen = new Map<string, { sessions: number; hours: number; slug: string | null }>();

  for (const sample of samples) {
    const entry = seen.get(sample.pathToken) ?? {
      sessions: 0,
      hours: 0,
      slug: resolveSlug(sample.pathToken),
    };
    entry.sessions += 1;
    entry.hours += sample.hours;
    seen.set(sample.pathToken, entry);
  }

  const rows = [...seen.entries()].sort((a, b) => b[1].sessions - a[1].sessions);

  console.log('');
  console.log('  LOCAL ONLY — these directory names are private (ADR 008).');
  console.log('  Nothing below is transmitted. Only the `slug` column ever is.');
  console.log('');
  console.log('  sessions   hours  slug            directory token');
  console.log('  --------  ------  --------------  ---------------------------------');
  for (const [token, entry] of rows) {
    console.log(
      `  ${String(entry.sessions).padStart(8)}  ${entry.hours.toFixed(1).padStart(6)}  ` +
        `${(entry.slug ?? '—').padEnd(14)}  ${token}`,
    );
  }
  console.log('');
  console.log(
    `  ${rows.filter(([, entry]) => entry.slug === null).length} of ${rows.length} directories are unmapped;` +
      ' their sessions count toward the totals but no project.',
  );
  console.log('');
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  const config = loadConfig(options.configPath);
  const lookbackDays = options.lookbackDays ?? config.lookbackDays;
  const now = new Date();

  const log = options.quiet || options.json ? () => {} : console.log;

  const startedAt = Date.now();
  const { samples, note } = await scanAll(config, lookbackDays, now);
  const scanMs = Date.now() - startedAt;

  if (options.inventory) {
    printInventory(samples, config);
    return 0;
  }

  const { payload, summary } = buildPayload(samples, makeSlugResolver(config.repos), {
    now,
    lookbackDays,
  });

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return payload === null ? 1 : 0;
  }

  const days = windowDays(now, lookbackDays);
  log('');
  log(`  AI usage collector — ${days[0]} … ${days[days.length - 1]} (UTC, ${lookbackDays} days)`);
  log(`  scanned in ${(scanMs / 1000).toFixed(1)}s — ${note}`);
  log('');
  log(`  sessions in window   ${summary.totalSessions}`);
  log(`  hours in window      ${summary.totalHours.toFixed(2)}`);
  log(`  day/agent rows       ${summary.rows}`);
  log(
    `  unattributed         ${summary.unattributedSessions} sessions across ` +
      `${summary.unmappedRepoCount} unmapped repos (counted in totals, no project)`,
  );
  log(`  dropped              ${summary.droppedOutsideWindow} sessions outside the window`);
  log('');

  if (summary.perAgent.length > 0) {
    log('  per agent');
    for (const agent of summary.perAgent) {
      log(`    ${agent.agent.padEnd(8)} ${String(agent.sessions).padStart(5)} sessions  ${agent.hours.toFixed(2).padStart(8)} h`);
    }
    log('');
  }

  if (summary.perProject.length > 0) {
    log('  per project (the breakdown that reaches projects.aiBuildStats)');
    for (const project of summary.perProject) {
      log(
        `    ${project.projectSlug.padEnd(14)} ${String(project.sessions).padStart(5)} sessions  ` +
          `${project.hours.toFixed(2).padStart(8)} h`,
      );
    }
    log('');
  }

  if (payload === null) {
    log('  Nothing to send: no sessions started inside the window.');
    log('');
    return 0;
  }

  if (!options.push) {
    log('  ── payload (dry run — nothing was sent) ─────────────────────────');
    log(JSON.stringify(payload, null, 2));
    log('');
    log(`  Would POST to ${endpointFor(config.convexSiteUrl)}`);
    log('  Re-run with --push to send it.');
    log('');
    return 0;
  }

  const token = resolveToken(config);
  if (token === null) {
    console.error(
      `  No ingest token. Set $${config.tokenEnvVar} or write one to ${config.tokenFile}.` +
        ' See README.md § Issuing a token.',
    );
    return 2;
  }

  const result = await pushAiUsage(payload, {
    convexSiteUrl: config.convexSiteUrl,
    token,
  });

  if (!result.ok) {
    console.error(
      `  Push failed after ${result.attempts} attempt(s): ${result.detail}` +
        (result.status === 401 || result.status === 403
          ? ' — the token is unknown, revoked, or lacks ai-usage:write.'
          : ''),
    );
    return 1;
  }

  const n = (value: number | null): string => (value === null ? '?' : String(value));

  log(
    `  Pushed ${payload.days.length} day/agent rows in ${result.attempts} attempt(s).`,
  );
  // Created vs. updated is the line that tells an operator whether a re-run did
  // what a re-run is supposed to do: on the second run of the same day, every
  // row should be an update and none a create. Printing only a single "accepted"
  // total would make an accidental duplicate-insert regression invisible here.
  log(
    `    days      ${n(result.daysCreated)} created, ${n(result.daysUpdated)} updated`,
  );
  log(
    `    projects  ${n(result.projectsUpdated)} updated, ` +
      `${n(result.unmappedProjects)} slug(s) matched no case study`,
  );
  log(`    snapshot  ${result.snapshotRefold ?? '?'}`);
  log('');
  return 0;
}

// `import.meta.main` is false when bun test imports this module, so the CLI does
// not run itself during the privacy tests.
if (import.meta.main) {
  try {
    process.exit(await main());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}
