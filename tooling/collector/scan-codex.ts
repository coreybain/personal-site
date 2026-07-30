/**
 * scan-codex.ts — `~/.codex/sessions` → `SessionSample[]`, reading line 1 only.
 *
 * Layout on disk:
 *
 *   ~/.codex/sessions/2026/07/30/rollout-2026-07-30T05-09-20-<uuid>.jsonl
 *                     ^^^^ ^^ ^^  ^^^^^^^^^^^^^^^^^^^^
 *                     LOCAL date  LOCAL start time
 *
 * Both the directory path and the filename are in **local** time; the
 * `session_meta` record inside is UTC. Verified 2026-07-31 on the real store: a
 * file at `2026/07/30/rollout-2026-07-30T05-09-20-…` carries
 * `"timestamp":"2026-07-29T19:09:21.322Z"` — Sydney, UTC+10. Everything this
 * file emits uses the UTC value; the local directory names are used only to
 * decide which directories to open, with a day of slack on both sides.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THIS STORE IS 5.4 GB ACROSS ~1,600 FILES. LINE 1 ONLY. ALWAYS.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Line 1 is a `session_meta` record:
 *
 *   { "timestamp": "…Z", "type": "session_meta",
 *     "payload": { "session_id", "cwd", "originator", "cli_version",
 *                  "base_instructions": { "text": … }, "dynamic_tools": […] } }
 *
 * Two of those fields are read — `timestamp` and `payload.cwd` — and everything
 * from line 2 onward (every prompt, every reply, every file this agent touched)
 * is never read off the disk at all. Not filtered, not parsed and discarded:
 * never read. `readFirstLine` stops at the first newline and cancels the stream.
 *
 * Line 1 *is* parsed with `JSON.parse`, unlike the Claude scanner. That is the
 * safer choice here, not the looser one: line 1 contains the full system prompt
 * inside `base_instructions.text`, and a regular expression for `"cwd":"…"`
 * would happily match a `cwd` mentioned in that prose. Structural access to
 * `payload.cwd` cannot. The parsed object is destructured in the next statement
 * and never stored.
 *
 * ── Why duration is a span here ─────────────────────────────────────────────
 *
 * The interior timestamps that make the Claude estimator honest are on lines 2+,
 * and reading them would mean reading the transcripts. So: start comes from line
 * 1, end comes from the file's mtime (the last append), and the duration is the
 * span between them capped at `maxSessionHours`. This overstates a session left
 * open. Trading an over-estimate for never touching 5.4 GB of prompts is the
 * right trade, and README.md says so out loud rather than letting the two
 * agents' hours look more comparable than they are.
 */

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { CollectorConfig } from './config';
import { encodePathLikeClaude, expandHome } from './config';
import { hoursFromSpan, type SessionSample } from './sessions';

/**
 * Give up on a first line longer than this many characters.
 *
 * Real ones are tens of kilobytes (a system prompt plus tool schemas). A file
 * whose first line runs past a megabyte is not a `session_meta` record — it is a
 * truncated or newline-free file, and reading further to find out would defeat
 * the point of this module.
 */
const MAX_FIRST_LINE_CHARS = 1_048_576;

/**
 * Read the first line of a file and stop.
 *
 * Pulls chunks from the file stream until a newline appears, then cancels — so
 * a 40 KB first line costs one or two chunk reads regardless of whether the file
 * behind it is 50 KB or 50 MB.
 *
 * @returns the line without its terminator, or `null` if no newline was found
 *   within the cap (in which case nothing further is read).
 */
