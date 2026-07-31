/**
 * payload.ts — `SessionSample[]` → the body of `POST /ingest/ai-usage`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THIS FILE IS THE PRIVACY BOUNDARY'S SECOND HALF, AND THE LAST ONE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Nothing else in this package constructs an outgoing object. push.ts serialises
 * whatever `buildPayload` returns and sends it; the scanners produce
 * `SessionSample`, which push.ts never sees. So the complete set of values that
 * can reach the network is the set of values this function writes, and that set
 * is:
 *
 *   • `day`            'YYYY-MM-DD'          — derived from a Date
 *   • `agent`          'claude' | 'codex'    — a literal from this file
 *   • `projectSlug`    a slug                — read from collector.config.json
 *   • `sessions`       a non-negative integer
 *   • `hours`          a non-negative number
 *   • `postedAt`       an RFC 3339 instant   — `new Date().toISOString()`
 *   • `machine`        a machine label       — resolved in config.ts
 *
 * `machine` is the one addition to that list since it was first written, and it
 * is the only non-numeric, non-slug, non-date value on the wire. It is a caller-
 * supplied label from `resolveMachineId` — `'laptop'`, `'work-desktop'` — passed
 * in as an option rather than read here, because this file constructs the body
 * and does not decide policy about the machine it runs on. It exists because the
 * server upserts on (`day`, `agent`, `machine`): without it the second computer
 * to post a day overwrote the first. See config.ts's `machineId` and the header
 * of packages/types/src/ingest.ts.
 *
 * `pathToken` is read exactly once, in `resolveSlug(sample.pathToken)`, and its
 * value is never written to an output object. A repo with no mapping resolves to
 * `null` and is counted only in the day's totals, where it exists as an integer.
 *
 * Two independent things enforce that, because a comment enforces nothing:
 *
 *   1. `AiUsageIngestSchema.parse` runs on the result before it is returned. The
 *      schema is a Zod `strictObject` at every level (packages/types/src/ingest.ts),
 *      so an unexpected key is a thrown error rather than a silently stripped
 *      field. A future edit that adds `hostname` or `cwd` fails here, loudly.
 *   2. collector.test.ts walks the serialised JSON and asserts every string in it
 *      is a date, an agent id, or a configured slug — the Verification plan's
 *      "unit-test that the payload contains only numeric aggregates and repo
 *      slugs", executed against the builder rather than against a live run.
 *
 * ── Totals vs. the breakdown ───────────────────────────────────────────────
 *
 * `AiUsageDayIngestSchema` documents that a day's `sessions`/`hours` are NOT
 * required to equal the sum over `projects`, and this is the code that makes
 * that true: an unmapped repo increments the day total and appears in no project
 * entry. The totals are therefore ≥ the breakdown sum, always. The fold reads
 * `snapshot.aiUsage` from the totals and `projects.aiBuildStats` from the
 * breakdown, and must not derive one from the other.
 */

// Relative rather than `@home/types`. tooling/ is not in the root `workspaces`
// globs (see tooling/seed, which imports apps/web the same way), so there is no
// `node_modules/@home/types` symlink to resolve through — and adding one would
// mean touching the root package.json and the shared lockfile for a script that
// needs neither. The path still points at the authoritative Zod contract.
import {
  AiUsageIngestSchema,
  type AiUsageIngest,
} from '../../packages/types/src/ingest';
import { dayOf, roundHours, type Agent, type SessionSample } from './sessions';

/** The wire body. The `AiUsageIngest` contract from @home/types, exactly. */
export type AiUsagePayload = AiUsageIngest;

/**
 * What the dry run prints and the push logs — aggregate counts only.
 *
 * Everything here is a number except `days`, which are dates. There is
 * deliberately no "unmapped repositories" list: naming them is exactly the
 * thing ADR 008 forbids, and the useful part of that information (how much work
 * is going unattributed) is the count.
 */
