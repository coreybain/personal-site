import * as z from 'zod';
import { PostSchema } from './content';
import { CountSchema, IsoDateTimeSchema } from './primitives';

/** Private staged text and media; publication metadata belongs to the base post. */
export const ManagementPostDraftSchema = PostSchema.omit({
  published: true, publishedAt: true, revision: true,
}).extend({
  postId: z.string().min(1),
  baseRevision: CountSchema,
  revision: CountSchema,
  updatedAt: IsoDateTimeSchema,
});
export type ManagementPostDraft = z.infer<typeof ManagementPostDraftSchema>;
