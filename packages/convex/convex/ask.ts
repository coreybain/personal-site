/**
 * ask.ts — retrieval and metering for Ask Corey (ADR 015, build phase 6).
 *
 * `knowledge.ts` is the write half of the rebuild: it turns every published
 * project, lab and post into one `knowledgeDocs` row with `plainText` and — when
 * `OPENAI_API_KEY` is set on the deployment — an embedding. This file is the
 * read half, and it is the file ADR 015 is actually about. v2's Ask Corey was a
 * lexical matcher over content strings; it answered well only when the asker
 * happened to use the site's own words, and calling that "AI" was the thing the
 * plan objected to.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  THE HONESTY RULE
 *
 *  Real retrieval is vector search over embeddings. This deployment has no
 *  `OPENAI_API_KEY`, so every row currently holds `embedding: []` and the
 *  vector index is empty. Retrieval therefore falls back to the lexical
 *  search index — the SAME CLASS OF THING ADR 015 EXISTS TO REPLACE.
 *
 *  So every result carries `retrievalMode`, and the route is expected to
 *  surface it. A degraded answer that looks like an upgraded one is worse
 *  than no feature: it would be the v2 matcher wearing the new label, which
 *  is precisely the outcome the ADR was written to prevent. Nothing in this
 *  file may make the lexical path look like the vector path.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── The surface ───────────────────────────────────────────────────────────
 *
 *   `retrieve`              action           PUBLIC. Query → ranked citations.
 *   `checkRateLimit`        mutation         PUBLIC. The meter for the route.
 *   `pruneRateLimits`       internalMutation Housekeeping; runs daily by cron.
 *   `rewindRateLimitWindow` internalMutation Ops/verification escape hatch.
 *   `corpusStats`           internalQuery    How much of the index is real.
 *   `lexicalSearch`         internalQuery    The `by_plainText` half.
 *   `citationsByIds`        internalQuery    Hydrates vector-search hits.
 *   `consume`               internalMutation `retrieve`'s own meter.
 *
 * Actions cannot touch `ctx.db`, so every database access from `retrieve` goes
 * through the internal functions above — the same arrangement `knowledge.ts`
 * uses, and for the same reason.
 *
 * ── Runtime ───────────────────────────────────────────────────────────────
 *
 * No `'use node'`. The only Node-shaped need is `fetch`, which the default
 * Convex runtime gives an action, and `ctx.vectorSearch` is an action-only API
 * in both runtimes.
 *
 * ── Privacy (ADR 008) ─────────────────────────────────────────────────────
 *
 * Everything quotable here came through `knowledge.ts`'s `sourceForIndex`,
 * which indexes only text already rendered on a public page. This file adds no
 * new source: it reads `knowledgeDocs`, filters to `published`, and returns a
 * bounded slice of `plainText`. No private repository name, no path, no
 * transcript can reach an answer, because none of them has a field to arrive in.
 *
 * The rate limiter's identifier is a salted digest computed in the Next layer.
 * ⛔ A raw IP address must never be passed to any function in this file.
 */

import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import {
  type ActionCtx,
  action,
  internalMutation,
  internalQuery,
  mutation,
} from './_generated/server';
import { EMBEDDING_MODEL, embed } from './knowledge';
import {
  type RateLimitDecision,
  RATE_LIMITS,
  consumeRateLimit,
} from './lib/rateLimit';
import { invalid, nowIso } from './lib/validate';
import { rateLimitBucket } from './schema';

/* ------------------------------------------------------------------ *
 * Bounds
 * ------------------------------------------------------------------ */

/**
 * Longest question accepted.
 *
 * A retrieval query is a question, not a document. 500 characters is more than
 * anyone types into an ask box and far less than the embedding model's 8k-token
 * ceiling, so this bound is not about the provider — it is about a public
 * endpoint refusing to embed an essay somebody pasted in to see what happens.
 */
const MAX_QUERY_CHARS = 500;

/** Default number of citations returned. */
const DEFAULT_LIMIT = 5;

/**
 * Hard ceiling on citations, whatever the caller asks for.
 *
 * The answer prompt has to fit the retrieved text, and a reader has to be able
 * to check the citations. Both stop being true well before ten.
 */
const MAX_LIMIT = 10;