export type BuildSummary = {
  /** Days in the reporting window, inclusive. */
  windowStart: string;
  windowEnd: string;
  /** Sessions seen per agent, before the window filter. */
  scannedSessions: number;
  /** Sessions dropped for starting outside the window. */
  droppedOutsideWindow: number;
  /** Sessions counted in the totals but attributed to no project. */
  unattributedSessions: number;
  /** Distinct repo directories seen with no mapping. A count, never names. */
  unmappedRepoCount: number;
  /** Day/agent rows in the payload. */
  rows: number;
  totalSessions: number;
  totalHours: number;
  perAgent: Array<{ agent: Agent; sessions: number; hours: number }>;
  perProject: Array<{ projectSlug: string; sessions: number; hours: number }>;
};

/* ------------------------------------------------------------------ *
 * Window
 * ------------------------------------------------------------------ */

/**
 * The inclusive list of UTC days this run reports, oldest first.
 *
 * `lookbackDays` of 7 run on the 31st yields the 25th through the 31st. Today is
 * always included and is always incomplete — it is re-sent tomorrow, and the
 * upsert replaces it.
 */
export function windowDays(now: Date, lookbackDays: number): string[] {
  const days: string[] = [];
  for (let back = lookbackDays - 1; back >= 0; back -= 1) {
    days.push(new Date(now.getTime() - back * 24 * 3_600_000).toISOString().slice(0, 10));
  }
  return days;
}

/**
 * The instant the scanners should start looking from.
 *
 * One day earlier than the window's first day, because a session that *started*
 * on day one may have been written to before it — and because both scanners
 * filter on coarse, local-time signals (file mtime, day directories) that only
 * approximate the UTC boundary. Overshooting is free: `buildPayload` drops
 * anything that starts outside the window, so the extra files scanned cost
 * milliseconds and buy correctness at the edges.
 */
export function scanSince(now: Date, lookbackDays: number): Date {
  const firstDay = windowDays(now, lookbackDays)[0]!;
  return new Date(Date.parse(`${firstDay}T00:00:00.000Z`) - 24 * 3_600_000);
}

/* ------------------------------------------------------------------ *
 * The builder
 * ------------------------------------------------------------------ */

type DayAccumulator = {
  sessions: number;
  hours: number;
  projects: Map<string, { sessions: number; hours: number }>;
};

/**
 * Fold samples into one row per (day, agent), validated against the wire schema.
 *
 * @param samples - every session both scanners found. Order is irrelevant.
 * @param resolveSlug - from `makeSlugResolver`. The only consumer of `pathToken`.
 * @param options.now - the instant this run started; fixes the window and `postedAt`.
 * @param options.machine - this computer's label, from `resolveMachineId`. Sits
 *   on the envelope rather than on each day, because one push comes from one
 *   computer: a body claiming to be two machines at once is not something this
 *   builder could honestly produce, so there is no shape for it. It is not
 *   validated here — `AiUsageIngestSchema` at the bottom of this function is the
 *   gate, and a label that got past config.ts but not past Zod is a bug worth a
 *   throw rather than a quiet repair.
 *
 * @returns `payload: null` when the window contains no sessions at all — the
 *   schema requires `days` to be non-empty, and "nothing happened" is correctly
 *   expressed by not posting rather than by posting a zero. The summary is still
 *   returned so the dry run has something to print.
 */
