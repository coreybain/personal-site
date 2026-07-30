/**
 * scan-claude.ts — `~/.claude/projects` → `SessionSample[]`.
 *
 * Layout on disk:
 *
 *   ~/.claude/projects/
 *     -Users-coreybaines-GitHub-personal-site/     ← one dir per project, name
 *       c61fe8af-….jsonl                             is the path-encoded cwd
 *       20ee1d7d-….jsonl                           ← one file per session
 *       <session-id>/…                             ← NOT sessions: subagent
 *       vercel-plugin/…                              transcripts, tool results,
 *                                                    plugin logs. Skipped.
 *
 * Only `*.jsonl` files at the *top level* of a project directory are sessions.
 * The nested directories hold subagent transcripts, cached tool results and
 * plugin injections — counting those would multiply-count one session and, worse,
 * would walk directories whose contents nobody has characterised.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  HOW THIS FILE READS A TRANSCRIPT WITHOUT READING A TRANSCRIPT.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A Claude transcript line is a JSON object whose keys, verified by sampling a
 * real file on 2026-07-31, are: `type`, `sessionId`, `timestamp`, `uuid`,
 * `parentUuid`, `version`, `userType`, `isSidechain`, `gitBranch`, `entrypoint`,
 * `cwd`, and — the ones that matter here — `message`, `content`, `attachment`,
 * `toolUseResult`, `lastPrompt`. Those last five are the user's prompts, the
 * model's replies, file contents and tool output.
 *
 * So this file never parses a line. `scanTimestamps` streams the file in chunks
 * and applies one regular expression that matches an ISO-8601 instant in a
 * `"timestamp"` field. The only values that survive into a variable are
 * `Date` objects. There is no code path here that can hold a message, because
 * there is no code path here that decodes JSON.
 *
 * The cost of that choice, stated plainly: if a prompt happens to contain the
 * literal text `"timestamp":"2026-01-01T…Z"`, the regex will match it. What
 * leaks from that is *a date*, into a gap sum — not the prompt. The sanity
 * window below discards anything implausible, and the gap cap bounds the damage
 * of anything that gets through. That is the whole exposure, and it is smaller
 * than the exposure of a JSON parser holding the message in memory.
 */

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { CollectorConfig } from './config';
import { expandHome } from './config';
import { hoursFromGaps, type SessionSample } from './sessions';

/**
 * Matches `"timestamp":"2026-07-29T21:53:15.391Z"` and captures the instant.
 *
 * Deliberately narrow: a four-digit year, the `T`, digits/colons/dots, a `Z`.
 * Anything looser starts matching prose.
 */
const TIMESTAMP_PATTERN = /"timestamp"\s*:\s*"(\d{4}-\d{2}-\d{2}T[\d:.]{1,15}Z)"/g;

/**
 * Characters of overlap carried between chunks so a timestamp straddling a chunk
 * boundary is still matched. Comfortably longer than the longest possible match.
 *
 * The overlap re-scans a few characters, so a timestamp near a boundary can be
 * emitted twice. Harmless: duplicates sort adjacent and contribute a zero gap.
 */
const CHUNK_OVERLAP = 64;

/** Reject instants more than this far after the file's last write. */
const FUTURE_TOLERANCE_MS = 5 * 60_000;

/** Reject instants more than this far before the file's last write. */
const PAST_TOLERANCE_MS = 30 * 24 * 3_600_000;

/**
 * Stream a file and return every plausible `"timestamp"` value in it.
 *
 * Memory is bounded by the stream's chunk size, not the file's length — the
 * whole file is never resident, and nothing but `Date` objects is retained.
 *
 * @param lastWrittenMs - the file's mtime, used as the sanity anchor.
 */
export async function scanTimestamps(
  filePath: string,
  lastWrittenMs: number,
): Promise<Date[]> {
  const reader = Bun.file(filePath).stream().getReader();
  const decoder = new TextDecoder();
  const instants: Date[] = [];

  const earliest = lastWrittenMs - PAST_TOLERANCE_MS;
  const latest = lastWrittenMs + FUTURE_TOLERANCE_MS;

  try {
    let carry = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = carry + decoder.decode(value, { stream: true });
      TIMESTAMP_PATTERN.lastIndex = 0;
      for (const match of text.matchAll(TIMESTAMP_PATTERN)) {
        const parsed = Date.parse(match[1]!);
        if (Number.isNaN(parsed) || parsed < earliest || parsed > latest) continue;
        instants.push(new Date(parsed));
      }

      // `text` goes out of scope here. `carry` keeps only the tail, which is far
      // too short to be a meaningful fragment of anything.
      carry = text.slice(-CHUNK_OVERLAP);
    }
  } finally {
    // Releases the underlying file handle whether or not we finished reading.
    await reader.cancel().catch(() => {});
  }

  return instants;
}

export type ClaudeScanResult = {
  samples: SessionSample[];
  /** Transcript files opened. Diagnostic only. */
  filesScanned: number;
  /** Files skipped as older than the lookback window. Diagnostic only. */
  filesSkippedOld: number;
  /** Files that yielded no usable timestamp. Diagnostic only. */
  filesWithoutTimestamps: number;
};

/**
 * Walk `~/.claude/projects` and produce one `SessionSample` per session file.
 *
 * @param since - only files written at or after this instant are opened. This is
 *   a *superset* filter, not the reporting window: a session that started before
 *   the window but was appended to inside it will be opened, and then discarded
 *   by the day filter in payload.ts. Getting that the wrong way round would emit
 *   a day computed from a partial set of files, and the upsert would overwrite a
 *   complete day with an incomplete one.
 */
export async function scanClaude(
  config: CollectorConfig,
  since: Date,
): Promise<ClaudeScanResult> {
  const root = expandHome(config.claudeProjectsDir);
  const result: ClaudeScanResult = {
    samples: [],
    filesScanned: 0,
    filesSkippedOld: 0,
    filesWithoutTimestamps: 0,
  };

  let projectDirs: string[];
  try {
    projectDirs = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    // No Claude on this machine, or no permission. Not an error: the collector
    // reports whichever agents it can see.
    return result;
  }

  const sinceMs = since.getTime();

  for (const projectDir of projectDirs) {
    // The directory name IS the path token — Claude already encoded it.
    const pathToken = projectDir;
    const projectPath = join(root, projectDir);

    let entries: string[];
    try {
      entries = readdirSync(projectPath, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
        .map((entry) => entry.name);
    } catch {
      continue;
    }

    for (const fileName of entries) {
      const filePath = join(projectPath, fileName);

      let mtimeMs: number;
      try {
        mtimeMs = statSync(filePath).mtimeMs;
      } catch {
        continue;
      }

      if (mtimeMs < sinceMs) {
        result.filesSkippedOld += 1;
        continue;
      }

      result.filesScanned += 1;
      const instants = await scanTimestamps(filePath, mtimeMs);

      if (instants.length === 0) {
        // A transcript with no timestamp is not evidence of a session, and
        // guessing a start from the mtime would put it on the wrong day.
        result.filesWithoutTimestamps += 1;
        continue;
      }

      let earliest = instants[0]!;
      for (const instant of instants) {
        if (instant.getTime() < earliest.getTime()) earliest = instant;
      }

      result.samples.push({
        agent: 'claude',
        startedAt: earliest,
        hours: hoursFromGaps(instants, config),
        pathToken,
      });
    }
  }

  return result;
}
