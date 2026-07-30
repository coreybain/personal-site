/**
 * @home/types — the API contract.
 *
 * Zod schemas are the source of truth for the Convex data model. Everything else
 * derives from them: `packages/convex` validates arguments with them,
 * `apps/web` infers its props from them, `tooling/collector` validates the body
 * it posts, and a Turbo task generates Swift `Codable` structs from them so
 * `apps/ios` cannot drift from the server (see the monorepo layout notes — the
 * iOS app is in the repo for the shared *contract*, not shared code).
 *
 * ┌─ Convex tables ────────────────────────────────────────────────────────────┐
 * │ snapshot           singleton  SnapshotSchema           snapshot.ts         │
 * │ siteSettings       singleton  SiteSettingsSchema       settings.ts         │
 * │ resumeDocument     singleton  ResumeDocumentSchema     resume.ts           │
 * │ experienceEntries  table      ExperienceEntrySchema    resume.ts           │
 * │ projects           table      ProjectSchema            content.ts          │
 * │ labs               table      LabSchema                content.ts          │
 * │ posts              table      PostSchema               content.ts          │
 * │ funEntries         table      FunEntrySchema           content.ts          │
 * │ ingestTokens       table      IngestTokenSchema        ingest.ts           │
 * │ knowledgeDocs      table      KnowledgeDocSchema       knowledge.ts        │
 * │ contactMessages    table      ContactMessageSchema     contact.ts          │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Conventions that hold across every schema in this package:
 *
 *   - Table schemas describe the document *body* — what a mutation writes. Convex
 *     adds `_id` and `_creationTime`; spread `systemFieldsShape` when you need the
 *     shape of a document as a query returns it.
 *   - Timestamps are ISO 8601 strings with a `Z`, never epoch numbers, so one
 *     decoder works in TypeScript and Swift alike.
 *   - Payloads crossing an untrusted boundary (ingest, the contact form) are
 *     `strictObject`: an unexpected key is an error, not something to strip.
 *   - Where the plan's field list and the shape already implemented in
 *     apps/web/src/lib/snapshot.ts disagree, this package models the superset and
 *     the divergence is documented at the field. Search for `DIVERGENCE`.
 *     Inferred values the plan left open are marked `ASSUMPTION`.
 *
 * This package is the contract only. apps/web still reads its own mock
 * (apps/web/src/lib/snapshot.ts); swapping it over happens with the Convex wiring.
 */

export * from './primitives';
export * from './stats';
export * from './snapshot';
export * from './content';
export * from './resume';
export * from './settings';
export * from './ingest';
export * from './knowledge';
export * from './contact';

import { ContactMessageSchema } from './contact';
import {
  FunEntrySchema,
  LabSchema,
  PostSchema,
  ProjectSchema,
} from './content';
import { IngestTokenSchema } from './ingest';
import { KnowledgeDocSchema } from './knowledge';
import { ExperienceEntrySchema, ResumeDocumentSchema } from './resume';
import { SiteSettingsSchema } from './settings';
import { SnapshotSchema } from './snapshot';

/**
 * Every table, keyed by its Convex table name.
 *
 * Exists so the Swift codegen task and the schema-drift test can enumerate the
 * model instead of hardcoding a list that quietly falls behind. Adding a table
 * means adding it here.
 */
export const tableSchemas = {
  snapshot: SnapshotSchema,
  siteSettings: SiteSettingsSchema,
  resumeDocument: ResumeDocumentSchema,
  experienceEntries: ExperienceEntrySchema,
  projects: ProjectSchema,
  labs: LabSchema,
  posts: PostSchema,
  funEntries: FunEntrySchema,
  ingestTokens: IngestTokenSchema,
  knowledgeDocs: KnowledgeDocSchema,
  contactMessages: ContactMessageSchema,
} as const;

/** Convex table name. */
export type TableName = keyof typeof tableSchemas;

/**
 * The three tables holding exactly one row. Convex has no singleton primitive, so
 * these are ordinary tables the mutations refuse to insert a second row into.
 */
export const singletonTables = [
  'snapshot',
  'siteSettings',
  'resumeDocument',
] as const satisfies readonly TableName[];

export type SingletonTableName = (typeof singletonTables)[number];