/**
 * Character ceiling on one citation's quoted snippet.
 *
 * Long enough to carry a claim and its context, short enough that a card of
 * five of them is still scannable — and short enough that the answering model's
 * context is spent on several sources rather than one long one.
 */
const SNIPPET_CHARS = 320;

/** Characters of lead-in kept before the matched term inside a snippet. */
const SNIPPET_LEAD_IN = 80;

/**
 * Question words, dropped before the query reaches the search index.
 *
 * This is not tidiness, it is a measured correctness fix. Convex's search index
 * "returns results where **any** word of `query` appears in the field" and ranks
 * by term frequency against field length. Sent verbatim, *What is QuoteCloud?*
 * matches every document in the corpus on `what` and `is`, and the observed
 * ranking put two short Lab entries above the QuoteCloud case study — the short
 * documents win on frequency-per-length for words that carry no meaning.
 * De-noised to `quotecloud`, the right document ranks first.
 *
 * The same list decides where a snippet is cut, for the same reason: the first
 * occurrence of `the` says nothing about where the interesting part is.
 *
 * ⚠️ It is applied ONLY to the query. Document text is never filtered — the
 * index does its own analysis on the way in, and second-guessing it there would
 * be a second, worse analyser.
 */
const NOISE_WORDS = new Set([
  'a', 'about', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'did', 'do',
  'does', 'for', 'from', 'has', 'have', 'how', 'i', 'in', 'is', 'it', 'its',
  'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was', 'were', 'what', 'when',
  'which', 'who', 'why', 'with', 'you', 'your',
]);

/* ------------------------------------------------------------------ *
 * Shapes returned to the caller
 * ------------------------------------------------------------------ */

/**
 * One citation — everything the UI needs to render a source link, and nothing
 * that would let it render something the index does not actually contain.
 */
export type Citation = {
  /** Which collection the text came from. Drives the "Case study" / "Lab" chip. */
  sourceType: Doc<'knowledgeDocs'>['sourceType'];
  /** The source row's slug; `null` for singletons (`resume`). */
  sourceSlug: string | null;
  /** Display title for the link text. */
  title: string;
  /**
   * Site-relative path — `/work/<slug>`, `/labs`, `/blog/<slug>`. A path and
   * not an absolute URL, so the ADR 017 domain cutover needs no re-index. The
   * shapes come from `knowledge.ts`'s `sourceForIndex` and are stored on the row.
   */
  url: string;
  /** A bounded slice of `plainText`. Never raw markdown — see `snippetFor`. */
  snippet: string;
  /**
   * Similarity, `0`–`1`, from `ctx.vectorSearch`.
   *
   * `null` on the lexical path, and that is not an omission to be filled in
   * later: Convex's search index returns documents in relevance order and does
   * **not** expose a score for them. Rendering a number here would mean
   * inventing one. Rank is the ordering of `results`; the score is either a real
   * cosine similarity or nothing.
   */
  score: number | null;
};

/**
 * Why retrieval is not running on vectors — or, when `retrievalMode` is
 * `'vector'`, `null`.
 *
 *   `rate-limited`        nothing was retrieved at all; `ok` is false.
 *   `no-key`              `OPENAI_API_KEY` is unset on the deployment. Today's
 *                         expected value, and not an error.
 *   `empty-vector-index`  a key exists but no published row has a vector yet —
 *                         run `bunx convex run knowledge:backfill '{}'`.
 *   `embed-failed`        the query could not be embedded (provider down, bad
 *                         key). The lexical path answered instead.
 *   `vector-no-match`     vector search ran and returned nothing, so the lexical
 *                         index was asked as well. The mini-hybrid case.
 */
export type RetrievalReason =
  | 'rate-limited'
  | 'no-key'
  | 'empty-vector-index'
  | 'embed-failed'
  | 'vector-no-match';

