/**
 * resume.ts — `resumeDocument` (singleton) and `experienceEntries` (table).
 *
 * Glossary: the **Resume Document** is the single record from which both the web
 * resume and the `@react-pdf/renderer` PDF are produced (ADR 011). One source of
 * truth, two renderers — there is no PDF that can disagree with the page.
 *
 * DIVERGENCE — the plan lists two overlapping things, and both are modelled:
 *
 *   experienceEntries   normalised, admin-editable, ISO dates, `skills[]`,
 *                       `sortOrder`. This is what CRUD writes.
 *   resumeDocument.experience[]
 *                       the render-ready projection embedded in the singleton,
 *                       with free-form `start` / `end` strings ('2022',
 *                       'Present'). This is the shape apps/web already reads.
 *
 * The projection is rebuilt whenever an entry changes, so the web resume, the
 * PDF and the /about page always render byte-identical text. Do not edit the
 * projection directly.
 */

import * as z from 'zod';
import {
  IsoDateSchema,
  NonEmptyStringSchema,
  SlugSchema,
  SortOrderSchema,
} from './primitives';

/* ------------------------------------------------------------------ *
 * experienceEntries — the normalised source
 * ------------------------------------------------------------------ */

export const ExperienceEntrySchema = z.object({
  company: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  startDate: IsoDateSchema,
  /** `null` for the current role. Sorting and duration maths both rely on this. */
  endDate: IsoDateSchema.nullable(),
  summary: NonEmptyStringSchema,
  /** Achievement lines. Rendered as a list in both the page and the PDF. */
  highlights: z.array(NonEmptyStringSchema),
  /** Skills exercised in this role. Feeds the resume's capability clustering. */
  skills: z.array(NonEmptyStringSchema),
  sortOrder: SortOrderSchema,
  /**
   * Optional link to a case study covering this role's work, so the resume can
   * point at /work/[slug] instead of restating it.
   */
  projectSlugs: z.array(SlugSchema).optional(),
});
export type ExperienceEntry = z.infer<typeof ExperienceEntrySchema>;

/* ------------------------------------------------------------------ *
 * resumeDocument — the singleton
 * ------------------------------------------------------------------ */

/**
 * One role as the resume renders it.
 *
 * `start` and `end` are free-form and printed verbatim — `'2022'`, `'Mar 2018'`,
 * `'Present'`. A resume states periods the way a human writes them; the machine-
 * comparable dates live on `ExperienceEntrySchema`.
 */
export const ResumeRoleSchema = z.object({
  company: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  start: NonEmptyStringSchema,
  /** `'Present'` for the current role. */
  end: NonEmptyStringSchema,
  summary: NonEmptyStringSchema,
  highlights: z.array(NonEmptyStringSchema),
  /** Carried through from the source entry. Absent on older projections. */
  skills: z.array(NonEmptyStringSchema).optional(),
});
export type ResumeRole = z.infer<typeof ResumeRoleSchema>;

export const ResumeEducationSchema = z.object({
  institution: NonEmptyStringSchema,
  credential: NonEmptyStringSchema,
  start: NonEmptyStringSchema,
  end: NonEmptyStringSchema,
});
export type ResumeEducation = z.infer<typeof ResumeEducationSchema>;

export const ResumeDocumentSchema = z.object({
  /** The opening paragraph. Written once, rendered by page and PDF alike. */
  summary: NonEmptyStringSchema,
  /** Newest role first. The projection of `experienceEntries` — see file header. */
  experience: z.array(ResumeRoleSchema),
  capabilities: z.array(NonEmptyStringSchema),
  education: z.array(ResumeEducationSchema),
  /**
   * When true, both renderers splice the live `gitStats` / `aiUsage` readouts
   * from the snapshot into the document instead of quoting stale numbers in
   * prose (ADR 012). This is the differentiator no static PDF has, so it is a
   * flag rather than a hardcoded behaviour only because a print-safe fallback
   * has to stay possible.
   */
  embedGitStats: z.boolean(),
});
export type ResumeDocument = z.infer<typeof ResumeDocumentSchema>;
