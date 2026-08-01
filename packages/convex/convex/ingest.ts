/**
 * ingest.ts — the machine-push write path: body parsing, upserts, and the
 * derived writes an ingest triggers.
 *
 * This file is the *inside* of the two HTTP routes in http.ts. It holds two
 * kinds of thing, and the split is the point of the file:
 *
 *   1. **Pure parsers** (`parseAiUsageBody`, `parseHealthBody`) — plain
 *      functions, no Convex context, no database. http.ts runs them inside the
 *      `httpAction` on the raw decoded JSON, *before* any mutation is called, so
 *      that a malformed body is a `400` returned by the route rather than an
 *      uncaught `ArgumentValidationError` surfacing as a `500`.
 *   2. **Internal mutations** (`recordAiUsage`, `recordHealth`) — the actual
 *      writes. `internalMutation`, so they are absent from the public API and
 *      unreachable from a browser, the iOS client or a `ConvexHttpClient`. The
 *      only door into them is an authenticated route in http.ts.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE PARSERS REJECT UNKNOWN KEYS. THAT IS A PRIVACY MECHANISM, NOT TIDINESS.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `AiUsageIngestSchema` in `@home/types` is a Zod `strictObject`, and the reason
 * is set out in that file and in schema.ts: the Collector reads `~/.claude` and
 * `~/.codex`, which contain prompts, diffs, file contents and absolute paths.
 * Only counts, durations and project slugs may leave the machine (ADR 008 —
 * a repo directory name IS a private repo name).
 *
 * A tolerant parser that silently ignores an unexpected `prompt` or `cwd` key
 * would make a Collector regression invisible: the push would 200, the field
 * would vanish, and nobody would find out. `rejectUnknownKeys` below turns that
 * same regression into a `400` with the offending key named in the response, on
 * the first run, on the machine that produced it. The schema gives such a field
 * nowhere to land; this gives it nowhere to arrive.
 *
 * The Verification plan's assertion — "the payload contains only numeric
 * aggregates and repo slugs" — is checkable precisely because the parsers below
 * are pure functions over `unknown`. Point a unit test at them; no deployment,
 * no token, no network.
 *
 * ── Why parsers return a result instead of throwing ────────────────────────
 *
 * The rest of this package signals bad input with `invalid()` from
 * lib/validate.ts, which throws a `ConvexError`. That is right for a mutation
 * called by the admin UI, where the Convex client rehydrates `error.data` and a
 * form field lights up. It is wrong here: the caller is an `httpAction` that has
 * to *choose a status code*, and `try`/`catch` around a parse in order to
 * produce a `400` is a control-flow inversion that hides the one branch a
 * reviewer cares about. So the parsers return
 * `{ ok: false, problem: { field, message } }` and http.ts maps it to a body.
 *
 * The mutations further down still use `invalid()`, because by then the input
 * has been parsed and anything left is a genuine server-side precondition.
 *
 * ── Upsert semantics, stated once ─────────────────────────────────────────
 *
 * Both tables are keyed on the day (`aiUsageDays` on `(day, agent, machine)`,
 * `healthDays` on `day`) and both mutations **patch an existing row rather than
 * inserting a second one**. This is load-bearing: the Collector re-scans a
 * trailing window on every run and the phone re-posts today's steps whenever
 * HealthKit revises them, so *every* push after the first is mostly a push of
 * days already stored. Insert-only would double every figure on the dashboard
 * within a day of the pipeline going live.
 *
 * Re-posting a day therefore *replaces* it. The newer number wins; there is no
 * merge, no max, no sum. The producer owns the day and knows the truth about it.
 *
 * ── …and the third of the AI key that says WHICH producer ─────────────────
 *
 * "The producer owns the day" is only a coherent sentence once the row records
 * which producer. The Collector runs on more than one computer, and keyed
 * `(day, agent)` the second machine to post a day did not add to the first —
 * it *replaced* it, silently, with this mutation returning `daysUpdated: 1` as
 * though that were the correct outcome. A laptop and a desktop both working on
 * the 30th produced one row containing whichever of them ran last.
 *
 * `machine` (from the push envelope: one push, one computer) is the third of the
 * key. Each machine owns its own claim about a day; a re-push replaces that
 * claim and touches nothing else; N machines are additive. Health needs no
 * equivalent because a day has exactly one step count, and a `manual` correction
 * is *meant* to overwrite the watch.
 *
 * Two consequences, both live in this file:
 *
 *   1. **A `(day, agent)` lookup is now a collection, not a `.unique()`.** The
 *      upsert below reads the full triple. Anything that reads two-thirds of the
 *      key gets one row per machine and must sum them.
 *   2. **`machine` is required on the body.** A push without it is a `400` with
 *      the reason spelled out, not a default. A collector too old to send the
 *      field is a collector that will silently clobber another machine's rows,
 *      so it has to fail where somebody will see it — see `parseMachineLabel`.
 */

import type { FunctionReference } from 'convex/server';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import type { RebuildSummary } from './gitStats';
import { internalMutation, type MutationCtx } from './_generated/server';
import { DAY_MS, isoDay } from './lib/days';
import { invalid } from './lib/validate';
import { aiAgent, healthSource } from './schema';

/* ------------------------------------------------------------------ *
 * The snapshot fold seam
 * ------------------------------------------------------------------ */