export function buildPayload(
  samples: readonly SessionSample[],
  resolveSlug: (pathToken: string) => string | null,
  options: { now: Date; lookbackDays: number; machine: string },
): { payload: AiUsagePayload | null; summary: BuildSummary } {
  const days = windowDays(options.now, options.lookbackDays);
  const inWindow = new Set(days);

  /** Keyed `${day}\u0000${agent}` — a separator no slug or date can contain. */
  const rows = new Map<string, DayAccumulator>();

  let droppedOutsideWindow = 0;
  let unattributedSessions = 0;
  const unmappedTokens = new Set<string>();

  for (const sample of samples) {
    const day = dayOf(sample);
    if (!inWindow.has(day)) {
      droppedOutsideWindow += 1;
      continue;
    }

    const key = `${day}\u0000${sample.agent}`;
    let row = rows.get(key);
    if (row === undefined) {
      row = { sessions: 0, hours: 0, projects: new Map() };
      rows.set(key, row);
    }

    // The day's totals count every session, mapped or not. This is the line that
    // makes "totals ≥ breakdown" true.
    row.sessions += 1;
    row.hours += sample.hours;

    // ── The funnel. `pathToken` is read here and nowhere else. ──────────────
    const slug = resolveSlug(sample.pathToken);
    if (slug === null) {
      unattributedSessions += 1;
      // Held in a Set only to count *distinct* unmapped repos for the summary.
      // The Set is local, is never returned, and its members are never printed
      // except by the explicit `--inventory` command.
      unmappedTokens.add(sample.pathToken);
      continue;
    }

    const project = row.projects.get(slug) ?? { sessions: 0, hours: 0 };
    project.sessions += 1;
    project.hours += sample.hours;
    row.projects.set(slug, project);
  }

  const perAgent = new Map<Agent, { sessions: number; hours: number }>();
  const perProject = new Map<string, { sessions: number; hours: number }>();

  const dayRows = [...rows.entries()]
    // Oldest first, as the payload contract asks. Agent breaks the tie so two
    // runs over the same data produce byte-identical bodies.
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, row]) => {
      const [day, agent] = key.split('\u0000') as [string, Agent];

      const projects = [...row.projects.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([projectSlug, stats]) => ({
          projectSlug,
          sessions: stats.sessions,
          hours: roundHours(stats.hours),
        }));

      // Rounding reconciliation. Each project's hours and the day's total are
      // rounded independently, so in principle the rounded parts can sum to a
      // hair more than the rounded total and break the documented `totals ≥
      // breakdown` invariant. Taking the max restores it, and the correction it
      // can ever apply is at most a hundredth of an hour per project.
      const breakdownHours = projects.reduce((sum, project) => sum + project.hours, 0);
      const hours = Math.max(roundHours(row.hours), roundHours(breakdownHours));

      const agentTotals = perAgent.get(agent) ?? { sessions: 0, hours: 0 };
      agentTotals.sessions += row.sessions;
      agentTotals.hours += hours;
      perAgent.set(agent, agentTotals);

      for (const project of projects) {
        const totals = perProject.get(project.projectSlug) ?? { sessions: 0, hours: 0 };
        totals.sessions += project.sessions;
        totals.hours += project.hours;
        perProject.set(project.projectSlug, totals);
      }

      return { day, agent, sessions: row.sessions, hours, projects };
    });

  const summary: BuildSummary = {
    windowStart: days[0]!,
    windowEnd: days[days.length - 1]!,
    scannedSessions: samples.length,
    droppedOutsideWindow,
    unattributedSessions,
    unmappedRepoCount: unmappedTokens.size,
    rows: dayRows.length,
    totalSessions: dayRows.reduce((sum, row) => sum + row.sessions, 0),
    totalHours: roundHours(dayRows.reduce((sum, row) => sum + row.hours, 0)),
    perAgent: [...perAgent.entries()]
      .map(([agent, totals]) => ({ agent, sessions: totals.sessions, hours: roundHours(totals.hours) }))
      .sort((a, b) => b.hours - a.hours),
    perProject: [...perProject.entries()]
      .map(([projectSlug, totals]) => ({
        projectSlug,
        sessions: totals.sessions,
        hours: roundHours(totals.hours),
      }))
      .sort((a, b) => b.hours - a.hours),
  };

  if (dayRows.length === 0) {
    return { payload: null, summary };
  }

  // The gate. Strict at every level — see the file header, point 1. `machine` is
  // checked here too: `MachineLabelSchema` is narrow enough that a hostname, a
  // path or a person's name with spaces throws rather than ships.
  const payload = AiUsageIngestSchema.parse({
    days: dayRows,
    machine: options.machine,
    postedAt: options.now.toISOString(),
  });

  return { payload, summary };
}
