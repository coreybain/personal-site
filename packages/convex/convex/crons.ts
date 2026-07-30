/**
 * crons.ts — the schedule. One job, and this file exists to say why it is one.
 *
 * ADR 004: "A dashboard that calls GitHub on page load costs seconds. One
 * denormalised row, refreshed on a schedule, keeps loads sub-second." This is
 * that schedule. ADR 005 is the other half of it: Convex has scheduled functions
 * built in, so there is no cron infrastructure to operate, no GitHub Action
 * holding a PAT, and no second place where "hourly" is configured.
 *
 * ── Why one job and not three ──────────────────────────────────────────────
 *
 * The Snapshot is a single row and every Signal on the homepage resolves from
 * it, so rebuilding it in pieces would let a reader observe this hour's
 * contribution calendar beside last hour's AI numbers — with `computedAt` (which
 * the site prints, and which every relative figure is measured against) claiming
 * they were computed together. `gitStats.rebuild` fetches GitHub and then calls
 * `snapshotBuild.apply`, which folds `aiUsageDays`, `healthDays` and
 * `funEntries` and writes all of it in one transaction.
 *
 * The two ingest pipelines do not need a job here at all: Pipeline 2 is pushed
 * by launchd on the Mac and Pipeline 3 by the phone's `HKObserverQuery`. They
 * write raw rows whenever they like; this job is what folds them.
 *
 * ── The minute, and why it is not zero ─────────────────────────────────────
 *
 * `minuteUTC: 7`. Two reasons, neither superstitious:
 *
 *   • Every naive scheduler in the world fires at :00, and GitHub's secondary
 *     rate limits are applied per-account against concurrent load. Seven minutes
 *     past keeps this job out of that crowd for free.
 *   • The public pages revalidate on a 300-second ISR window aligned to nothing
 *     in particular; writing at :07 means the Snapshot is never being replaced
 *     at the same instant a page is being regenerated from it often enough to
 *     matter. (Convex's read consistency makes this a latency nicety rather than
 *     a correctness one — a page never reads half a row.)
 *
 * Hourly is the plan's own figure ("Git snapshot — Convex cron, hourly"). It is
 * comfortably inside GitHub's 5,000 points/hour REST-equivalent budget: this job
 * spends three GraphQL requests per tick.
 *
 * ── Running it by hand ─────────────────────────────────────────────────────
 *
 *     bunx convex run gitStats:rebuild '{}'    # fetch GitHub, rebuild, write
 *     bunx convex run gitStats:preview '{}'    # fetch and print, write nothing
 *
 * Both are `internalAction`s. `npx convex run` reaches internal functions
 * because the CLI authenticates with the deployment's admin key, so nothing had
 * to be made public to keep the manual trigger — and a *public* action here
 * would be an unauthenticated way for anyone holding the deployment URL to spend
 * Corey's GitHub rate limit and rewrite the homepage's numbers.
 *
 * ── Failure behaviour ──────────────────────────────────────────────────────
 *
 * A failed tick leaves the previous Snapshot exactly as it was and logs; the
 * next tick tries again an hour later. Nothing retries in between, and that is
 * deliberate: the visible symptom of a stalled cron is a `computedAt` that stops
 * advancing, which the site renders as "as of …" on the page itself. A retry
 * storm would hide it.
 */

import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

/**
 * Rebuild the Snapshot from GitHub + the raw ingest tables, hourly.
 *
 * The job name is the string that appears in the Convex dashboard's schedule
 * view and in its logs, so it is written as a sentence about what happens rather
 * than as a function name that is already visible beside it.
 */
crons.hourly(
  'rebuild the snapshot from GitHub and the ingest tables',
  { minuteUTC: 7 },
  internal.gitStats.rebuild,
  {},
);

export default crons;