/**
 * The internal function an AI-usage ingest asks to re-run.
 *
 * **INTEGRATION SEAM — now resolved by the compiler.**
 *
 * This was a string (`'gitStats:rebuild'`) resolved at call time with
 * `makeFunctionReference`, because `convex/gitStats.ts` and
 * `convex/snapshotBuild.ts` were being written in parallel with this file and
 * neither could be named through the generated `internal.*` tree without
 * breaking the build of whichever module landed first. Both exist now, so the
 * reference is the real one: the module, the export, the function *kind*
 * (`internalAction` — it calls `fetch`) and the argument shape are all checked
 * by `tsc`, and renaming or deleting `rebuild` is now a failed build rather
 * than a silent `'unavailable'` at run time.
 *
 * It stays a named constant, and http.ts still schedules it inside a
 * `try`/`catch`: the catch covers a *runtime* scheduling failure, which is a
 * different failure from the one the compiler now rules out. See
 * `requestSnapshotRefold` in http.ts for why that catch is load-bearing.
 *
 * ── Why `gitStats:rebuild` and not `snapshotBuild:apply` ──────────────────
 *
 * The Snapshot is written by `snapshotBuild.apply`, but that is an
 * `internalMutation` taking `{ gitStats, labStats }` — a mutation cannot
 * `fetch`, so the GitHub half must be handed to it. The only **zero-argument**
 * entry point that produces a whole, self-consistent Snapshot is
 * `gitStats.rebuild`, the `internalAction` the hourly cron calls: it reads the
 * curated Lab list, fetches GitHub, and hands both to `apply`, which folds
 * `aiUsageDays` and `healthDays` on the way through.
 *
 * The cost of going in by that door is one GitHub GraphQL call per AI-usage
 * push. That is accepted rather than worked around: the Collector runs daily
 * under launchd, so it is one extra call a day against a 5,000-point hourly
 * budget, and the alternative — a partial refold that rewrites `aiUsage` while
 * leaving the calendar from the previous hour — would write a Snapshot whose
 * `computedAt` no longer describes all of it. ADR 004's row is one document
 * precisely so that everything in it is true at the same instant.
 *
 * Requirements this file relies on, all satisfied by `gitStats.rebuild` today:
 *
 *   • **No arguments.** The fold is a full read of both raw tables (~730
 *     rows/year — see schema.ts), not a delta applied to a hint, so there is
 *     nothing useful to pass and a stale hint would be worse than none.
 *   • **Idempotent.** It is scheduled once per ingest *and* hourly, so it must
 *     be safe to run twice a second apart.
 *   • **Fails closed.** A GitHub error must leave the previous Snapshot intact
 *     rather than write a half-built one; `rebuild` does the fetch before the
 *     mutation for exactly that reason.
 *   • It must **not** derive `snapshot.aiUsage` from the per-project breakdown,
 *     or vice versa. Agent/day totals are ≥ the sum over `projects[]`, always: a
 *     session in an unmapped directory is real activity with nowhere to land in
 *     the breakdown. Totals feed the Signal; the breakdown feeds
 *     `projects.aiBuildStats` (ADR 016), which `recordAiUsage` below writes
 *     directly and immediately.
 *
 * If a cheaper zero-argument refold is ever added, change this one line.
 *
 * ── Why the type annotation is written out ────────────────────────────────
 *
 * Without it, `tsc` reports TS7022: this constant is inferred from `internal`,
 * the generated tree covers *every* module including this one, and so the
 * constant ends up referenced in its own initialiser. Naming the type breaks
 * that cycle, and it is not a weakening — the annotation still pins the
 * function kind, the visibility, the empty argument shape and the return type,
 * so pointing this at a mutation, a public function, or something that takes
 * arguments all remain build failures.
 */
export const SNAPSHOT_REFOLD_FUNCTION: FunctionReference<
  'action',
  'internal',
  Record<string, never>,
  RebuildSummary
> = internal.gitStats.rebuild;

/* ------------------------------------------------------------------ *
 * Bounds
 *
 * Every number below is a sanity bound, not a business rule. Their job
 * is to keep one broken producer from writing a figure the dashboard
 * renders as fact, and to keep one push inside a Convex transaction.
 * ------------------------------------------------------------------ */

/**
 * Days accepted in a single push: one year × two agents, plus slack.
 *
 * Sized for the one push that is genuinely large — the Collector's *first* run,
 * which backfills every day it can find in `~/.claude` and `~/.codex` at once.
 * Steady state is a handful of days per run.
 *
 * It is a bound rather than an absence of one because each day costs an index
 * probe plus a write inside a single Convex transaction, and a producer that
 * loops forever must be refused rather than left to hit the platform's own
 * limits, where the failure is opaque. A larger backfill is chunked by the
 * producer; the routes are idempotent, so chunks may overlap freely.
 */
const MAX_DAYS_PER_PUSH = 750;

/** Per-project rows inside one agent-day. Generous; a real day has under ten. */
const MAX_PROJECTS_PER_DAY = 200;

/** Agent sessions started in one day by one agent. */
const MAX_SESSIONS_PER_DAY = 10_000;

/**
 * Wall-clock agent hours in one day.
 *
 * Deliberately more than 24. `hours` is summed across sessions and sessions
 * overlap — two agents in two terminals for an afternoon is four wall-clock
 * hours by this measure and two by the clock on the wall. 200 says "a bug",
 * 30 would say "a Tuesday".
 */
const MAX_HOURS_PER_DAY = 200;

/** Steps in a day. The world record for a 24-hour walk is under 200,000. */
const MAX_STEPS_PER_DAY = 500_000;

/** Kilometres in a day. */
const MAX_DISTANCE_KM_PER_DAY = 1_000;

/** More than this many completed workouts in one calendar day is malformed. */
const MAX_HEALTH_ACTIVITIES_PER_DAY = 100;

/** A workout may span midnight, but two full days is beyond a useful session. */
const MAX_WORKOUT_MINUTES = 2_880;

/**
 * Earliest calendar day either pipeline may report.
 *
 * Both producers are recent — HealthKit from a phone set up this decade, agent
 * sessions from tools that did not exist before 2024. A day before this is a
 * date-parsing bug (an epoch-zero default, a two-digit year), and it would sort
 * to the front of every index that reads the table.
 */
const EARLIEST_DAY = '2015-01-01';

/** Latest calendar day. Guards a timestamp that got multiplied by 1000. */
const LATEST_DAY = '2100-01-01';

/* ------------------------------------------------------------------ *
 * Closed unions, kept honest against the schema
 *
 * The parsers run outside Convex's argument validation, so they need a
 * *runtime* list of the accepted values — which `aiAgent` and
 * `healthSource` in schema.ts, being validators, do not provide. The
 * lists are therefore restated here, and then wired back to the
 * generated data model so a value added to the schema and forgotten
 * here is a `tsc --noEmit` failure rather than a 400 in production.
 * ------------------------------------------------------------------ */

/** `'claude' | 'codex'`, read off the table the parser writes into. */
type AiAgentId = Doc<'aiUsageDays'>['agent'];

/** `'healthkit' | 'manual'`, likewise. */
type HealthSourceId = Doc<'healthDays'>['source'];
type HealthActivityInput = NonNullable<Doc<'healthDays'>['activities']>[number];
type HealthActivityKindId = HealthActivityInput['kind'];

const AI_AGENTS = ['claude', 'codex'] as const satisfies readonly AiAgentId[];
const HEALTH_SOURCES = [
  'healthkit',
  'manual',
] as const satisfies readonly HealthSourceId[];
const HEALTH_ACTIVITY_KINDS = [
  'walking',
  'running',
  'cycling',
  'gym',
  'other',
] as const satisfies readonly HealthActivityKindId[];

/**
 * Compile-time exhaustiveness.
 *
 * `satisfies` above proves every listed value is valid; these prove every valid
 * value is listed. Add `'gemini'` to `aiAgent` in schema.ts without adding it
 * here and `Exclude<…>` stops being `never`, the assignment stops type-checking,
 * and this package fails `bun run typecheck` — which is the only moment anyone
 * would notice, because the symptom in production is a push that 400s.
 */