/** What `retrieve` returns. The whole contract with the /ask route. */
export type RetrieveResult = {
  /**
   * False only when the rate limit refused the call. Everything else — no key,
   * an empty index, no matching text — is a successful retrieval that found
   * what there was to find.
   */
  ok: boolean;
  /** The `ask-retrieve` backstop's decision. See `retrieve`'s docblock. */
  rateLimit: RateLimitDecision;
  /**
   * How the results were actually ranked. **Surface this.** When `ok` is false
   * nothing ran, and this is the mode that *would* have run given the current
   * key — reported rather than nulled so the route can still tell a reader
   * whether the feature is configured.
   */
  retrievalMode: 'vector' | 'lexical';
  /** `retrievalMode === 'lexical'`. The same fact, named for the UI's benefit. */
  degraded: boolean;
  /** Why, in machine-readable form. `null` on the un-degraded vector path. */
  reason: RetrievalReason | null;
  /** The model the query was embedded with, or `null` if it was not embedded. */
  embeddingModel: string | null;
  /**
   * The state of the index, so a route can explain itself honestly ("nothing is
   * indexed yet" reads very differently from "no match"). `null` when the call
   * was refused and nothing was read.
   */
  corpus: { published: number; embedded: number } | null;
  /** Ranked, best first. Empty is a legitimate answer. */
  results: Citation[];
};

/**
 * The projection the internal queries return.
 *
 * `embedding` is deliberately absent: 1,536 floats per row, moved from a query
 * to an action, to be thrown away. The vector's job ended in the index.
 *
 * `docId` is carried so the vector path can re-attach `_score` by identity
 * rather than by position — `citationsByIds` may drop a row that was deleted
 * between the search and the read, and positional zipping would then shift
 * every score after it onto the wrong document.
 */
type IndexedDoc = {
  docId: Id<'knowledgeDocs'>;
  sourceType: Doc<'knowledgeDocs'>['sourceType'];
  sourceSlug: string | null;
  title: string;
  url: string;
  plainText: string;
};

/* ------------------------------------------------------------------ *
 * Snippets
 * ------------------------------------------------------------------ */

/**
 * Split a query into the lowercase words worth matching on.
 *
 * Two characters is the floor rather than three: `ai`, `go` and `ci` are real
 * terms on this site, and the noise list already removes the two-letter words
 * that are not (`is`, `at`, `of`, `to`). Single characters are dropped outright.
 */
function queryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 1 && !NOISE_WORDS.has(term));
}

/**
 * A bounded, readable slice of `plainText`, centred on the query where possible.
 *
 * Three properties, each of which is a bug if it is missing:
 *
 *   • **Never markdown.** `plainText` was stripped by `knowledge.ts` on the way
 *     in, so a snippet is already plain — this function must not reintroduce
 *     markup, and callers must not substitute `body` for `plainText` to get a
 *     "richer" quote. A `](https://…)` in a citation reads as a broken page.
 *   • **Centred on the match, not on the start.** The first 320 characters of a
 *     case study are its title and attribution line, which are identical across
 *     every case study and answer nothing. Leading with the matched term is what
 *     makes the citation evidence rather than decoration.
 *   • **Cut on word boundaries**, with an ellipsis where text was removed, so a
 *     reader can see the quote is partial.
 *
 * With no term match — the normal case on the vector path, where the query need
 * share no words with the document — it returns the head of the text, which is
 * the summary, which is the right thing to show.
 */
function snippetFor(plainText: string, terms: string[]): string {
  const flat = plainText.replace(/\s+/g, ' ').trim();
  if (flat.length <= SNIPPET_CHARS) return flat;

  const haystack = flat.toLowerCase();

  // Earliest occurrence of any term. Earliest rather than best-scoring: with a
  // bounded snippet the alternative is a ranking exercise whose payoff is a few
  // characters of context, and "the first place the site talks about this" is a
  // defensible answer on its own.
  let match = -1;
  for (const term of terms) {
    const at = haystack.indexOf(term);
    if (at !== -1 && (match === -1 || at < match)) match = at;
  }

  if (match === -1) {
    const head = flat.slice(0, SNIPPET_CHARS);
    const lastSpace = head.lastIndexOf(' ');
    return `${(lastSpace > SNIPPET_CHARS / 2 ? head.slice(0, lastSpace) : head).trimEnd()}…`;
  }

  let start = Math.max(0, match - SNIPPET_LEAD_IN);
  if (start > 0) {
    // Move forward to the next word boundary so the quote does not open
    // mid-word. `+ 1` steps past the space itself.
    const boundary = flat.indexOf(' ', start);
    start = boundary === -1 ? start : boundary + 1;
  }

  const window = flat.slice(start, start + SNIPPET_CHARS);
  const end = start + window.length;
  const lastSpace = window.lastIndexOf(' ');
  const body =
    end < flat.length && lastSpace > SNIPPET_CHARS / 2
      ? window.slice(0, lastSpace)
      : window;

  return `${start > 0 ? '…' : ''}${body.trim()}${end < flat.length ? '…' : ''}`;
}

