/**
 * knowledge.ts — the publish-time indexer behind Ask Corey (ADR 015, pipeline 4).
 *
 * Ask Corey in v2 was a lexical matcher over content strings: it answered well
 * only when the asker happened to use the site's own wording. ADR 015 keeps the
 * feature and rebuilds it on embeddings, and this file is the write half of that
 * rebuild. **Phase 6 owns retrieval** — `ctx.vectorSearch`, the hybrid merge with
 * `by_plainText`, citations and rate limiting. Nothing in here reads the index.
 *
 * ── One row per source, keyed on (`sourceType`, `sourceSlug`) ──────────────
 *
 * schema.ts calls that pair "the upsert key for a re-index", and this file takes
 * it literally: publishing, editing or unpublishing a project / lab / post
 * rewrites exactly one `knowledgeDocs` row. The alternative — chunking a case
 * study into several rows sharing the key — is a *retrieval* decision (chunk
 * size trades recall against citation precision) and phase 6 gets to make it
 * against a real evaluation set rather than a guess. `upsert` below already
 * collapses any extra rows sharing a key, so arriving at chunking later cannot
 * be blocked by leftovers from today.
 *
 * ── Degradation is the normal case, not the error case ────────────────────
 *
 * `OPENAI_API_KEY` is **not** set on the dev deployment, and the site launches
 * before phase 6 does. So "no embedding available" is the state this file was
 * written for, not a failure it tolerates:
 *
 *   • No key, a network failure, an HTTP error, a malformed response or a vector
 *     of the wrong length all take the same path — the row is written with
 *     `embedding: []` and `embeddingModel: ''` (`NOT_EMBEDDED`), and the caller
 *     is told which of those happened. Indexing never throws on the provider's
 *     behalf, so a provider outage can never fail a publish.
 *   • An empty array is a **legal, deliberate** value here. Convex's vector index
 *     only contains documents whose vector field holds an array of exactly the
 *     declared dimension ("Only documents that contain a vector of the size and
 *     in the field specified by a vector index will be included in the index" —
 *     docs.convex.dev/search/vector-search), so a `[]` row is silently absent
 *     from `by_embedding` and fully present in the `by_plainText` search index.
 *     That is the whole trick: **the lexical half of retrieval works today**, and
 *     the vector half switches on the moment a key exists.
 *   • `embeddingModel: ''` is the backfill signal. schema.ts documents that field
 *     as "a row whose model does not match the currently configured one must be
 *     re-indexed"; the empty string matches no model, so phase 6's first act —
 *     `bunx convex run knowledge:backfill` with a key set — re-embeds everything
 *     without needing a migration or a nullable column.
 *
 * ── Privacy (ADR 008) ─────────────────────────────────────────────────────
 *
 * Everything indexed here is text that is **already rendered on a public page**
 * of this site: a case study's own narrative, a Lab's summary and its curated
 * public repo (`repoFullName` is an ADR 014 allowlist entry whose repo URL is a
 * link on `/labs`), a post's body. Nothing is read from a private repo, a file
 * path, an agent transcript or the ingest tables. The rule the git pipeline
 * lives under — no private repo name in any public response — holds here for
 * free, because an answer can only quote a `plainText` built from public rows.
 *
 * ⚠️ Anything added to `sourceForIndex` becomes quotable by Ask Corey. Read that
 * function's header before adding a field to it.
 *
 * ── Runtime ───────────────────────────────────────────────────────────────
 *
 * No `'use node'`. The only Node-shaped thing this file needs is `fetch`, which
 * the default Convex runtime gives an action (docs.convex.dev/functions/runtimes)
 * — and the default runtime starts faster and is the rest of the package's
 * baseline. Actions cannot touch `ctx.db`, so every database access below goes
 * through the internal query and mutations in this same file.
 *
 * ── The surface, and who calls what ───────────────────────────────────────
 *
 *   `indexSource`         internalAction   — the publish hook. Scheduled with
 *                                            `runAfter(0, …)` from projects.ts,
 *                                            labs.ts and posts.ts.
 *   `backfill`            internalAction   — `bunx convex run knowledge:backfill`.
 *   `setSourcePublished`  internalMutation — the unpublish hook. No embedding
 *                                            call, so no action needed.
 *   `removeSource`        internalMutation — the delete hook, and the rename
 *                                            hook (drops the old key).
 *   `sourceForIndex`      internalQuery    — reads the row and builds the text.
 *   `sourceKeys`          internalQuery    — every indexable key, for `backfill`.
 *   `upsert`              internalMutation — the single writer of `knowledgeDocs`.
 *
 * Everything is `internal*`: there is no public function in this file, because
 * there is no caller for one. Indexing is a consequence of an admin write, never
 * a request.
 *
 * `sourceType: 'resume'` is in the schema's union and is deliberately not
 * handled here — the resume is a singleton with `sourceSlug: null` and its own
 * shape, and it belongs to phase 5's PDF work. `KNOWLEDGE_SOURCE_TYPES` below is
 * the narrower set this file understands.
 */