type Unlisted<Union, Listed> = Exclude<Union, Listed> extends never ? true : false;
const _aiAgentsAreExhaustive: Unlisted<AiAgentId, (typeof AI_AGENTS)[number]> = true;
const _healthSourcesAreExhaustive: Unlisted<
  HealthSourceId,
  (typeof HEALTH_SOURCES)[number]
> = true;
const _healthActivityKindsAreExhaustive: Unlisted<
  HealthActivityKindId,
  (typeof HEALTH_ACTIVITY_KINDS)[number]
> = true;
void _aiAgentsAreExhaustive;
void _healthSourcesAreExhaustive;
void _healthActivityKindsAreExhaustive;

/* ------------------------------------------------------------------ *
 * Parse results
 * ------------------------------------------------------------------ */

/**
 * Why a body was refused.
 *
 * `field` is a JSON path into the payload (`days[3].projects[0].hours`) rather
 * than a bare field name, because the producer is a script and the person
 * reading this is looking at a 700-element array in a launchd log at some point
 * in the future. Naming the element is the difference between a fix and a
 * bisect.
 */
export type IngestProblem = {
  field: string;
  message: string;
};

/** Discriminated parse outcome. See the file header for why this is not a throw. */
export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; problem: IngestProblem };

const fail = (field: string, message: string): { ok: false; problem: IngestProblem } => ({
  ok: false,
  problem: { field, message },
});

/* ------------------------------------------------------------------ *
 * Primitive parsers
 * ------------------------------------------------------------------ */

/** A JSON object, and specifically not an array and not `null`. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The strict-object check. **Read the file header before relaxing this.**
 *
 * Returns the first unexpected key rather than collecting all of them: the
 * producer fixes one bug at a time, and the first name is enough to find it.
 */
function rejectUnknownKeys(
  object: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): IngestProblem | null {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) {
      return {
        field: path === '' ? key : `${path}.${key}`,
        message: `Unexpected key ${JSON.stringify(key)}. This endpoint accepts only aggregates; see the privacy note in convex/ingest.ts.`,
      };
    }
  }
  return null;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `YYYY-MM-DD`, and a real day.
 *
 * The regex alone accepts `2026-02-31`. The round-trip through `Date` rejects
 * it: JavaScript normalises out-of-range components (Feb 31 → Mar 3), so a date
 * that does not re-serialise to what was sent did not exist. That matters here
 * because `day` is a primary key — a normalising parser would quietly file
 * February's data under March and no read would ever notice.
 */
function parseIsoDate(value: unknown, field: string): ParseResult<string> {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) {
    return fail(field, `Expected a 'YYYY-MM-DD' calendar date, got ${describe(value)}.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return fail(field, `${JSON.stringify(value)} is not a real calendar date.`);
  }
  if (value < EARLIEST_DAY || value > LATEST_DAY) {
    return fail(
      field,
      `Day ${value} is outside the accepted range ${EARLIEST_DAY}…${LATEST_DAY}.`,
    );
  }
  return { ok: true, value };
}

/**
 * An RFC 3339 instant, normalised to the `…Z` form the schema stores.
 *
 * Normalisation rather than pass-through, because the fixed-width-sorts-
 * chronologically property that schema.ts's header depends on holds only for
 * the `Z` form: `'2026-07-31T12:00:00+10:00'` is a valid instant and sorts
 * nowhere near where it belongs. The producers are a Bun script and Swift's
 * `ISO8601DateFormatter`, either of which can be talked into an offset.
 */
function parseIsoDateTime(value: unknown, field: string): ParseResult<string> {
  if (typeof value !== 'string' || value.length === 0 || value.length > 40) {
    return fail(field, `Expected an RFC 3339 timestamp, got ${describe(value)}.`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return fail(field, `${JSON.stringify(value)} is not a parseable timestamp.`);
  }
  // Bare `'2026-07-31'` parses as UTC midnight, which is a date and not the
  // instant this field means. Require a time component.
  if (!value.includes('T')) {
    return fail(field, `Expected a full timestamp with a time component, got ${JSON.stringify(value)}.`);
  }
  return { ok: true, value: parsed.toISOString() };
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * A project slug. Mirrors `assertSlug` in lib/validate.ts and `SlugSchema`.
 *
 * Restated rather than imported because `assertSlug` throws and this layer
 * returns — but the pattern and the 96-character bound are the same, and must
 * stay the same: this value joins to `projects.slug`.
 *
 * ADR 008, again, because this is the field it is about: a slug is what the
 * Collector produced by *mapping* a repo directory to a configured project. A
 * directory name that had no mapping is dropped on the machine and never
 * becomes a slug. The pattern below would happily accept one, so it is not the
 * enforcement — the Collector is. This just refuses the shapes a path takes
 * (`/`, `.`, `_`, capitals) so a mapping bug cannot arrive looking plausible.
 */
function parseSlug(value: unknown, field: string): ParseResult<string> {
  if (typeof value !== 'string' || value.length < 1 || value.length > 96) {
    return fail(field, `Expected a project slug of 1–96 characters, got ${describe(value)}.`);
  }
  if (!SLUG_PATTERN.test(value)) {
    return fail(
      field,
      `Expected a lowercase kebab-case project slug, got ${JSON.stringify(value)}. Paths and repo names are not slugs — map them on the machine (ADR 008).`,
    );
  }
  return { ok: true, value };
}

const MACHINE_LABEL_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** `MachineLabelSchema`'s ceiling, restated. */
const MAX_MACHINE_LABEL_LENGTH = 32;

/**
 * Which computer this push is speaking for. Mirrors `MachineLabelSchema`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  REQUIRED. AN OLD COLLECTOR MUST FAIL HERE RATHER THAN CLOBBER SILENTLY.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This is a **breaking change to the wire format**, and it is breaking on
 * purpose. A collector built before `machine` existed sends a body that is
 * perfectly well-formed by the old contract and catastrophic under the new one:
 * its rows would need a label to be keyed by, and any label this endpoint
 * invented for it — `'unknown'`, `'default'`, `''` — would be *shared* with
 * every other machine that also forgot, putting them back in the same bucket,
 * overwriting each other, exactly as before. The failure would be invisible: a
 * `200`, a plausible `daysUpdated`, and a number on the homepage quietly missing
 * whatever the other computer did.
 *
 * So there is no default and no fallback. The message below names the field, the
 * shape, and the reason, because the reader is a launchd log at 09:20 on a
 * machine nobody is watching. Fix: upgrade the collector, or set `machineId`.
 *
 * ── Why the shape is this narrow ──────────────────────────────────────────
 *
 * Lowercase alphanumerics and hyphens, 1–32 characters. The narrowness is the
 * privacy control (see the header of `@home/types`/ingest.ts): the field's job
 * is to make two rows distinct, and an operator-chosen `'laptop'` does that as
 * well as anything. `Corey's MacBook Pro.local` and `/Users/coreybaines` do not
 * match this pattern, so an accidental `os.hostname()` or a path pasted into a
 * config is a `400` rather than a stored fact about somebody's living room.
 *
 * Uppercase is rejected rather than lowercased for the same reason `parseIsoDate`
 * refuses to normalise February 31st: this value is part of a key. `Laptop` and
 * `laptop` silently becoming one row is a merge nobody asked for, and silently
 * staying two is a split; refusing the input is the only answer that cannot be
 * wrong later.
 */
function parseMachineLabel(value: unknown, field: string): ParseResult<string> {
  if (value === undefined) {
    return fail(
      field,
      "Missing 'machine'. Every AI-usage push must say which computer produced it" +
        ' — it is part of the (day, agent, machine) upsert key, and without it one' +
        " machine's rows overwrite another's. Upgrade tooling/collector, or set" +
        ' `machineId` in collector.config.json (e.g. "laptop").',
    );
  }
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > MAX_MACHINE_LABEL_LENGTH
  ) {
    return fail(
      field,
      `Expected a machine label of 1–${MAX_MACHINE_LABEL_LENGTH} characters, got ${describe(value)}.`,
    );
  }
  if (!MACHINE_LABEL_PATTERN.test(value)) {
    return fail(
      field,
      `Expected a short lowercase machine label such as "laptop" or "work-desktop", got ${JSON.stringify(value)}. Hostnames, paths and capitals are refused deliberately — this label is stored and is part of the upsert key.`,
    );
  }
  return { ok: true, value };
}

/** A non-negative integer count, bounded. */
function parseCount(value: unknown, field: string, max: number): ParseResult<number> {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fail(field, `Expected a number, got ${describe(value)}.`);
  }
  if (!Number.isInteger(value)) {
    return fail(field, `Expected a whole number, got ${value}.`);
  }
  if (value < 0 || value > max) {
    return fail(field, `Expected a count between 0 and ${max}, got ${value}.`);
  }
  return { ok: true, value };
}

