import { v } from 'convex/values';
import { internalMutation, mutation, query, type MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { requireAdmin } from './lib/auth';
import {
  createManagementSecret, managementAuthError, managementConfiguration, managementSha256,
  type ManagementEnvironment, type ManagementScope,
} from './lib/managementAuth';
import { assertText, invalid, nowIso } from './lib/validate';
import { managementEnvironment, managementScope } from './schema';

const issueArgs = {
  name: v.string(), scopes: v.array(managementScope),
  environment: managementEnvironment, expiresAt: v.string(),
};
type IssueArgs = {
  name: string; scopes: ManagementScope[]; environment: ManagementEnvironment; expiresAt: string;
};

/** Shared by owner-authenticated issuance and deployment-credential bootstrap. */
export async function issueManagementToken(ctx: MutationCtx, args: IssueArgs) {
  const configured = managementConfiguration();
  if (args.environment !== configured.environment) {
    managementAuthError('forbidden', 'The token environment must match this deployment.');
  }
  assertText(args.name, 'name', 120);
  if (args.scopes.length === 0) {
    invalid({ code: 'invalid-format', field: 'scopes', message: 'Select at least one management scope.' });
  }
  const expiry = Date.parse(args.expiresAt);
  // Explicit UTC instant, not an ambiguous local date or an unbounded credential.
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(args.expiresAt) ||
    !Number.isFinite(expiry) || expiry <= Date.now() ||
    new Date(expiry).toISOString().slice(0, 19) !== args.expiresAt.slice(0, 19)
  ) {
    invalid({ code: 'invalid-format', field: 'expiresAt', message: 'Expiry must be a future UTC timestamp.' });
  }
  const token = createManagementSecret();
  const hashedToken = await managementSha256(token);
  const scopes = [...new Set(args.scopes)];
  const name = args.name.trim();
  const expiresAt = new Date(expiry).toISOString();
  const tokenId = await ctx.db.insert('managementTokens', {
    name, scopes, environment: args.environment, ownerSubject: configured.ownerSubject,
    hashedToken, expiresAt, lastUsedAt: null, revokedAt: null,
  });
  // This is the only return path containing the bearer secret. Never persist it.
  return { tokenId, name, scopes, environment: args.environment, expiresAt, token };
}

export const issue = mutation({
  args: issueArgs,
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return issueManagementToken(ctx, args);
  },
});

/** CLI only: deployment credentials authorize bootstrap; never exposed over MCP. */
export const issueForMachine = internalMutation({
  args: issueArgs,
  handler: issueManagementToken,
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const configured = managementConfiguration();
    const rows = await ctx.db.query('managementTokens')
      .withIndex('by_ownerSubject', (q) => q.eq('ownerSubject', configured.ownerSubject))
      .order('desc').collect();
    return rows.map((row) => ({
      tokenId: row._id, name: row.name, ownerSubject: row.ownerSubject,
      environment: row.environment, scopes: row.scopes,
      issuedAt: new Date(row._creationTime).toISOString(), expiresAt: row.expiresAt,
      lastUsedAt: row.lastUsedAt, revokedAt: row.revokedAt,
    }));
  },
});

async function revokeManagementToken(ctx: MutationCtx, args: { tokenId: Id<'managementTokens'> }) {
  const configured = managementConfiguration();
  const row = await ctx.db.get(args.tokenId);
  if (!row || row.ownerSubject !== configured.ownerSubject) {
    invalid({ code: 'not-found', field: 'tokenId', message: 'Management credential not found.' });
  }
  const revokedAt = row.revokedAt ?? nowIso();
  if (row.revokedAt === null) await ctx.db.patch(row._id, { revokedAt });
  return { tokenId: row._id, revokedAt, alreadyRevoked: row.revokedAt !== null };
}

export const revoke = mutation({
  args: { tokenId: v.id('managementTokens') },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return revokeManagementToken(ctx, args);
  },
});

/** Deployment-authenticated recovery path until the native token screen exists. */
export const revokeForMachine = internalMutation({
  args: { tokenId: v.id('managementTokens') },
  handler: revokeManagementToken,
});