import { v } from 'convex/values';
import { internal } from './_generated/api';
import {
  type ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
} from './_generated/server';
import { nowIso } from './lib/validate';

/* ------------------------------------------------------------------ *
 * Validators the schema does not export
 *
 * `knowledgeDocs.sourceType` is declared inline in schema.ts and has no
 * exported name (same situation labs.ts documents for `labs.links`). It
 * is mirrored here minus `'resume'` — see the file header. A literal
 * added there and not here is a source this file cannot index.
 * ------------------------------------------------------------------ */

/** The three publishable, slugged collections. A subset of the schema's union. */
const knowledgeSourceType = v.union(
  v.literal('project'),
  v.literal('lab'),
  v.literal('post'),
);

type KnowledgeSourceType = 'project' | 'lab' | 'post';

/** One indexable document's identity — the `by_source` key. */
type SourceKey = { sourceType: KnowledgeSourceType; sourceSlug: string };

/* ------------------------------------------------------------------ *
 * Embedding provider
 * ------------------------------------------------------------------ */

/**
 * The model schema.ts's `by_embedding` index was sized for.
 *
 * ⚠️ Changing this means changing `dimensions` on the vector index AND
 * re-embedding every row — which is exactly what `embeddingModel` exists to make
 * detectable. Do not change one without the other.
 */
export const EMBEDDING_MODEL = 'text-embedding-3-small';

/** Must equal `knowledgeDocs.by_embedding.dimensions` in schema.ts. */
const EMBEDDING_DIMENSIONS = 1536;

/**
 * The `embeddingModel` value on a row that has no vector.
 *
 * The empty string is not a placeholder for "unknown" — it is an assertion that
 * this row matches no configured model and must be re-indexed before its vector
 * can be trusted. See the file header.
 */
const NOT_EMBEDDED = '';

/**
 * Character ceiling on what is sent to the embeddings API.
 *
 * `text-embedding-3-small` accepts 8,191 tokens. English prose runs roughly four
 * characters per token, so 24,000 characters sits comfortably inside that with
 * room for the code identifiers and stack lists that tokenise worse than prose.
 * A case study long enough to hit this would be a chunking problem, which is
 * phase 6's (see the file header) — truncating is the honest interim behaviour,
 * and the *full* text is still stored and still searchable lexically.
 */
const MAX_EMBED_CHARS = 24_000;

/** OpenAI's embeddings endpoint. The only external call this file makes. */
const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';

/**
 * Why a row ended up without a vector. Reported, never thrown.
 *
 * `'no-key'` is the expected value today and is not an error; the other four
 * are, and they are kept distinct because they need different responses — a key
 * to be set, a retry, a provider bug report, or a dimension mismatch that means
 * the schema and this file have drifted.
 */
export type NotEmbeddedReason =
  | 'no-key'
  | 'request-failed'
  | 'http-error'
  | 'bad-response'
  | 'wrong-dimensions';

export type EmbedResult =
  | { ok: true; embedding: number[] }
  | { ok: false; reason: NotEmbeddedReason; detail: string };