/** A non-negative fractional quantity (hours, kilometres), bounded. */
function parseAmount(value: unknown, field: string, max: number): ParseResult<number> {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fail(field, `Expected a number, got ${describe(value)}.`);
  }
  if (value < 0 || value > max) {
    return fail(field, `Expected a value between 0 and ${max}, got ${value}.`);
  }
  return { ok: true, value };
}

/**
 * A short, safe rendering of a rejected value for the error message.
 *
 * Types and lengths only — never the value itself once it is a string of any
 * size. A parser that echoes what it refused is a parser that writes rejected
 * prompt text into the deployment's logs, which is exactly the class of leak
 * this file exists to prevent. Short strings are echoed because
 * `'sesions'`-vs-`'sessions'` is unfixable without them.
 */
function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `an array of ${value.length}`;
  if (typeof value === 'string') {
    return value.length <= 32 ? JSON.stringify(value) : `a string of ${value.length} characters`;
  }
  if (typeof value === 'object') return 'an object';
  return typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : typeof value;
}

/* ------------------------------------------------------------------ *
 * Payload parsers
 * ------------------------------------------------------------------ */

/** One project's slice of one agent-day, as parsed. Mirrors `AiUsageProjectSchema`. */
export type AiUsageProjectInput = {
  projectSlug: string;
  sessions: number;
  hours: number;
};

/** One agent-day, as parsed. Mirrors `AiUsageDayIngestSchema`. */
export type AiUsageDayInput = {
  day: string;
  agent: AiAgentId;
  sessions: number;
  hours: number;
  projects: AiUsageProjectInput[];
};

/** The whole `POST /ingest/ai-usage` body. Mirrors `AiUsageIngestSchema`. */
export type AiUsageIngestInput = {
  days: AiUsageDayInput[];
  /**
   * Which computer produced these numbers. On the envelope, not per day: one
   * push comes from one machine, and a body claiming to be two at once is not
   * something any honest producer could build.
   */
  machine: string;
  postedAt: string;
};

const AI_USAGE_BODY_KEYS = ['days', 'machine', 'postedAt'] as const;
const AI_USAGE_DAY_KEYS = ['day', 'agent', 'sessions', 'hours', 'projects'] as const;
const AI_USAGE_PROJECT_KEYS = ['projectSlug', 'sessions', 'hours'] as const;

/**
 * Parse a decoded `POST /ingest/ai-usage` body.
 *
 * Pure. Takes the output of `JSON.parse` and returns either the exact argument
 * object `recordAiUsage` takes, or the first problem found. No context, no
 * database, no clock — point a unit test straight at it (Verification:
 * "Collector privacy: unit-test that the payload contains only numeric
 * aggregates and repo slugs").
 *
 * Two whole-payload invariants are checked here rather than in the mutation,
 * because both are *malformed input* (a `400`) and not a server condition:
 *
 *   • `days` is non-empty. `AiUsageIngestSchema` says `.nonempty()`. An empty
 *     push is a Collector that found nothing and posted anyway; answering `200`
 *     to it would report success for a run that did not happen.
 *   • No `(day, agent)` appears twice, and no `projectSlug` twice within a day.
 *     The mutation reads its own writes, so a duplicate would silently mean
 *     "last one wins" — a lossy answer to what is unambiguously a producer bug.
 *     Note this stays `(day, agent)` and not the full key: `machine` is fixed
 *     for the whole body, so within one push the pair *is* the key.
 *   • `machine` is present and is a label. See `parseMachineLabel` for why a
 *     missing one is a `400` rather than a default — it is the one change here
 *     that will break an existing producer, and it has to.
 */
