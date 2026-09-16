import * as z from 'zod';
import { IsoDateTimeSchema } from './primitives';

/** Management credentials never inherit the collector's ingest permissions. */
export const ManagementScopeSchema = z.enum([
  'content:read', 'content:write', 'content:publish',
  'profile:read', 'profile:write', 'media:write',
  'inbox:read', 'inbox:write', 'operations:run',
]);
export type ManagementScope = z.infer<typeof ManagementScopeSchema>;
export const ManagementEnvironmentSchema = z.enum(['development', 'production']);
export type ManagementEnvironment = z.infer<typeof ManagementEnvironmentSchema>;
export const ManagementIdempotencyKeySchema = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/);

/** Stored privately; public metadata must omit hashedToken. */
export const ManagementTokenSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  hashedToken: z.string().regex(/^[a-f0-9]{64}$/),
  ownerSubject: z.string().min(1),
  environment: ManagementEnvironmentSchema,
  scopes: z.array(ManagementScopeSchema).min(1),
  expiresAt: IsoDateTimeSchema,
  lastUsedAt: IsoDateTimeSchema.nullable(),
  revokedAt: IsoDateTimeSchema.nullable(),
});
export type ManagementToken = z.infer<typeof ManagementTokenSchema>;

export const ManagementTokenMetadataSchema = ManagementTokenSchema.omit({ hashedToken: true }).extend({
  tokenId: z.string(),
  issuedAt: IsoDateTimeSchema,
});

export const ManagementTokenIssueSchema = z.strictObject({
  name: ManagementTokenSchema.shape.name,
  scopes: ManagementTokenSchema.shape.scopes,
  environment: ManagementEnvironmentSchema,
  expiresAt: IsoDateTimeSchema,
});

/** A seven-day retry window. Contains only bounded operation results, never tokens. */
export const ManagementReceiptSchema = z.strictObject({
  ownerSubject: z.string().min(1),
  environment: ManagementEnvironmentSchema,
  idempotencyKey: ManagementIdempotencyKeySchema,
  operation: z.string().min(1).max(120),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  resultJson: z.string().max(65_536),
  createdAt: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema,
});

/** Metadata only: no content bodies, credentials or inbox messages. */
export const ManagementAuditSchema = z.strictObject({
  ownerSubject: z.string().min(1),
  actorTokenId: z.string().min(1),
  environment: ManagementEnvironmentSchema,
  operation: z.string().min(1).max(120),
  entityType: z.string().min(1).max(120),
  entityId: z.string().min(1).max(256),
  oldRevision: z.number().int().nonnegative().nullable(),
  newRevision: z.number().int().nonnegative().nullable(),
  changedFields: z.array(z.string().min(1).max(120)).max(100),
  createdAt: IsoDateTimeSchema,
});