/** Turn an indexed row plus its score into the shape the UI renders. */
function toCitation(doc: IndexedDoc, terms: string[], score: number | null): Citation {
  return {
    sourceType: doc.sourceType,
    sourceSlug: doc.sourceSlug,
    title: doc.title,
    url: doc.url,
    snippet: snippetFor(doc.plainText, terms),
    score,
  };
}

/* ------------------------------------------------------------------ *
 * Reads — actions cannot touch ctx.db
 * ------------------------------------------------------------------ */

/**
 * How much of the index is real.
 *
 * Read before every retrieval, and it is what lets `retrieve` choose the vector
 * path without wasting a request: an `embedding: []` row is legal and invisible
 * to the vector index (see `knowledge.ts`), so a deployment can hold a full
 * corpus and an empty `by_embedding`. Embedding a query against an empty index
 * would cost an OpenAI call to retrieve nothing.
 *
 * A full scan of a table that holds one row per published project, lab and post
 * — tens of rows. When the blog makes that untrue, this becomes a counter on the
 * Snapshot rather than a scan.
 */
export const corpusStats = internalQuery({
  args: {},
  handler: async (ctx): Promise<{ published: number; embedded: number }> => {
    const rows = await ctx.db.query('knowledgeDocs').collect();
    const published = rows.filter((row) => row.published);

    return {
      published: published.length,
      // The vector index's own membership rule, restated: a row counts as
      // embedded only if it has a vector AND that vector was made by the model
      // the index is sized for. A row left over from a different model would
      // otherwise be counted as searchable when it is not.
      embedded: published.filter(
        (row) => row.embedding.length > 0 && row.embeddingModel === EMBEDDING_MODEL,
      ).length,
    };
  },
});

/**
 * The lexical half: Convex's `by_plainText` search index.
 *
 * This is the honest fallback, not a second-class one — full-text search with
 * relevance ranking over the same text the vectors describe. It is still
 * strictly worse at the job Ask Corey exists to do (it cannot match "what does
 * he know about pricing engines" against a document that says "quoting"), which
 * is why every caller of this is required to report `retrievalMode: 'lexical'`.
 *
 * `published` is filtered in the index rather than after it: an unpublished row
 * that reached the index must be unreachable from an answer (schema.ts calls
 * this "a second line of defence"), and filtering afterwards would mean a draft
 * had already occupied a slot in the result set.
 */
export const lexicalSearch = internalQuery({
  args: { text: v.string(), limit: v.number() },
  handler: async (ctx, args): Promise<IndexedDoc[]> => {
    const rows = await ctx.db
      .query('knowledgeDocs')
      .withSearchIndex('by_plainText', (q) =>
        q.search('plainText', args.text).eq('published', true),
      )
      .take(args.limit);

    return rows.map((row) => ({
      docId: row._id,
      sourceType: row.sourceType,
      sourceSlug: row.sourceSlug,
      title: row.title,
      url: row.url,
      plainText: row.plainText,
    }));
  },
});

/**
 * Hydrate vector-search hits.
 *
 * `ctx.vectorSearch` returns `{ _id, _score }` and nothing else — by design, so
 * the search itself never pays to move documents. The ids come back in score
 * order and this preserves that order; the caller re-attaches the scores.
 *
 * A missing id is skipped rather than thrown on: the vector index is eventually
 * consistent with the table, so an id for a row deleted between the search and
 * this read is an ordinary race, not a failure.
 */
export const citationsByIds = internalQuery({
  args: { ids: v.array(v.id('knowledgeDocs')) },
  handler: async (ctx, args): Promise<IndexedDoc[]> => {
    const docs: IndexedDoc[] = [];

    for (const id of args.ids) {
      const row = await ctx.db.get(id);
      if (row === null) continue;
      // Belt and braces. `by_embedding` carries `published` as a filter field
      // and the caller filters on it, so this should never fire — but "should
      // never" is not the standard for whether a draft can be quoted publicly.
      if (!row.published) continue;

      docs.push({
        docId: row._id,
        sourceType: row.sourceType,
        sourceSlug: row.sourceSlug,
        title: row.title,
        url: row.url,
        plainText: row.plainText,
      });
    }

    return docs;
  },
});

