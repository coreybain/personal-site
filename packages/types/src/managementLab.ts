import * as z from 'zod';
import { LabSchema } from './content';
import { CountSchema, IsoDateTimeSchema } from './primitives';

/** Private editorial content. GitHub statistics and live curation stay on the Lab. */
export const ManagementLabDraftSchema = z.strictObject({
  labId: z.string().min(1),
  baseRevision: CountSchema,
  revision: CountSchema,
  ...LabSchema.pick({
    slug: true, title: true, summary: true, kind: true, repoFullName: true,
    language: true, coverImage: true, links: true,
  }).shape,
  updatedAt: IsoDateTimeSchema,
});
export type ManagementLabDraft = z.infer<typeof ManagementLabDraftSchema>;
