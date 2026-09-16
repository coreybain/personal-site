import { ConvexError } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

export type ManagementScope = Doc<'managementTokens'>['scopes'][number];
export type ManagementEnvironment = Doc<'managementTokens'>['environment'];
export type ManagementCredentials = { token: string; environment: ManagementEnvironment };
export type ManagementActor = {
  tokenId: Id<'managementTokens'>;
  name: string;
  ownerSubject: string;
  environment: ManagementEnvironment;
  scopes: ManagementScope[];
};

export function managementAuthError(
  code: 'unauthenticated' | 'forbidden' | 'authorization-not-configured',
  message: string,
): never {
  throw new ConvexError({ code, message });
}

/** No default environment: a misconfigured deployment cannot accept management writes. */
export function managementConfiguration() {
  const ownerSubject = process.env.ADMIN_CLERK_USER_ID?.trim();
  const environment = process.env.MANAGEMENT_ENVIRONMENT;
  if (!ownerSubject || (environment !== 'development' && environment !== 'production')) {
    managementAuthError('authorization-not-configured', 'Management authorization is not configured.');
  }
  return { ownerSubject, environment };
}

/** Web Crypto is available in the existing Convex runtime used by ingestTokens. */
export async function managementSha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createManagementSecret(): string {
  // No predictable fallback if the runtime's CSPRNG is unavailable.
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `mgmt_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Call inside the query/mutation that accesses protected data. A preliminary
 * HTTP check cannot replace this: revocation and the write share a transaction.
 * Reads do not write lastUsedAt; successful writes/replays update it atomically.
 */
export async function requireManagement(
  ctx: Pick<QueryCtx, 'db'>,
  credentials: ManagementCredentials,
  requiredScope?: ManagementScope,
): Promise<ManagementActor> {
  const configured = managementConfiguration();
  if (credentials.environment !== configured.environment) {
    managementAuthError('forbidden', 'The requested management environment does not match this deployment.');
  }
  if (!/^mgmt_[a-f0-9]{64}$/.test(credentials.token)) {
    managementAuthError('unauthenticated', 'A valid management credential is required.');
  }
  const hashedToken = await managementSha256(credentials.token);
  const row = await ctx.db.query('managementTokens')
    .withIndex('by_hashedToken', (q) => q.eq('hashedToken', hashedToken)).unique();
  if (
    !row || row.revokedAt !== null || row.ownerSubject !== configured.ownerSubject ||
    row.environment !== configured.environment ||
    !Number.isFinite(Date.parse(row.expiresAt)) || Date.parse(row.expiresAt) <= Date.now()
  ) {
    managementAuthError('unauthenticated', 'A valid management credential is required.');
  }
  if (requiredScope && !row.scopes.includes(requiredScope)) {
    managementAuthError('forbidden', 'The management credential does not allow this operation.');
  }
  return {
    tokenId: row._id, name: row.name, ownerSubject: row.ownerSubject,
    environment: row.environment, scopes: row.scopes,
  };
}