export function parseAiUsageBody(raw: unknown): ParseResult<AiUsageIngestInput> {
  if (!isPlainObject(raw)) {
    return fail('', `Expected a JSON object body, got ${describe(raw)}.`);
  }

  const unknownKey = rejectUnknownKeys(raw, AI_USAGE_BODY_KEYS, '');
  if (unknownKey !== null) return { ok: false, problem: unknownKey };

  // Checked before `days`, deliberately. An old collector's body is otherwise
  // entirely valid, and reporting "machine is missing" beats letting it get as
  // far as a per-day error that says nothing about the real problem.
  const machine = parseMachineLabel(raw.machine, 'machine');
  if (!machine.ok) return machine;

  const postedAt = parseIsoDateTime(raw.postedAt, 'postedAt');
  if (!postedAt.ok) return postedAt;

  if (!Array.isArray(raw.days)) {
    return fail('days', `Expected an array of day summaries, got ${describe(raw.days)}.`);
  }
  if (raw.days.length === 0) {
    return fail('days', 'At least one day is required; an empty push is a no-op, not a success.');
  }
  if (raw.days.length > MAX_DAYS_PER_PUSH) {
    return fail(
      'days',
      `At most ${MAX_DAYS_PER_PUSH} days per push (got ${raw.days.length}). Chunk the backfill — the route is idempotent, so chunks may overlap.`,
    );
  }

  // The last day this push may legitimately describe. Compared against the
  // payload's own `postedAt` rather than the server clock, so the check stays
  // pure — and so it catches the failure it is actually for: a Collector that
  // formatted a local-midnight `Date` as UTC and produced tomorrow.
  const latestPlausibleDay = new Date(new Date(postedAt.value).getTime() + 86_400_000)
    .toISOString()
    .slice(0, 10);

  const days: AiUsageDayInput[] = [];
  const seenDayAgents = new Set<string>();

  for (const [index, entry] of raw.days.entries()) {
    const at = `days[${index}]`;

    if (!isPlainObject(entry)) {
      return fail(at, `Expected an object, got ${describe(entry)}.`);
    }
    const strayDayKey = rejectUnknownKeys(entry, AI_USAGE_DAY_KEYS, at);
    if (strayDayKey !== null) return { ok: false, problem: strayDayKey };

    const day = parseIsoDate(entry.day, `${at}.day`);
    if (!day.ok) return day;
    if (day.value > latestPlausibleDay) {
      return fail(
        `${at}.day`,
        `Day ${day.value} is after the push's own postedAt (${postedAt.value}). Check the Collector's timezone handling.`,
      );
    }

    if (typeof entry.agent !== 'string' || !(AI_AGENTS as readonly string[]).includes(entry.agent)) {
      return fail(
        `${at}.agent`,
        `Expected one of ${AI_AGENTS.join(' | ')}, got ${describe(entry.agent)}.`,
      );
    }
    const agent = entry.agent as AiAgentId;

    const key = `${day.value}\u0000${agent}`;
    if (seenDayAgents.has(key)) {
      return fail(
        `${at}.day`,
        `Duplicate (day, agent) pair ${day.value}/${agent} in one push from machine ${machine.value}. Aggregate before posting; the route replaces this machine's row for that day rather than adding to it.`,
      );
    }
    seenDayAgents.add(key);

    const sessions = parseCount(entry.sessions, `${at}.sessions`, MAX_SESSIONS_PER_DAY);
    if (!sessions.ok) return sessions;

    const hours = parseAmount(entry.hours, `${at}.hours`, MAX_HOURS_PER_DAY);
    if (!hours.ok) return hours;

    if (!Array.isArray(entry.projects)) {
      return fail(
        `${at}.projects`,
        `Expected an array (send [] when nothing mapped), got ${describe(entry.projects)}.`,
      );
    }
    if (entry.projects.length > MAX_PROJECTS_PER_DAY) {
      return fail(
        `${at}.projects`,
        `At most ${MAX_PROJECTS_PER_DAY} projects in one day (got ${entry.projects.length}).`,
      );
    }

    const projects: AiUsageProjectInput[] = [];
    const seenSlugs = new Set<string>();

    for (const [projectIndex, project] of entry.projects.entries()) {
      const atProject = `${at}.projects[${projectIndex}]`;

      if (!isPlainObject(project)) {
        return fail(atProject, `Expected an object, got ${describe(project)}.`);
      }
      const strayProjectKey = rejectUnknownKeys(project, AI_USAGE_PROJECT_KEYS, atProject);
      if (strayProjectKey !== null) return { ok: false, problem: strayProjectKey };

      const projectSlug = parseSlug(project.projectSlug, `${atProject}.projectSlug`);
      if (!projectSlug.ok) return projectSlug;

      if (seenSlugs.has(projectSlug.value)) {
        return fail(
          `${atProject}.projectSlug`,
          `Duplicate project ${projectSlug.value} within ${day.value}/${agent}. Sum it on the machine.`,
        );
      }
      seenSlugs.add(projectSlug.value);

      const projectSessions = parseCount(
        project.sessions,
        `${atProject}.sessions`,
        MAX_SESSIONS_PER_DAY,
      );
      if (!projectSessions.ok) return projectSessions;

      const projectHours = parseAmount(project.hours, `${atProject}.hours`, MAX_HOURS_PER_DAY);
      if (!projectHours.ok) return projectHours;

      projects.push({
        projectSlug: projectSlug.value,
        sessions: projectSessions.value,
        hours: projectHours.value,
      });
    }

    // Deliberately NOT asserted: sum(projects.sessions) === sessions. Totals are
    // ≥ the breakdown by design — a session in an unmapped directory counts
    // toward the agent's day and is dropped from the breakdown by ADR 008. See
    // schema.ts's note on `aiUsageDays`. Asserting equality here would force the
    // Collector to invent a bucket for private work, which is the whole thing
    // this pipeline is built to avoid.

    days.push({ day: day.value, agent, sessions: sessions.value, hours: hours.value, projects });
  }

  return { ok: true, value: { days, machine: machine.value, postedAt: postedAt.value } };
}

/** One day of movement, as parsed. Mirrors `HealthDayIngestSchema`. */
export type HealthDayInput = {
  day: string;
  steps: number;
  distanceKm: number;
  activities: HealthActivityInput[];
};

/** The whole `POST /ingest/health` body. Mirrors `HealthIngestSchema`. */
export type HealthIngestInput = {
  days: HealthDayInput[];
  source: HealthSourceId;
  postedAt: string;
};

const HEALTH_BODY_KEYS = ['days', 'source', 'postedAt'] as const;
const HEALTH_DAY_KEYS = ['day', 'steps', 'distanceKm', 'activities'] as const;
const HEALTH_ACTIVITY_KEYS = [
  'id',
  'kind',
  'title',
  'startedAt',
  'durationMinutes',
  'distanceKm',
] as const;

/**
 * Parse a decoded `POST /ingest/health` body. Pure, as above.
 *
 * `source` sits on the envelope rather than on each day because one push comes
 * from one place: `HKObserverQuery` background delivery posts `'healthkit'`, a
 * hand-entered correction posts `'manual'`. Per-day sources in a single push
 * would be a producer lying about at least one of them.
 */