export async function readFirstLine(filePath: string): Promise<string | null> {
  const reader = Bun.file(filePath).stream().getReader();
  const decoder = new TextDecoder();

  try {
    let buffer = '';
    while (buffer.length < MAX_FIRST_LINE_CHARS) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const newline = buffer.indexOf('\n');
      if (newline !== -1) return buffer.slice(0, newline);
    }
    return null;
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/**
 * Pull the two fields we want out of a `session_meta` line.
 *
 * Returns `null` for anything that is not a well-formed session_meta record —
 * a partially written file, a format change, a different record type on line 1.
 * Silently skipping is correct: one unreadable session is a rounding error, and
 * throwing would take the whole night's run down with it.
 */
export function parseSessionMeta(line: string): { startedAt: Date; cwd: string } | null {
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return null;
  }

  if (typeof record !== 'object' || record === null) return null;
  const { timestamp, type, payload } = record as Record<string, unknown>;

  if (type !== 'session_meta') return null;
  if (typeof payload !== 'object' || payload === null) return null;

  const { cwd } = payload as Record<string, unknown>;
  if (typeof cwd !== 'string' || cwd.length === 0) return null;

  // Prefer the envelope timestamp; fall back to the payload's own, which the
  // real records carry a beat earlier.
  const rawStart =
    typeof timestamp === 'string'
      ? timestamp
      : (payload as Record<string, unknown>).timestamp;
  if (typeof rawStart !== 'string') return null;

  const parsed = Date.parse(rawStart);
  if (Number.isNaN(parsed)) return null;

  // `record` and `payload` fall out of scope here, taking `base_instructions`
  // and every tool schema with them. Only a Date and a path continue.
  return { startedAt: new Date(parsed), cwd };
}

export type CodexScanResult = {
  samples: SessionSample[];
  /** Session files whose first line was read. Diagnostic only. */
  filesScanned: number;
  /** Day directories skipped as outside the window. Diagnostic only. */
  dayDirsSkipped: number;
  /** Files whose line 1 was not a usable `session_meta`. Diagnostic only. */
  filesUnparsed: number;
};

/** `YYYYMMDD` in **local** time — the key Codex's directory tree is sorted by. */
function localDayKey(instant: Date): string {
  const year = instant.getFullYear();
  const month = `${instant.getMonth() + 1}`.padStart(2, '0');
  const day = `${instant.getDate()}`.padStart(2, '0');
  return `${year}${month}${day}`;
}

/** Sorted numeric-looking directory names, e.g. `['01','02',…]`. */
function numericDirs(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Walk `~/.codex/sessions` and produce one `SessionSample` per session file.
 *
 * @param since - the earliest instant the reporting window covers. Day
 *   directories are named in local time while the window is UTC, so the scan
 *   starts a full day earlier than `since` and lets the day filter in payload.ts
 *   discard the overshoot. A day directory is either fully in scope or fully
 *   out, which is what keeps every emitted day a complete recomputation.
 */
export async function scanCodex(
  config: CollectorConfig,
  since: Date,
): Promise<CodexScanResult> {
  const root = expandHome(config.codexSessionsDir);
  const result: CodexScanResult = {
    samples: [],
    filesScanned: 0,
    dayDirsSkipped: 0,
    filesUnparsed: 0,
  };

  // One day of slack for the local/UTC skew, in either direction (a machine in
  // UTC−N writes directories *behind* the UTC day).
  const cutoffKey = localDayKey(new Date(since.getTime() - 24 * 3_600_000));

  for (const year of numericDirs(root)) {
    const yearPath = join(root, year);
    for (const month of numericDirs(yearPath)) {
      const monthPath = join(yearPath, month);
      for (const day of numericDirs(monthPath)) {
        const dayPath = join(monthPath, day);

        // Zero-padding makes the concatenated key lexicographically ordered, so
        // a string compare is a date compare. `2026` `07` `30` → `20260730`.
        if (`${year.padStart(4, '0')}${month.padStart(2, '0')}${day.padStart(2, '0')}` < cutoffKey) {
          result.dayDirsSkipped += 1;
          continue;
        }

        let files: string[];
        try {
          files = readdirSync(dayPath, { withFileTypes: true })
            .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
            .map((entry) => entry.name);
        } catch {
          continue;
        }

        for (const fileName of files) {
          const filePath = join(dayPath, fileName);

          let mtimeMs: number;
          try {
            mtimeMs = statSync(filePath).mtimeMs;
          } catch {
            continue;
          }

          result.filesScanned += 1;
          const line = await readFirstLine(filePath);
          const meta = line === null ? null : parseSessionMeta(line);

          if (meta === null) {
            result.filesUnparsed += 1;
            continue;
          }

          result.samples.push({
            agent: 'codex',
            startedAt: meta.startedAt,
            hours: hoursFromSpan(meta.startedAt, new Date(mtimeMs), config),
            // Encoded into Claude's format so one resolver serves both agents.
            // This is the last point at which a real path exists in this process.
            pathToken: encodePathLikeClaude(meta.cwd),
          });
        }
      }
    }
  }

  return result;
}