/* ------------------------------------------------------------------ *
 * Rate limiting
 * ------------------------------------------------------------------ */

/**
 * Consume one unit from a bucket. **The meter the /ask route calls.**
 *
 * Public because it has to be: a Next.js Route Handler or Server Action reaches
 * Convex over HTTP as an anonymous client, and `internal*` functions are not
 * reachable that way. What that costs, and why it is acceptable, is set out in
 * `lib/rateLimit.ts` under "The residual" — briefly: a stranger can invent
 * digests and create rows, but cannot compute anyone else's digest without the
 * web app's salt, so nobody's quota can be burned by a third party.
 *
 * ⚠️ **This consumes.** Calling it twice for one question counts two. The /ask
 * route should call it exactly once per submitted question, on bucket `'ask'`,
 * and must not also count `retrieve` — which meters itself on a separate bucket
 * precisely so the two cannot collide.
 *
 * @param bucket - `'ask'` for a question. `'contact'` is enforced inside
 *   `contactMessages.submit` and does not need a caller here; it is accepted
 *   because the validator is the schema's own and narrowing it would be a
 *   second definition of what a bucket is.
 * @param identifierHash - salted lowercase hex SHA-256, from
 *   `apps/web/src/lib/requestIdentity.ts`. Never a raw address.
 *
 * @returns `RateLimitDecision` — `{ allowed, limit, remaining,
 *   retryAfterSeconds, resetAt }`. A refusal is a normal return value, not a
 *   thrown error: the route answers `429` with `Retry-After:
 *   retryAfterSeconds`, and an exception would be indistinguishable from the
 *   backend being down.
 */
export const checkRateLimit = mutation({
  args: {
    bucket: rateLimitBucket,
    identifierHash: v.string(),
  },
  handler: async (ctx, args): Promise<RateLimitDecision> => {
    return await consumeRateLimit(ctx, args.bucket, args.identifierHash);
  },
});

/**
 * `retrieve`'s own meter. Internal, because only `retrieve` may call it.
 *
 * An action cannot write, so the public action's backstop has to be a mutation
 * it runs. Making it internal is what stops a caller metering themselves on a
 * cheap bucket and then calling the expensive path.
 */
export const consume = internalMutation({
  args: {
    bucket: rateLimitBucket,
    identifierHash: v.string(),
  },
  handler: async (ctx, args): Promise<RateLimitDecision> => {
    return await consumeRateLimit(ctx, args.bucket, args.identifierHash);
  },
});

/**
 * Delete counters whose window is long past. Housekeeping only.
 *
 * The limiter does not need this to be correct — a row from an old window is
 * reset in place on the next request, so a stale row and no row behave
 * identically. What it reclaims is *space*: every distinct identifier ever seen
 * leaves a row behind, including the invented digests the public mutation
 * cannot refuse.
 *
 * Registered in `crons.ts`, daily. Also runnable by hand:
 *
 * ```sh
 * bunx convex run ask:pruneRateLimits '{}'
 * ```
 *
 * @param olderThanHours - rows whose window started before this many hours ago
 *   are deleted. Defaults to 24, comfortably more than the longest window
 *   (one hour), so a live counter is never swept out from under a caller.
 */
export const pruneRateLimits = internalMutation({
  args: { olderThanHours: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const hours = Math.max(args.olderThanHours ?? 24, 2);
    const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();

    // Range read off `by_windowStart`, so this touches only what it deletes
    // rather than scanning the table.
    const stale = await ctx.db
      .query('rateLimits')
      .withIndex('by_windowStart', (q) => q.lt('windowStart', cutoff))
      .collect();

    for (const row of stale) {
      await ctx.db.delete(row._id);
    }

    return { deleted: stale.length, cutoff };
  },
});

/**
 * Back-date one counter's window so the rollover path can be exercised.
 *
 * ⚠️ OPERATIONS AND VERIFICATION ONLY, and `internalMutation` for that reason —
 * a public version of this would be a one-line rate-limit bypass.
 *
 * It exists because "the limit recovers when the window rolls" is otherwise
 * unverifiable without waiting an hour, and a rate limiter whose recovery has
 * never been observed is a rate limiter that might simply be a permanent ban.
 * This does not clear the counter: it moves `windowStart` back by the given
 * number of hours, so the *next* real call takes the reset branch in
 * `consumeRateLimit` exactly as it would after a genuine hour.
 *
 * ```sh
 * bunx convex run ask:rewindRateLimitWindow '{"bucket":"ask","identifierHash":"…"}'
 * ```
 *
 * @returns `{ found, windowStart }` — `found: false` when the identifier has no
 *   counter, which is a successful no-op rather than an error.
 */