/**
 * Embed one string, or explain why not.
 *
 * Never throws. Every failure mode — including a thrown `fetch` — is converted
 * into `{ ok: false }`, because the caller's correct response to all of them is
 * identical: write the row without a vector and carry on. A publish must not
 * depend on OpenAI being up.
 *
 * The response is validated rather than cast. A provider that changes its
 * response shape, returns an error object with a 200, or returns a vector of the
 * wrong length would otherwise put a value into `embedding` that Convex accepts
 * (it is only `v.array(v.float64())`) and the vector index silently ignores —
 * a row that looks embedded, is not, and never gets re-indexed because its
 * `embeddingModel` matches. That bug is worth the twenty lines to prevent.
 *
 * **Exported for `ask.ts` (phase 6).** A query and a document must be embedded
 * by the same model, through the same request shape, with the same validation —
 * a second implementation in the retrieval file would be two ways of producing
 * vectors that are then compared against each other, which is the one place a
 * subtle difference is guaranteed to matter. Retrieval imports this rather than
 * copying it, and `EMBEDDING_MODEL` above stays the single declaration of which
 * model the index holds.
 */
export async function embed(text: string): Promise<EmbedResult> {
  const apiKey = process.env.OPENAI_API_KEY;

  // The expected branch on this deployment. See the file header.
  if (apiKey === undefined || apiKey.length === 0) {
    return { ok: false, reason: 'no-key', detail: 'OPENAI_API_KEY is not set' };
  }

  let response: Response;
  try {
    response = await fetch(OPENAI_EMBEDDINGS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: text.slice(0, MAX_EMBED_CHARS),
      }),
    });
  } catch (error) {
    return {
      ok: false,
      reason: 'request-failed',
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  if (!response.ok) {
    // The status alone. The body of an OpenAI error can echo request content,
    // and this string is returned to a CLI and written to Convex's logs.
    return {
      ok: false,
      reason: 'http-error',
      detail: `HTTP ${response.status}`,
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    return {
      ok: false,
      reason: 'bad-response',
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  const data = (payload as { data?: unknown }).data;
  const first = Array.isArray(data) ? (data[0] as { embedding?: unknown }) : undefined;
  const vector = first?.embedding;

  if (!Array.isArray(vector) || !vector.every((n) => typeof n === 'number')) {
    return { ok: false, reason: 'bad-response', detail: 'no numeric embedding in response' };
  }

  if (vector.length !== EMBEDDING_DIMENSIONS) {
    return {
      ok: false,
      reason: 'wrong-dimensions',
      detail: `got ${vector.length}, schema declares ${EMBEDDING_DIMENSIONS}`,
    };
  }

  return { ok: true, embedding: vector as number[] };
}

/* ------------------------------------------------------------------ *
 * Markdown → plain text
 *
 * `knowledgeDocs.plainText` is documented as "chunk text, stripped of
 * markup. What gets embedded and quoted." Both halves of that sentence
 * are reasons to strip: a `##` or a `](https://…)` in the input wastes
 * embedding tokens on punctuation, and the same string is what a
 * citation quotes back to a reader, where raw markdown reads as a bug.
 * ------------------------------------------------------------------ */

/**
 * Drop fenced code blocks entirely — content included.
 *
 * Line-based rather than a regex with a backreference, because the regex form
 * silently keeps an *unterminated* fence's contents, and "the last code block in
 * the file leaks into the answer" is not a failure anyone would notice in
 * review. Here an unclosed fence swallows the rest of the input, which is the
 * safe direction to fail.
 *
 * Removing rather than flattening is deliberate: a snippet's identifiers are
 * terrible retrieval signal (they match every question containing a common
 * word) and a quoted half-line of code makes a bad citation.
 */
function stripFencedCode(markdown: string): string {
  const kept: string[] = [];
  /** The fence character currently open — '`' or '~' — or null outside a block. */
  let openFence: string | null = null;

  for (const line of markdown.split('\n')) {
    const fence = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line);

    if (openFence === null) {
      if (fence !== null) {
        openFence = fence[1][0];
        continue;
      }
      kept.push(line);
      continue;
    }

    // Inside a block: only a fence of the same character closes it, and every
    // other line is discarded.
    if (fence !== null && fence[1][0] === openFence) {
      openFence = null;
    }
  }

  return kept.join('\n');
}

/**
 * Inline and block markup, in an order where each rule sees clean input.
 *
 * Order is load-bearing in three places:
 *   • images before links — `![alt](url)` also matches the link pattern, and
 *     matching it as a link would leave a stray `!`.
 *   • horizontal rules before list markers — `---` is a rule, but the list rule
 *     would eat its first `-` and leave `--`.
 *   • bold before italic — `**x**` matched by the single-delimiter rule first
 *     would leave `*x*`.
 */
const MARKUP_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  /** Raw HTML tags. Their text content is kept. */
  [/<\/?[A-Za-z][^>]*>/g, ''],
  /** `![alt](url)` → `alt`. The URL is never useful to quote. */
  [/!\[([^\]]*)\]\([^)]*\)/g, '$1'],
  /** `[text](url)` → `text`. */
  [/\[([^\]]*)\]\([^)]*\)/g, '$1'],
  /** Reference links `[text][ref]` → `text`. */
  [/\[([^\]]*)\]\[[^\]]*\]/g, '$1'],
  /** Inline code — the backticks go, the identifier stays (it is real prose). */
  [/`([^`\n]*)`/g, '$1'],
  /** ATX headings `## Title` → `Title`. */
  [/^[ \t]{0,3}#{1,6}[ \t]+/gm, ''],
  /** Blockquote markers. */
  [/^[ \t]{0,3}>[ \t]?/gm, ''],
  /** Setext underlines and thematic breaks: `===`, `---`, `***`, `___`. */
  [/^[ \t]{0,3}(?:={3,}|(?:[-*_][ \t]*){3,})[ \t]*$/gm, ''],
  /** List markers, ordered and unordered. The item text stays on its own line. */
  [/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, ''],
  /** Bold. */
  [/(\*\*|__)(.+?)\1/g, '$2'],
  /** Italic — `(?=\S)` so `a_b_c` in an identifier survives. */
  [/(\*|_)(?=\S)([^*_]+?)\1/g, '$2'],
  /** Strikethrough. */
  [/~~(.+?)~~/g, '$1'],
];

