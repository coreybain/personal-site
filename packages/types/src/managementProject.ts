import * as z from 'zod';
import { ProjectSchema } from './content';
import { CountSchema, IsoDateTimeSchema } from './primitives';

/** Private editorial version; placement and collector statistics stay on the base row. */
export const ManagementProjectDraftSchema = ProjectSchema.omit({
  published: true, featured: true, sortOrder: true, aiBuildStats: true, revision: true,
}).extend({
  projectId: z.string().min(1),
  baseRevision: CountSchema,
  revision: CountSchema,
  updatedAt: IsoDateTimeSchema,
});
export type ManagementProjectDraft = z.infer<typeof ManagementProjectDraftSchema>;