export const rewindRateLimitWindow = internalMutation({
  args: {
    bucket: rateLimitBucket,
    identifierHash: v.string(),
    /** How far back to move the window. Defaults to one full `ask` window. */
    hours: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('rateLimits')
      .withIndex('by_bucket_identifierHash', (q) =>
        q.eq('bucket', args.bucket).eq('identifierHash', args.identifierHash),
      )
      .collect();

    if (rows.length === 0) return { found: false, windowStart: null };

    const hours = args.hours ?? RATE_LIMITS[args.bucket].windowSeconds / 3600;
    const windowStart = new Date(
      Date.parse(rows[0].windowStart) - hours * 3600 * 1000,
    ).toISOString();

    for (const row of rows) {
      await ctx.db.patch(row._id, { windowStart, updatedAt: nowIso() });
    }

    return { found: true, windowStart };
  },
});

/* ------------------------------------------------------------------ *
 * Retrieval
 * ------------------------------------------------------------------ */

/**
 * Find the passages of this site that bear on a question, with citations.
 *
 * **The read half of ADR 015.** Public, because the /ask route calls it
 * server-side (`fetchAction` / `ConvexHttpClient`); it answers with sources, not
 * with prose — generating the answer from these citations is the route's job,
 * and keeping the generation out of Convex is what lets the route stream tokens.
 *
 * ── How it chooses a path ─────────────────────────────────────────────────
 *
 *   1. meter the caller on `'ask-retrieve'` (see below);
 *   2. read `corpusStats`;
 *   3. a key AND at least one embedded published row ⇒ embed the query and
 *      `ctx.vectorSearch('knowledgeDocs', 'by_embedding', …)` filtered to
 *      `published`. `retrievalMode: 'vector'`;
 *   4. otherwise, or if embedding fails, or if vector search returns nothing ⇒
 *      the `by_plainText` search index. `retrievalMode: 'lexical'`, with
 *      `reason` saying which of those four it was.
 *
 * Step 4's third case is the only hybrid behaviour here and it is deliberately
 * minimal: falling back when the vector path found *nothing* costs one extra
 * indexed read and rescues the exact-term queries embeddings are known to miss
 * (a library name, a client name). Merging and re-ranking both result sets on
 * every query is a bigger decision that wants an evaluation set, which is not
 * something this file can conjure.
 *
 * ── Its own bucket ────────────────────────────────────────────────────────
 *
 * `retrieve` meters on `'ask-retrieve'`, not on `'ask'`. The route meters the
 * *question* on `'ask'` (an embedding plus a completion); this backstop meters
 * the *action*, which anyone holding the deployment URL can call directly. Two
 * buckets rather than one because sharing would double-count every legitimate
 * question — the route would call `checkRateLimit`, then this would count it
 * again — and a limit that halves itself for correct callers is a bug that
 * looks like a policy.
 *
 * @param query - the reader's question. 1–500 characters.
 * @param identifierHash - salted lowercase hex SHA-256 of the caller. Required:
 *   an unmetered public action that spends money at OpenAI is not something to
 *   leave to the goodwill of its callers.
 * @param limit - citations wanted, 1–10. Defaults to 5.
 *
 * @returns `RetrieveResult`. Never throws for an ordinary condition — a refusal,
 *   a missing key and an empty index are all reported in the payload, because
 *   the route has to render something honest for each of them. It *does* throw
 *   `ConvexError` for a malformed argument (empty or over-long query, a
 *   non-digest identifier), which is a caller bug rather than a state.
 */