export function parseHealthBody(raw: unknown): ParseResult<HealthIngestInput> {
  if (!isPlainObject(raw)) {
    return fail('', `Expected a JSON object body, got ${describe(raw)}.`);
  }

  const unknownKey = rejectUnknownKeys(raw, HEALTH_BODY_KEYS, '');
  if (unknownKey !== null) return { ok: false, problem: unknownKey };

  if (
    typeof raw.source !== 'string' ||
    !(HEALTH_SOURCES as readonly string[]).includes(raw.source)
  ) {
    return fail(
      'source',
      `Expected one of ${HEALTH_SOURCES.join(' | ')}, got ${describe(raw.source)}.`,
    );
  }
  const source = raw.source as HealthSourceId;

  const postedAt = parseIsoDateTime(raw.postedAt, 'postedAt');
  if (!postedAt.ok) return postedAt;

  if (!Array.isArray(raw.days)) {
    return fail('days', `Expected an array of day summaries, got ${describe(raw.days)}.`);
  }
  if (raw.days.length === 0) {
    return fail('days', 'At least one day is required.');
  }
  if (raw.days.length > MAX_DAYS_PER_PUSH) {
    return fail(
      'days',
      `At most ${MAX_DAYS_PER_PUSH} days per push (got ${raw.days.length}).`,
    );
  }

  const latestPlausibleDay = new Date(new Date(postedAt.value).getTime() + 86_400_000)
    .toISOString()
    .slice(0, 10);

  const days: HealthDayInput[] = [];
  const seenDays = new Set<string>();
  const seenActivityIDs = new Set<string>();

  for (const [index, entry] of raw.days.entries()) {
    const at = `days[${index}]`;

    if (!isPlainObject(entry)) {
      return fail(at, `Expected an object, got ${describe(entry)}.`);
    }
    const strayKey = rejectUnknownKeys(entry, HEALTH_DAY_KEYS, at);
    if (strayKey !== null) return { ok: false, problem: strayKey };

    const day = parseIsoDate(entry.day, `${at}.day`);
    if (!day.ok) return day;
    if (day.value > latestPlausibleDay) {
      return fail(
        `${at}.day`,
        `Day ${day.value} is after the push's own postedAt (${postedAt.value}).`,
      );
    }
    if (seenDays.has(day.value)) {
      return fail(
        `${at}.day`,
        `Duplicate day ${day.value} in one push. The route replaces a day rather than adding to it.`,
      );
    }
    seenDays.add(day.value);

    const steps = parseCount(entry.steps, `${at}.steps`, MAX_STEPS_PER_DAY);
    if (!steps.ok) return steps;

    const distanceKm = parseAmount(
      entry.distanceKm,
      `${at}.distanceKm`,
      MAX_DISTANCE_KM_PER_DAY,
    );
    if (!distanceKm.ok) return distanceKm;

    // Missing means an older steps-only iPhone build. It remains accepted
    // during rollout and is normalised to the target contract's honest `[]`.
    const rawActivities = entry.activities ?? [];
    if (!Array.isArray(rawActivities)) {
      return fail(`${at}.activities`, `Expected an array, got ${describe(rawActivities)}.`);
    }
    if (rawActivities.length > MAX_HEALTH_ACTIVITIES_PER_DAY) {
      return fail(
        `${at}.activities`,
        `At most ${MAX_HEALTH_ACTIVITIES_PER_DAY} workouts per day (got ${rawActivities.length}).`,
      );
    }

    const activities: HealthActivityInput[] = [];
    for (const [activityIndex, activity] of rawActivities.entries()) {
      const activityAt = `${at}.activities[${activityIndex}]`;
      if (!isPlainObject(activity)) {
        return fail(activityAt, `Expected an object, got ${describe(activity)}.`);
      }
      const activityStrayKey = rejectUnknownKeys(
        activity,
        HEALTH_ACTIVITY_KEYS,
        activityAt,
      );
      if (activityStrayKey !== null) {
        return { ok: false, problem: activityStrayKey };
      }

      if (
        typeof activity.id !== 'string' ||
        activity.id.length === 0 ||
        activity.id.length > 128
      ) {
        return fail(`${activityAt}.id`, 'Expected a stable workout id of 1–128 characters.');
      }
      if (seenActivityIDs.has(activity.id)) {
        return fail(`${activityAt}.id`, `Duplicate workout id ${JSON.stringify(activity.id)}.`);
      }
      seenActivityIDs.add(activity.id);

      if (
        typeof activity.kind !== 'string' ||
        !(HEALTH_ACTIVITY_KINDS as readonly string[]).includes(activity.kind)
      ) {
        return fail(
          `${activityAt}.kind`,
          `Expected one of ${HEALTH_ACTIVITY_KINDS.join(' | ')}, got ${describe(activity.kind)}.`,
        );
      }
      if (
        typeof activity.title !== 'string' ||
        activity.title.trim().length === 0 ||
        activity.title.length > 80
      ) {
        return fail(`${activityAt}.title`, 'Expected a workout title of 1–80 characters.');
      }

      const startedAt = parseIsoDateTime(activity.startedAt, `${activityAt}.startedAt`);
      if (!startedAt.ok) return startedAt;
      const durationMinutes = parseAmount(
        activity.durationMinutes,
        `${activityAt}.durationMinutes`,
        MAX_WORKOUT_MINUTES,
      );
      if (!durationMinutes.ok) return durationMinutes;

      let workoutDistanceKm: number | undefined;
      if (activity.distanceKm !== undefined) {
        const parsedDistance = parseAmount(
          activity.distanceKm,
          `${activityAt}.distanceKm`,
          MAX_DISTANCE_KM_PER_DAY,
        );
        if (!parsedDistance.ok) return parsedDistance;
        workoutDistanceKm = parsedDistance.value;
      }

      activities.push({
        id: activity.id,
        kind: activity.kind as HealthActivityKindId,
        title: activity.title.trim(),
        startedAt: startedAt.value,
        durationMinutes: durationMinutes.value,
        ...(workoutDistanceKm === undefined ? {} : { distanceKm: workoutDistanceKm }),
      });
    }

    days.push({
      day: day.value,
      steps: steps.value,
      distanceKm: distanceKm.value,
      activities,
    });
  }

  return { ok: true, value: { days, source, postedAt: postedAt.value } };
}

/* ------------------------------------------------------------------ *
 * The `aiBuildStats` fold, shared with snapshotBuild
 * ------------------------------------------------------------------ */

/**
 * First day of the window `projects.aiBuildStats` is summed over.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THERE ARE TWO WRITERS OF `projects.aiBuildStats`. THEY MUST AGREE EXACTLY.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `snapshotBuild.applyProjectAiStats` writes it from `foldAiUsage`, which is
 * bounded to **the first date in the contribution calendar of the rebuild it is
 * part of** — the same 52 weeks as the heatmap, for the reasons set out in that
 * file. `recordAiUsage` below writes it too, seconds earlier, so that a push is
 * reflected on the case study immediately instead of at the top of the hour.
 *
 * If the two folds used different windows the field's value would depend on
 * which writer ran last, and both run on every push. The visible symptoms would
 * be a public number that oscillates between two values as rows age past the
 * window, and a broken contract: `@home/types` promises that a project's
 * `aiBuildStats.sessions` and its entry in `aiUsage.topProjects` are "the same
 * number reported twice", and `topProjects` is windowed.
 *
 * So this reads the window back off the Snapshot that the last rebuild wrote,
 * which is by construction the window the *next* rebuild will start from. It
 * cannot recompute it: the calendar comes from GitHub, a mutation cannot
 * `fetch`, and the refold this push schedules will reconcile any drift within
 * seconds anyway.
 *
 * The fallback — a trailing 365 days — is `apply`'s own fallback, for the same
 * two cases: no Snapshot yet (a fresh deployment whose first push beats its
 * first cron), or a Snapshot whose calendar came back empty (no PAT, a GitHub
 * outage that still returned a shell).
 */
