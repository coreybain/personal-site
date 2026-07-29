/**
 * /fun — derivations.
 *
 * Every number on the page is computed here from `@/lib/snapshot` and nowhere
 * else. Nothing is hardcoded: the counts, the totals, the date stamps and the
 * band split all fall out of `snapshot.funLog`, so when the collector replaces
 * the draft entries the page re-reads without an edit.
 *
 * `funLog` is the superset the /fun page was given — `funEntries` (beer,
 * coffee, walks) plus pub visits, newest first. See the `PubEntry` note in
 * snapshot.ts for why pubs live outside the `FunEntry` union.
 */

import type { FunLogEntry } from "@/lib/snapshot";
import { snapshot } from "@/lib/snapshot";

export type FunKind = FunLogEntry["type"];

/** A walk, narrowed out of the union so `steps` / `km` are reachable. */
export type WalkEntry = Extract<FunLogEntry, { type: "walk" }>;

export function isWalk(entry: FunLogEntry): entry is WalkEntry {
  return entry.type === "walk";
}

const DAY_MS = 86_400_000;
const COMPUTED_MS = Date.parse(snapshot.computedAt);

const log: readonly FunLogEntry[] = snapshot.funLog;

/**
 * `daysAgo` back to the ISO date it happened on, relative to the snapshot's
 * own clock rather than the render's — so the stamps are stable in every
 * timezone and identical on server and client.
 */
export function isoDaysAgo(daysAgo: number): string {
  return new Date(COMPUTED_MS - daysAgo * DAY_MS).toISOString().slice(0, 10);
}

/** Stable key — `daysAgo` is unique across the log. */
export function entryKey(entry: FunLogEntry): string {
  return `${entry.type}-${entry.daysAgo}`;
}

export const KIND_LABEL: Record<FunKind, string> = {
  beer: "Beer",
  coffee: "Coffee",
  walk: "Walk",
  pub: "Pub",
};

/** Reading order for the key row: what you drink, where you walk, where you sit. */
export const KIND_ORDER: readonly FunKind[] = ["coffee", "beer", "pub", "walk"];

/**
 * Base hue per kind, matching the homepage LifeStrip's palette: amber for
 * beer, roasted brown for coffee, the dusk-violet accent for walks. Pubs are
 * new here and take the sun's warm end.
 */
const BASE_HUE: Record<FunKind, number> = {
  beer: 38,
  coffee: 26,
  walk: 256,
  pub: 34,
};

/**
 * A tiny deterministic hue drift so no two cards of a kind paint identically.
 *
 * Indexed by the entry's position *within its own kind*, not within the log —
 * with five distinct steps and at most five entries of any kind, every card of
 * a kind is guaranteed its own hue. (A global index mod 3 collided: three of
 * the four coffees landed on the same drift.)
 */
const HUE_DRIFT = [0, -6, 7, -3, 5] as const;

const hueByKey: ReadonlyMap<string, number> = (() => {
  const seen: Record<FunKind, number> = { beer: 0, coffee: 0, walk: 0, pub: 0 };
  const map = new Map<string, number>();
  for (const entry of log) {
    const nth = seen[entry.type]++;
    map.set(entryKey(entry), BASE_HUE[entry.type] + HUE_DRIFT[nth % HUE_DRIFT.length]);
  }
  return map;
})();

export function hueFor(entry: FunLogEntry): number {
  return hueByKey.get(entryKey(entry)) ?? BASE_HUE[entry.type];
}

/* ------------------------------------------------------------------ *
 * Totals
 * ------------------------------------------------------------------ */

const walks = log.filter(isWalk);

function countOf(kind: FunKind): number {
  return log.filter((entry) => entry.type === kind).length;
}

const kmTotal = Math.round(walks.reduce((sum, w) => sum + w.km, 0) * 10) / 10;

export const tally = {
  entries: log.length,
  /** Oldest entry in the log, in days before the snapshot. */
  spanDays: log.reduce((max, e) => Math.max(max, e.daysAgo), 0),
  km: kmTotal,
  steps: walks.reduce((sum, w) => sum + w.steps, 0),
  longestKm: walks.reduce((max, w) => Math.max(max, w.km), 0),
  counts: {
    beer: countOf("beer"),
    coffee: countOf("coffee"),
    walk: countOf("walk"),
    pub: countOf("pub"),
  } satisfies Record<FunKind, number>,
};

/** ISO date of the newest and oldest entries — the log's actual extent. */
export const logRange = {
  newest: isoDaysAgo(log.reduce((min, e) => Math.min(min, e.daysAgo), Infinity)),
  oldest: isoDaysAgo(tally.spanDays),
};

/* ------------------------------------------------------------------ *
 * Bands — the only grouping on the page. Recency, not type; type is
 * carried by the artwork and a badge. No filters, so no client JS.
 * ------------------------------------------------------------------ */

export type Band = {
  id: string;
  label: string;
  /** One line of context under the band rule. */
  blurb: string;
  entries: FunLogEntry[];
};

const BAND_SPEC: { id: string; label: string; blurb: string; upTo: number }[] = [
  {
    id: "week",
    label: "This week",
    blurb: "Still on my hands — the coffee, the walk, the Saturday pint.",
    upTo: 7,
  },
  {
    id: "month",
    label: "Earlier this month",
    blurb: "Ship-it Fridays, schnitzel night, and one properly long walk.",
    upTo: 31,
  },
  {
    id: "back",
    label: "Further back",
    blurb: "The tail of the log, kept because the days were good ones.",
    upTo: Infinity,
  },
];

/** `funLog` arrives sorted newest-first, so each band keeps that order. */
export const bands: Band[] = BAND_SPEC.map((spec, i) => {
  const from = i === 0 ? -1 : BAND_SPEC[i - 1].upTo;
  return {
    id: spec.id,
    label: spec.label,
    blurb: spec.blurb,
    entries: log.filter((e) => e.daysAgo > from && e.daysAgo <= spec.upTo),
  };
}).filter((band) => band.entries.length > 0);