export const retrieve = action({
  args: {
    query: v.string(),
    identifierHash: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<RetrieveResult> => {
    const query = args.query.trim();

    if (query.length === 0) {
      invalid({ code: 'invalid-format', field: 'query', message: 'The question is empty.' });
    }
    if (query.length > MAX_QUERY_CHARS) {
      invalid({
        code: 'out-of-range',
        field: 'query',
        message: `Questions are capped at ${MAX_QUERY_CHARS} characters (got ${query.length}).`,
      });
    }

    const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const hasKey = (process.env.OPENAI_API_KEY ?? '').length > 0;

    const rateLimit: RateLimitDecision = await ctx.runMutation(internal.ask.consume, {
      bucket: 'ask-retrieve',
      identifierHash: args.identifierHash,
    });

    if (!rateLimit.allowed) {
      return {
        ok: false,
        rateLimit,
        // Nothing ran, so nothing was read — `corpus` is null rather than a
        // guess, and the mode is what a permitted call would have used.
        retrievalMode: hasKey ? 'vector' : 'lexical',
        degraded: !hasKey,
        reason: 'rate-limited',
        embeddingModel: null,
        corpus: null,
        results: [],
      };
    }

    const corpus: { published: number; embedded: number } = await ctx.runQuery(
      internal.ask.corpusStats,
      {},
    );
    const terms = queryTerms(query);

    /* ---- the vector path ------------------------------------------ */

    if (hasKey && corpus.embedded > 0) {
      const embedded = await embed(query);

      if (embedded.ok) {
        const hits = await ctx.vectorSearch('knowledgeDocs', 'by_embedding', {
          vector: embedded.embedding,
          limit,
          filter: (q) => q.eq('published', true),
        });

        if (hits.length > 0) {
          const docs: IndexedDoc[] = await ctx.runQuery(internal.ask.citationsByIds, {
            ids: hits.map((hit) => hit._id),
          });

          // By identity, not by position — see the note on `IndexedDoc.docId`.
          const scores = new Map(hits.map((hit) => [hit._id as string, hit._score]));

          return {
            ok: true,
            rateLimit,
            retrievalMode: 'vector',
            degraded: false,
            reason: null,
            embeddingModel: EMBEDDING_MODEL,
            corpus,
            results: docs.map((doc) =>
              toCitation(doc, terms, scores.get(doc.docId) ?? null),
            ),
          };
        }

        // Searched, found nothing. Ask the lexical index before giving up.
        return await lexicalResult(ctx, query, terms, limit, {
          rateLimit,
          reason: 'vector-no-match',
          corpus,
        });
      }

      // The provider refused or was unreachable. Logged at error level because,
      // unlike `no-key`, this one wants somebody's attention.
      console.error(
        `ask: query not embedded (${embedded.reason}: ${embedded.detail}) — falling back to lexical`,
      );
      return await lexicalResult(ctx, query, terms, limit, {
        rateLimit,
        reason: 'embed-failed',
        corpus,
      });
    }

    /* ---- the lexical path ----------------------------------------- */

    return await lexicalResult(ctx, query, terms, limit, {
      rateLimit,
      // A key with an empty index is a *different problem* from no key: one is
      // "set OPENAI_API_KEY", the other is "run the backfill". Saying which
      // saves the operator a debugging session.
      reason: hasKey ? 'empty-vector-index' : 'no-key',
      corpus,
    });
  },
});

/**
 * Run the lexical half and shape the result. The single place `'lexical'` is
 * claimed, so the mode and the ranking can never disagree.
 *
 * A plain function rather than a second action: `retrieve` reaches it on four
 * different paths, and `ctx.runAction` on each would pay a full function
 * dispatch to avoid a local call.
 */
async function lexicalResult(
  ctx: ActionCtx,
  query: string,
  terms: string[],
  limit: number,
  rest: {
    rateLimit: RateLimitDecision;
    reason: RetrievalReason;
    corpus: { published: number; embedded: number };
  },
): Promise<RetrieveResult> {
  /* De-noised where possible, verbatim where not. A query made entirely of
     noise words ("what is this about?") has nothing to search for, and sending
     the empty string would match nothing at all — the raw query at least
     returns the documents those words appear in, which is a poor answer rather
     than a missing one. See `NOISE_WORDS`. */
  const text = terms.length > 0 ? terms.join(' ') : query;

  const docs: IndexedDoc[] = await ctx.runQuery(internal.ask.lexicalSearch, {
    text,
    limit,
  });

  return {
    ok: true,
    rateLimit: rest.rateLimit,
    retrievalMode: 'lexical',
    degraded: true,
    reason: rest.reason,
    embeddingModel: null,
    corpus: rest.corpus,
    results: docs.map((doc) => toCitation(doc, terms, null)),
  };
}