/**
 * …and the second thing the two writers must agree about: **summing machines**.
 *
 * Both folds — this file's `recordAiUsage` and `snapshotBuild.foldAiUsage` — are
 * range reads over `aiUsageDays` that add up every row they see, and both are
 * therefore already correct now that a day has one row *per machine* rather than
 * one row. That is not luck, but it is fragile in one specific way worth naming:
 * either fold could be "optimised" into a per-(day, agent) lookup, which would
 * have been harmless under the old key and now silently drops every computer but
 * one. Neither may use `.unique()` on anything shorter than the full triple.
 */
async function aiStatsWindowStart(ctx: MutationCtx): Promise<string> {
  const snapshot = await ctx.db.query('snapshot').order('desc').first();
  const firstDay = snapshot?.gitStats.calendar[0]?.[0]?.date;
  return firstDay ?? isoDay(Date.now() - 365 * DAY_MS);
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

/**
 * Upsert AI-usage days, then refresh `projects.aiBuildStats` for every project
 * the push touched.
 *
 * `internalMutation`: the public API must not contain a write that fills the
 * dashboard's numbers. Reachable only from `http.ts`'s `aiUsageIngest` route,
 * which has already checked a bearer token carrying `ai-usage:write`.
 *
 * The `args` validators are a second line of defence behind `parseAiUsageBody`,
 * not the first — they are structural, so `v.string()` would accept a path where
 * a slug belongs. They are still declared field by field (rather than
 * `v.any()`) because they reuse `aiAgent` from schema.ts, which means an agent
 * this mutation accepts and the column cannot store is a compile error rather
 * than a push that 200s and vanishes.
 *
 * ── The derived write ─────────────────────────────────────────────────────
 *
 * ADR 016 puts per-project agent usage on the case study, and `aiBuildStats` is
 * the sum of that project's slices across every `aiUsageDays` row **in the
 * snapshot window** — see `aiStatsWindowStart` above for why that window and not
 * a lifetime one, and why this file has to agree with `snapshotBuild` down to
 * the rounding. So it is **recomputed from the table**, never incremented by
 * the delta in this push. That is not caution, it is correctness: this route
 * replaces days, and a replaced day whose figure went *down* must make the
 * project's total go down with it. An incremental update can only ever add.
 *
 * The recompute is a range read over the window. At ~730 rows a year (schema.ts
 * says so, and says why there is no per-project table) even the whole table
 * would be the right read, and this happens at most a few times a day.
 *
 * Only the *touched* slugs are patched — the union of the slugs in the payload
 * and the slugs on the rows being replaced. The second half of that union is
 * the easy one to miss: dropping a project from a re-posted day has to make its
 * total fall, and it can only do that if the row's previous contents are read
 * before the patch overwrites them. The hourly cron reconciles every other
 * project; this keeps the ones that just changed honest immediately.
 *
 * ── One machine, one claim ────────────────────────────────────────────────
 *
 * `machine` comes off the envelope and is stamped onto every row this push
 * writes, so the lookup below is the full `(day, agent, machine)` triple. Two
 * computers reporting the same day now hold two rows, and both folds add them
 * up. The mutation cannot express "overwrite somebody else's day", which is the
 * point: it is not a rule being followed, it is a shape with no way to say it.
 *
 * @returns `{ daysCreated, daysUpdated, projectsUpdated, projectsCleared, unmappedProjects }`
 *   — counts only. `unmappedProjects` is the number of slugs with no matching
 *   `projects` row; the slugs themselves are not echoed, per ADR 008.
 */
export const recordAiUsage = internalMutation({
  args: {
    days: v.array(
      v.object({
        day: v.string(),
        agent: aiAgent,
        sessions: v.number(),
        hours: v.number(),
        projects: v.array(
          v.object({
            projectSlug: v.string(),
            sessions: v.number(),
            hours: v.number(),
          }),
        ),
      }),
    ),
    /**
     * The pushing computer's label — `machineLabel` in schema.ts, which is
     * itself a `v.string()`: Convex validators cannot express a pattern, so the
     * narrowing lives in `parseMachineLabel` above and in `MachineLabelSchema`.
     * Declared here rather than per day because the row-level field is copied
     * from this one value, and a per-day `machine` would let a caller that
     * skipped the parser write two computers' claims in one transaction.
     *
     * Not imported from schema.ts because `machineLabel` is module-private
     * there; `v.string()` is the identical validator either way.
     */
    machine: v.string(),
    postedAt: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.days.length === 0) {
      // Unreachable through http.ts, which parses first. Guarded anyway: a
      // future caller that skipped the parser would otherwise silently succeed.
      invalid({
        code: 'precondition-failed',
        field: 'days',
        message: 'At least one day is required.',
      });
    }

    let daysCreated = 0;
    let daysUpdated = 0;

    /** Slugs whose windowed total may have moved. See the header. */
    const touched = new Set<string>();

    for (const day of args.days) {
      // THE upsert key: the full triple, off `by_day_agent_machine`. Reading
      // only `(day, agent)` here is the clobbering bug — it would return some
      // other computer's row and patch this machine's numbers over it. `.first()`
      // rather than `.unique()` because the index is a prefix match and the
      // three-field probe is unique by construction; `.unique()` would add a
      // throw for a case that cannot arise and would tempt a future edit to
      // shorten the probe to make it "work".
      const existing = await ctx.db
        .query('aiUsageDays')
        .withIndex('by_day_agent_machine', (q) =>
          q.eq('day', day.day).eq('agent', day.agent).eq('machine', args.machine),
        )
        .first();

      // Read the outgoing breakdown BEFORE the patch replaces it, or a dropped
      // project keeps a total it no longer earns.
      if (existing !== null) {
        for (const project of existing.projects) {
          touched.add(project.projectSlug);
        }
      }
      for (const project of day.projects) {
        touched.add(project.projectSlug);
      }

      const fields = {
        day: day.day,
        agent: day.agent,
        // Redundant on the patch path — it is the value the row was found by —
        // and written anyway so `fields` is one shape for both branches. A
        // row-level `machine` that could differ from the one in the key would be
        // a row nothing could find again.
        //
        // It also means the migration's `'pre-multi-machine'` rows are never
        // rewritten by an ingest: the lookup cannot match them under a real
        // label, so they stay as the honest record of "written before machines
        // were distinguished" and are summed alongside everything else.
        machine: args.machine,
        sessions: day.sessions,
        hours: day.hours,
        projects: day.projects,
        // The push's own instant, per schema.ts: `_creationTime` keeps the first
        // sighting, so "this day was revised after the fact" stays answerable.
        ingestedAt: args.postedAt,
      };

      if (existing === null) {
        await ctx.db.insert('aiUsageDays', fields);
        daysCreated += 1;
      } else {
        // `patch`, not `replace`: identical here (every field is supplied), but
        // it keeps the intent — revise this day — legible.
        await ctx.db.patch(existing._id, fields);
        daysUpdated += 1;
      }
    }

    let projectsUpdated = 0;
    let projectsCleared = 0;
    let unmappedProjects = 0;

    if (touched.size > 0) {
      // The same window `snapshotBuild.foldAiUsage` uses, read the same way, so
      // the two writers of `aiBuildStats` cannot disagree. See the helper.
      const windowStart = await aiStatsWindowStart(ctx);

      /** slug → `{ sessions, hours }` across every stored day in the window. */
      const totals = new Map<string, { sessions: number; hours: number }>();

      // `by_day_agent_machine` is usable from its `day` prefix — schema.ts says
      // so, and it is why there is no separate `by_day`. Same range read as
      // `snapshotBuild.foldAiUsage`, over the same window, off the same index.
      //
      // Every row in the window is summed, which is what makes this correct
      // across machines: one day now yields up to `machines × agents` rows and
      // a project's total is the sum of its slices in all of them. Narrowing
      // this read to the pushing machine would be the tempting optimisation and
      // the wrong one — `aiBuildStats` is the project's total effort, not this
      // laptop's.
      const rows = await ctx.db
        .query('aiUsageDays')
        .withIndex('by_day_agent_machine', (q) => q.gte('day', windowStart))
        .collect();

      for (const row of rows) {
        for (const project of row.projects) {
          if (!touched.has(project.projectSlug)) continue;
          const running = totals.get(project.projectSlug) ?? { sessions: 0, hours: 0 };
          running.sessions += project.sessions;
          running.hours += project.hours;
          totals.set(project.projectSlug, running);
        }
      }

      for (const projectSlug of touched) {
        const project = await ctx.db
          .query('projects')
          .withIndex('by_slug', (q) => q.eq('slug', projectSlug))
          .first();

        if (project === null) {
          // A slug the Collector's mapping produced for a project that does not
          // exist here — usually a case study not written up yet. The usage row
          // keeps it, so the number appears the moment the project is created.
          // Not an error, and not named in the response (ADR 008).
          unmappedProjects += 1;
          continue;
        }

        const total = totals.get(projectSlug);

        if (total === undefined || (total.sessions === 0 && total.hours === 0)) {
          // Every day in the window that mentioned this project has been revised
          // away. Remove the field rather than storing zeroes: `aiBuildStats` is
          // optional and means "no agent usage recorded", which is what the case
          // study should now say instead of "0 sessions".
          //
          // `snapshotBuild.applyProjectAiStats` also clears absent projects when
          // the full hourly fold runs. Here the slug is in `touched`, so the same
          // correction is applied immediately after a push rather than waiting
          // for that rebuild.
          if (project.aiBuildStats !== undefined) {
            await ctx.db.patch(project._id, { aiBuildStats: undefined });
            projectsCleared += 1;
          }
          continue;
        }

        // `Math.round`, matching `applyProjectAiStats` exactly. Whole hours is
        // what the field means: `BuildLedger` and `CaseDeck` both render it as an
        // integer, so a stored 23.29 is a fraction nobody sees — and, before
        // these two writers were reconciled, it was also the reason the no-op
        // guard below never matched. Every push wrote 23.29 and the refold
        // seconds later wrote 23 back over it, so *both* writes always fired and
        // woke every `projects` subscription, twice a day, forever.
        const next = { sessions: total.sessions, hours: Math.round(total.hours) };

        // Skip a write that changes nothing. The steady-state push re-sends days
        // that have not moved, and a no-op patch still bumps `_creationTime`'s
        // sibling machinery and wakes every live query subscribed to `projects`
        // — including the admin table on the phone.
        if (
          project.aiBuildStats !== undefined &&
          project.aiBuildStats.sessions === next.sessions &&
          project.aiBuildStats.hours === next.hours
        ) {
          continue;
        }

        await ctx.db.patch(project._id, { aiBuildStats: next });
        projectsUpdated += 1;
      }
    }

    return { daysCreated, daysUpdated, projectsUpdated, projectsCleared, unmappedProjects };
  },
});