/**
 * Markdown (or plain prose) in, quotable plain text out.
 *
 * Idempotent on text that contains no markup, which matters because most fields
 * fed through it — `summary`, `client`, an outcome bullet — are already plain.
 * Whitespace is normalised last so the rules above can leave blank lines behind
 * without producing gaps in the output.
 */
function toPlainText(input: string): string {
  let text = stripFencedCode(input.replace(/\r\n?/g, '\n'));

  for (const [pattern, replacement] of MARKUP_RULES) {
    text = text.replace(pattern, replacement);
  }

  return (
    text
      // Runs of spaces and tabs (including markdown's leading indentation).
      .replace(/[ \t]+/g, ' ')
      // Trailing/leading space around every newline.
      .replace(/ ?\n ?/g, '\n')
      // At most one blank line between paragraphs.
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/**
 * Join the parts of a document, dropping the ones that are absent or empty.
 *
 * Optional fields are the normal case (`period`, `problem`, `body` are all
 * optional on a project), and an empty line in the middle of the text would be
 * embedded and quoted just like a real one.
 */
function joinSections(sections: ReadonlyArray<string | undefined | null>): string {
  return sections
    .map((section) => (section === undefined || section === null ? '' : toPlainText(section)))
    .filter((section) => section.length > 0)
    .join('\n\n');
}

/**
 * Render a labelled list as one line: `Outcomes: a; b; c`.
 *
 * Semicolons rather than newlines-with-bullets, because a bullet character is
 * exactly the markdown artefact `toPlainText` just removed, and a citation
 * quoting three outcomes reads better as a sentence than as a fragment of list.
 */
function labelledList(label: string, items: ReadonlyArray<string> | undefined): string | null {
  if (items === undefined) return null;
  const cleaned = items.map((item) => item.trim()).filter((item) => item.length > 0);
  if (cleaned.length === 0) return null;
  return `${label}: ${cleaned.join('; ')}`;
}

/* ------------------------------------------------------------------ *
 * Reads — actions cannot touch ctx.db, so the row load and the text
 * assembly both live in a query.
 * ------------------------------------------------------------------ */

/** What the indexer needs about a source row, and nothing else. */
type IndexableSource = {
  title: string;
  url: string;
  plainText: string;
  published: boolean;
};

/**
 * Load one source row and render it as a knowledge document.
 *
 * ⚠️ **This function decides what Ask Corey can quote.** Every string it returns
 * in `plainText` may appear verbatim in an answer on a public page, so a field
 * added here must be one that is already published on the site (ADR 008 — see
 * the file header). Two fields are excluded on purpose:
 *
 *   • `labs.liveStats` — stars, forks, commit counts. Rewritten hourly by the
 *     git cron, so embedding them would make every row permanently stale and
 *     every backfill a full re-embed. Live numbers belong on the page, not in
 *     the index.
 *   • `projects.media` / `posts.coverImage` — CDN URLs and alt text. A URL is
 *     noise to embed and worse to quote.
 *
 * `url` is a **path**, not an absolute URL, exactly as schema.ts requires: the
 * domain cutover (ADR 017) must not invalidate the index.
 *
 * Returns `null` when the row is gone, which is a real state — the action races
 * a delete every time a publish is followed quickly by a remove.
 */
export const sourceForIndex = internalQuery({
  args: {
    sourceType: knowledgeSourceType,
    sourceSlug: v.string(),
  },
  handler: async (ctx, args): Promise<IndexableSource | null> => {
    // Three separate reads rather than one `ctx.db.query(TABLE[type])`. All
    // three tables do carry a `by_slug` index over the same field name, so the
    // table-name-in-a-variable version compiles — but its result is the *union*
    // of three documents, and every field access below would then need a cast.
    // A `switch` makes each branch genuinely narrowed, which is what catches a
    // field renamed in schema.ts at `tsc` time instead of at answer time.
    switch (args.sourceType) {
      case 'project': {
        const doc = await ctx.db
          .query('projects')
          .withIndex('by_slug', (q) => q.eq('slug', args.sourceSlug))
          .unique();
        if (doc === null) return null;

        return {
          title: doc.title,
          url: `/work/${doc.slug}`,
          published: doc.published,
          plainText: joinSections([
            doc.title,
            // Attribution ≠ ownership (glossary, ADR 008). "Built at X" is the
            // line the case study page itself renders, and an answer that drops
            // it would be claiming the work as solo.
            `${doc.role}, ${doc.client}${doc.period === undefined ? '' : ` (${doc.period})`}`,
            doc.attribution,
            doc.summary,
            doc.problem === undefined ? null : `Problem: ${doc.problem}`,
            doc.approach === undefined ? null : `Approach: ${doc.approach}`,
            labelledList('Outcomes', doc.outcomes),
            doc.body,
            labelledList('Stack', doc.stack),
          ]),
        };
      }

      case 'lab': {
        const doc = await ctx.db
          .query('labs')
          .withIndex('by_slug', (q) => q.eq('slug', args.sourceSlug))
          .unique();
        if (doc === null) return null;

        return {
          title: doc.title,
          url: '/labs',
          published: doc.published,
          plainText: joinSections([
            doc.title,
            doc.summary,
            // ADR 014: Labs are a curated allowlist of public repos, and this
            // name is already a link on /labs. It is indexed because "which repo
            // is Boca?" is a question a reader actually asks.
            `Repository: ${doc.repoFullName}`,
            `Language: ${doc.language}`,
          ]),
        };
      }

      case 'post': {
        const doc = await ctx.db
          .query('posts')
          .withIndex('by_slug', (q) => q.eq('slug', args.sourceSlug))
          .unique();
        if (doc === null) return null;

        return {
          title: doc.title,
          url: `/blog/${doc.slug}`,
          published: doc.published,
          plainText: joinSections([
            doc.title,
            doc.excerpt,
            doc.body,
            labelledList('Tags', doc.tags),
          ]),
        };
      }
    }
  },
});

/**
 * Every indexable (`sourceType`, `sourceSlug`) pair on the deployment.
 *
 * Drafts included. `backfill` mirrors the *whole* corpus rather than only what
 * is public, because `knowledgeDocs.published` is a filter, not a membership
 * test — schema.ts calls it "a second line of defence" — and an index that only
 * ever holds published rows would have no state to fall back on when a row is
 * unpublished. See `indexOne`, which is where the draft/published distinction
 * actually costs something (an embedding call).
 *
 * Full table scans of three small collections. If the blog ever grows past a few
 * hundred posts this wants pagination; today it is tens of rows.
 */
export const sourceKeys = internalQuery({
  args: {},
  // The return type is annotated rather than inferred because `backfill` in this
  // same file calls this through `internal.knowledge.sourceKeys`, and inference
  // would then have to resolve this module's `internal` object while it is still
  // being typed — a circularity TypeScript reports as an implicit `any`.
  handler: async (ctx): Promise<SourceKey[]> => {
    const projects = await ctx.db.query('projects').collect();
    const labs = await ctx.db.query('labs').collect();
    const posts = await ctx.db.query('posts').collect();

    return [
      ...projects.map((row) => ({ sourceType: 'project' as const, sourceSlug: row.slug })),
      ...labs.map((row) => ({ sourceType: 'lab' as const, sourceSlug: row.slug })),
      ...posts.map((row) => ({ sourceType: 'post' as const, sourceSlug: row.slug })),
    ];
  },
});

/* ------------------------------------------------------------------ *
 * Writes — the only three functions that touch `knowledgeDocs`.
 * ------------------------------------------------------------------ */

/**
 * Write (or rewrite) the knowledge document for one source. The single writer.
 *
 * Upsert on `by_source`, and it collapses rather than assumes: every row sharing
 * the key is collected, the first is patched, the rest are deleted. Two things
 * make that worth doing instead of `.unique()`:
 *
 *   • `by_source` is a plain index, not a uniqueness constraint. Nothing in
 *     Convex prevents a second row, and `.unique()` would *throw* on one —
 *     turning a duplicate into a permanently failing publish hook.
 *   • If phase 6 does adopt chunking (see the file header), this is what stops
 *     the old single row, or an old longer chunk list, from surviving underneath
 *     the new one.
 *
 * The whole document is rewritten, including `embedding`. A failed embed
 * therefore *replaces* a previously good vector with `[]`. That is intentional:
 * the vector describes the text, the text just changed, and a stale vector
 * retrieving the new text on the old meaning is a wrong answer with a citation
 * attached. `[]` is merely an absent answer, and `embeddingModel: ''` makes it
 * self-repairing on the next backfill.
 */
export const upsert = internalMutation({
  args: {
    sourceType: knowledgeSourceType,
    sourceSlug: v.string(),
    title: v.string(),
    url: v.string(),
    plainText: v.string(),
    embedding: v.array(v.float64()),
    embeddingModel: v.string(),
    published: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('knowledgeDocs')
      .withIndex('by_source', (q) =>
        q.eq('sourceType', args.sourceType).eq('sourceSlug', args.sourceSlug),
      )
      .collect();

    const fields = {
      sourceType: args.sourceType,
      sourceSlug: args.sourceSlug,
      title: args.title,
      url: args.url,
      plainText: args.plainText,
      embedding: args.embedding,
      embeddingModel: args.embeddingModel,
      indexedAt: nowIso(),
      published: args.published,
    };

    if (existing.length === 0) {
      const docId = await ctx.db.insert('knowledgeDocs', fields);
      return { docId, created: true, collapsed: 0 };
    }

    const [keep, ...duplicates] = existing;
    await ctx.db.patch(keep._id, fields);
    for (const duplicate of duplicates) {
      await ctx.db.delete(duplicate._id);
    }

    return { docId: keep._id, created: false, collapsed: duplicates.length };
  },
});

/**
 * Mirror a source's `published` flag onto its knowledge document(s).
 *
 * The cheap half of the pipeline, and the reason `unpublish` needs no action:
 * hiding a page changes no text, so there is nothing to re-embed. Flipping the
 * flag is enough — retrieval filters on `published`, so the row stops being
 * reachable in the same tick while its vector and text stay put for the moment
 * it is published again.
 *
 * Zero rows is a success, not an error: a source that has never been indexed
 * (published before this file existed, or a draft that was never public) has
 * nothing to hide. Returning the count instead of throwing keeps `unpublish`
 * from failing on a perfectly ordinary state.
 */
export const setSourcePublished = internalMutation({
  args: {
    sourceType: knowledgeSourceType,
    sourceSlug: v.string(),
    published: v.boolean(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('knowledgeDocs')
      .withIndex('by_source', (q) =>
        q.eq('sourceType', args.sourceType).eq('sourceSlug', args.sourceSlug),
      )
      .collect();

    let updated = 0;
    for (const row of rows) {
      if (row.published === args.published) continue;
      await ctx.db.patch(row._id, { published: args.published, indexedAt: nowIso() });
      updated += 1;
    }

    return { matched: rows.length, updated };
  },
});

/**
 * Delete every knowledge document for a source key.
 *
 * Two callers, and they are the two situations a re-index cannot repair because
 * there is no source left to read:
 *
 *   • `remove` on any of the three modules — the row is gone.
 *   • `update` when the slug changed — the row still exists, but under a new
 *     key, and the old key's document would otherwise sit in the index forever
 *     citing a URL that now 404s. The rename hook removes the old key and
 *     indexes the new one.
 *
 * Idempotent; deleting nothing succeeds.
 */
export const removeSource = internalMutation({
  args: {
    sourceType: knowledgeSourceType,
    sourceSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('knowledgeDocs')
      .withIndex('by_source', (q) =>
        q.eq('sourceType', args.sourceType).eq('sourceSlug', args.sourceSlug),
      )
      .collect();

    for (const row of rows) {
      await ctx.db.delete(row._id);
    }

    return { deleted: rows.length };
  },
});

/* ------------------------------------------------------------------ *
 * Actions — load, embed, write.
 * ------------------------------------------------------------------ */

/** What happened to one source. Returned per-source, aggregated by `backfill`. */
type IndexOutcome = {
  sourceType: KnowledgeSourceType;
  sourceSlug: string;
  /** `'indexed'` wrote a row; `'removed'` found no source and pruned the key. */
  result: 'indexed' | 'removed';
  /** True only when a real 1536-dimension vector was stored. */
  embedded: boolean;
  /** Why not, when `embedded` is false. `'draft'` means it was never attempted. */
  reason: NotEmbeddedReason | 'draft' | 'source-missing' | null;
  /** Character length of `plainText` — the cheap sanity check on a backfill. */
  textLength: number;
};

/**
 * Index one source, end to end. The shared body of `indexSource` and `backfill`.
 *
 * A plain function rather than an action calling an action: `backfill` runs this
 * once per source, and `ctx.runAction` per source would pay a full function
 * dispatch for each, on top of the query and mutation this already does.
 *
 * **Drafts are indexed but not embedded.** The row is written so the index
 * always mirrors the corpus (see `sourceKeys`), and `published: false` keeps it
 * unreachable — but there is no reason to pay an embedding call for text nobody
 * can be shown. `publish` re-runs this, which is when the vector gets made.
 */
async function indexOne(
  ctx: ActionCtx,
  sourceType: KnowledgeSourceType,
  sourceSlug: string,
): Promise<IndexOutcome> {
  // Annotated: a reference into this module's own `internal` object resolves to
  // `any` while the module is being typed (see `sourceKeys`), and everything
  // below reads fields off this value.
  const source: IndexableSource | null = await ctx.runQuery(
    internal.knowledge.sourceForIndex,
    { sourceType, sourceSlug },
  );

  // The source was deleted between the schedule and the run, or `backfill` is
  // racing an admin. Either way the index must not keep citing it.
  if (source === null) {
    await ctx.runMutation(internal.knowledge.removeSource, { sourceType, sourceSlug });
    return {
      sourceType,
      sourceSlug,
      result: 'removed',
      embedded: false,
      reason: 'source-missing',
      textLength: 0,
    };
  }

  let embedding: number[] = [];
  let embeddingModel = NOT_EMBEDDED;
  let reason: IndexOutcome['reason'] = 'draft';

  if (source.published) {
    const result = await embed(source.plainText);
    if (result.ok) {
      embedding = result.embedding;
      embeddingModel = EMBEDDING_MODEL;
      reason = null;
    } else {
      // Logged, not thrown. `'no-key'` is the expected state on this deployment
      // and would be noise at `error` level; the rest are real and should be
      // findable in the Convex dashboard's logs.
      const line = `knowledge: ${sourceType}/${sourceSlug} not embedded (${result.reason}: ${result.detail})`;
      if (result.reason === 'no-key') console.log(line);
      else console.error(line);
      reason = result.reason;
    }
  }

  await ctx.runMutation(internal.knowledge.upsert, {
    sourceType,
    sourceSlug,
    title: source.title,
    url: source.url,
    plainText: source.plainText,
    embedding,
    embeddingModel,
    published: source.published,
  });

  return {
    sourceType,
    sourceSlug,
    result: 'indexed',
    embedded: embedding.length > 0,
    reason,
    textLength: source.plainText.length,
  };
}

/**
 * (Re)index one source. **This is the publish hook.**
 *
 * Scheduled with `ctx.scheduler.runAfter(0, internal.knowledge.indexSource, …)`
 * from `publish`, `update` and (for the new slug) the rename path in projects.ts,
 * labs.ts and posts.ts. It cannot be called inline from those mutations for the
 * plainest possible reason — embedding needs `fetch`, and a mutation cannot
 * `fetch`. Scheduling is also what makes a provider outage delay the index
 * rather than fail the publish.
 *
 * `runAfter(0, …)` schedules the action **as part of the mutation's
 * transaction**: if the publish is rolled back, the indexing job is never
 * created. That is the property that makes this hook safe to place before the
 * mutation's `return`.
 *
 * Safe to call for a slug that does not exist — it prunes instead.
 */
export const indexSource = internalAction({
  args: {
    sourceType: knowledgeSourceType,
    sourceSlug: v.string(),
  },
  handler: async (ctx, args): Promise<IndexOutcome> => {
    return await indexOne(ctx, args.sourceType, args.sourceSlug);
  },
});

/**
 * Index the whole corpus. Operational tool, run by hand:
 *
 * ```sh
 * cd packages/convex
 * bunx convex run knowledge:backfill '{}'
 * bunx convex run knowledge:backfill '{"sourceTypes":["post"]}'
 * ```
 *
 * Three occasions call for it, and they are all "the index and the corpus have
 * drifted", never routine operation — the publish hooks keep it current:
 *
 *   1. **Now.** Rows published before this file existed have no document.
 *   2. **When `OPENAI_API_KEY` is first set** (phase 6). Every row is holding
 *      `embedding: []` / `embeddingModel: ''`; one backfill embeds the lot.
 *   3. **After a model change.** Changing `EMBEDDING_MODEL` and the schema's
 *      `dimensions` invalidates every stored vector.
 *
 * Sequential rather than parallel. The corpus is tens of rows, OpenAI rate-limits
 * per minute, and a `Promise.all` over the whole corpus would turn a rate-limit
 * into a partial backfill that reports success for rows it did not embed.
 *
 * Returns per-source outcomes as well as the counts, so a run that indexed
 * everything but embedded nothing is visible rather than reported as "12 ok".
 */
export const backfill = internalAction({
  args: {
    /** Restrict the run. Omitted ⇒ all three. */
    sourceTypes: v.optional(v.array(knowledgeSourceType)),
  },
  handler: async (ctx, args) => {
    // Annotated for the same reason `sourceKeys` annotates its handler: a
    // function referencing its own module through `internal` gets `any` back,
    // and an unannotated `any` here would silently disable every check below.
    const keys: SourceKey[] = await ctx.runQuery(internal.knowledge.sourceKeys, {});
    const wanted =
      args.sourceTypes === undefined
        ? keys
        : keys.filter((key) => args.sourceTypes?.includes(key.sourceType));

    const outcomes: IndexOutcome[] = [];
    for (const key of wanted) {
      outcomes.push(await indexOne(ctx, key.sourceType, key.sourceSlug));
    }

    return {
      total: outcomes.length,
      indexed: outcomes.filter((o) => o.result === 'indexed').length,
      removed: outcomes.filter((o) => o.result === 'removed').length,
      embedded: outcomes.filter((o) => o.embedded).length,
      /**
       * Not an error count. `notEmbedded` equals `indexed` on a deployment with
       * no `OPENAI_API_KEY`, which is the expected result today — check
       * `reasons` to tell that apart from a provider problem.
       */
      notEmbedded: outcomes.filter((o) => o.result === 'indexed' && !o.embedded).length,
      reasons: outcomes.reduce<Record<string, number>>((acc, o) => {
        if (o.reason === null) return acc;
        acc[o.reason] = (acc[o.reason] ?? 0) + 1;
        return acc;
      }, {}),
      outcomes,
    };
  },
});
