/**
 * sessions.ts — what a "session" is reduced to, and the two estimators that
 * turn a pile of timestamps into hours.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  `SessionSample` IS THE ONLY THING THE SCANNERS ARE ALLOWED TO PRODUCE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Four fields, three of them numbers or enums. There is no field on this type
 * that can carry a prompt, a diff, a filename or a message — not because the
 * scanners are careful, but because the type has nowhere to put one. The single
 * string field, `pathToken`, is local-only and is consumed by `resolveSlug`
 * before the payload is built; see payload.ts, which never sees this type's
 * `pathToken` reach an output object.
 *
 * That is the shape of the privacy argument throughout this package: make the
 * unsafe thing unrepresentable a step earlier than the place it would leak.
 */

import type { CollectorConfig } from './config';

/** The two agents this machine runs. Mirrors `AiAgentSchema` in @home/types. */
export type Agent = 'claude' | 'codex';

/**
 * One agent session, reduced to the only facts that matter downstream.
 *
 * A "session" is one transcript file: one `~/.claude/projects/<project>/<id>.jsonl`,
 * or one `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`. That is the unit both
 * agents already use, and it is the unit the homepage Signal counts.
 */
export type SessionSample = {
  agent: Agent;
  /** UTC instant the session's first recorded event happened. */
  startedAt: Date;
  /** Estimated wall-clock hours. Fractional, never negative. An estimate. */
  hours: number;
  /**
   * Path-encoded location of the work — `-Users-…-GitHub-<repo>…`.
   *
   * **Local only. Never serialised, never transmitted, never logged outside
   * `--inventory`.** It exists so `makeSlugResolver` can turn it into a slug,
   * and it is dropped in the same expression that does so.
   */
  pathToken: string;
};

/* ------------------------------------------------------------------ *
 * Duration estimation
 * ------------------------------------------------------------------ */

const MS_PER_HOUR = 3_600_000;

/** Two decimal places. Enough for an hours figure; short in a JSON body. */
export function roundHours(hours: number): number {
  return Math.round(hours * 100) / 100;
}

/**
 * Sum the gaps between consecutive events, capping each at the idle threshold.
 *
 * Used for Claude, where every event in the transcript carries a timestamp so
 * the shape of the working session is actually visible. A 4-hour transcript with
 * a 3-hour lunch in the middle reports ~1 hour of work plus one capped gap,
 * rather than 4.
 *
 * A session with a single event reports 0 hours. It still counts as a session —
 * it happened — but there is no elapsed time to claim, and inventing a nominal
 * minute would be inventing data.
 *
 * @param instants - event times in any order; sorted here.
 * @returns hours, clamped to `maxSessionHours`.
 */
export function hoursFromGaps(
  instants: readonly Date[],
  config: Pick<CollectorConfig, 'idleGapMinutes' | 'maxSessionHours'>,
): number {
  if (instants.length < 2) return 0;

  const sorted = [...instants].sort((a, b) => a.getTime() - b.getTime());
  const capMs = config.idleGapMinutes * 60_000;

  let totalMs = 0;
  for (let index = 1; index < sorted.length; index += 1) {
    const gap = sorted[index]!.getTime() - sorted[index - 1]!.getTime();
    // Negative gaps cannot happen after the sort; a zero gap contributes zero.
    totalMs += Math.min(gap, capMs);
  }

  return roundHours(Math.min(totalMs / MS_PER_HOUR, config.maxSessionHours));
}

/**
 * First-to-last span, capped.
 *
 * Used for Codex, where the only two instants available without reading the
 * whole file are the `session_meta` timestamp on line 1 and the file's mtime.
 * See scan-codex.ts for why reading more than line 1 is off the table.
 *
 * This **overstates** an interrupted session — a Codex session left open over
 * lunch bills the lunch, up to `maxSessionHours`. That asymmetry with the Claude
 * estimator is real and is stated in README.md rather than hidden behind a
 * fudge factor, because the honest description of this number is "how long the
 * session was open", not "how long it was worked".
 */
export function hoursFromSpan(
  startedAt: Date,
  endedAt: Date,
  config: Pick<CollectorConfig, 'maxSessionHours'>,
): number {
  const spanMs = endedAt.getTime() - startedAt.getTime();
  if (!Number.isFinite(spanMs) || spanMs <= 0) return 0;
  return roundHours(Math.min(spanMs / MS_PER_HOUR, config.maxSessionHours));
}

/* ------------------------------------------------------------------ *
 * Days
 * ------------------------------------------------------------------ */

/**
 * The UTC calendar day an instant falls in, `YYYY-MM-DD`.
 *
 * UTC, not local, because `aiUsageDays.day` is documented as UTC and the fold,
 * the Snapshot and the phone all agree on that. A session started at 9am Sydney
 * time lands on the previous UTC day; that is the model working as specified,
 * not a bug, and it is consistent for every row.
 */
export function utcDay(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

/**
 * A session is attributed **entirely to the UTC day it started on**, both its
 * count and its hours — including a session that ran across midnight.
 *
 * The alternative, splitting hours at the day boundary, is only possible for
 * Claude (Codex has no interior timestamps to split on) and would make the two
 * agents' numbers mean different things. One rule, applied to both, stated
 * here so the fold and the homepage can rely on it: `sessions` is "sessions
 * *started* that day".
 */
export function dayOf(sample: SessionSample): string {
  return utcDay(sample.startedAt);
}