/**
 * Upsert daily movement summaries.
 *
 * `internalMutation`, reachable only from http.ts's `healthIngest` route behind
 * a token carrying `health:write`.
 *
 * No derived write here, unlike `recordAiUsage`. `snapshot.healthStats` is the
 * only consumer and it is a pure fold of this table (newest row → `latestDay`,
 * trailing seven → `recentDays`, their mean → `sevenDayAverageSteps`), so it
 * belongs to the snapshot builder rather than to the ingest.
 *
 * `source` is written onto every row from the envelope. A `manual` correction
 * *overwrites* the HealthKit figure for that day rather than sitting beside it
 * — the table is keyed on `day` alone, and schema.ts explains why: a day has one
 * step count, and two rows would leave every reader deciding which one wins.
 *
 * @returns `{ daysCreated, daysUpdated, latestDay }` where `latestDay` is the
 *   newest day in *this push*, echoed so the phone can confirm what landed.
 */
export const recordHealth = internalMutation({
  args: {
    days: v.array(
      v.object({
        day: v.string(),
        steps: v.number(),
        distanceKm: v.number(),
        activities: v.array(
          v.object({
            id: v.string(),
            kind: v.union(
              v.literal('walking'),
              v.literal('running'),
              v.literal('cycling'),
              v.literal('gym'),
              v.literal('other'),
            ),
            title: v.string(),
            startedAt: v.string(),
            durationMinutes: v.number(),
            distanceKm: v.optional(v.number()),
          }),
        ),
      }),
    ),
    source: healthSource,
    postedAt: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.days.length === 0) {
      invalid({
        code: 'precondition-failed',
        field: 'days',
        message: 'At least one day is required.',
      });
    }

    let daysCreated = 0;
    let daysUpdated = 0;
    let latestDay = args.days[0]!.day;

    for (const day of args.days) {
      if (day.day > latestDay) latestDay = day.day;

      const existing = await ctx.db
        .query('healthDays')
        .withIndex('by_day', (q) => q.eq('day', day.day))
        .first();

      const fields = {
        day: day.day,
        steps: day.steps,
        distanceKm: day.distanceKm,
        activities: day.activities,
        source: args.source,
        ingestedAt: args.postedAt,
      };

      if (existing === null) {
        await ctx.db.insert('healthDays', fields);
        daysCreated += 1;
      } else {
        await ctx.db.patch(existing._id, fields);
        daysUpdated += 1;
      }
    }

    return { daysCreated, daysUpdated, latestDay };
  },
});
