/**
 * knowledge.ts — `knowledgeDocs`, the retrieval corpus behind Ask Corey.
 *
 * ADR 015: Ask Corey is kept and rebuilt on real embeddings. The current
 * implementation on spiritdevs.com is a lexical matcher, which is why it does not
 * survive the rewrite.
 *
 * The corpus is derived, never authored: publishing a project, lab or post
 * re-indexes its row (pipeline 4). Nothing here is hand-edited, so a stale or
 * orphaned row is always safe to delete and rebuild.
 */

import * as z from 'zod';
import {
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  SlugSchema,
  UrlSchema,
} from './primitives';

/**
 * Which table a knowledge doc was derived from.
 *
 * ASSUMPTION — the plan names `sourceType` without enumerating it. Pipeline 4
 * lists "a project, lab, or post"; `resume` is added because the resume document
 * is the single richest answer source for the questions Ask Corey exists to field
 * ("what has he actually built", "how long at Corporate Interactive").
 */
export const KnowledgeSourceTypeSchema = z.enum([
  'project',
  'lab',
  'post',
  'resume',
]);
export type KnowledgeSourceType = z.infer<typeof KnowledgeSourceTypeSchema>;

export const KnowledgeDocSchema = z.object({
  sourceType: KnowledgeSourceTypeSchema,
  /**
   * Slug of the source row. `null` for singletons (`resume`), which have no slug.
   * Together with `sourceType` this is the upsert key for a re-index.
   */
  sourceSlug: SlugSchema.nullable(),
  /** Display title for the citation. */
  title: NonEmptyStringSchema,
  /**
   * Canonical on-site URL for the citation link, e.g. `/work/quotecloud`. Stored
   * as a path rather than an absolute URL so it survives the domain cutover
   * (ADR 017) without a re-index.
   */
  url: z.union([UrlSchema, z.string().startsWith('/')]),
  /**
   * The indexed text: Markdown stripped, front-matter removed, headings kept as
   * plain lines. This is what gets embedded and what gets quoted back, so it must
   * contain only published copy — a draft must never be indexed.
   */
  plainText: NonEmptyStringSchema,
  /**
   * The embedding vector.
   *
   * Length is not constrained here because it is a property of the model, not of
   * the contract, and pinning it would force a schema change to switch models.
   * `embeddingModel` records which model produced it; a mismatch against the
   * currently configured model means the row must be re-indexed before it can be
   * compared against a fresh query vector.
   */
  embedding: z.array(z.number()),
  /** Provider model id, e.g. `'text-embedding-3-small'`. */
  embeddingModel: NonEmptyStringSchema,
  indexedAt: IsoDateTimeSchema,
  /**
   * Mirrors the source row's published state. Retrieval filters on it as a second
   * line of defence: an unpublished row that reached the index must still be
   * unreachable from an answer.
   *
   * OPEN — whether long sources are chunked into several rows is not settled by
   * the plan. If they are, chunk fields are added here rather than in a new
   * table, and this flag continues to apply per chunk.
   */
  published: z.boolean(),
});
export type KnowledgeDoc = z.infer<typeof KnowledgeDocSchema>;
