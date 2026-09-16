import { internalMutation } from './_generated/server';
import { deleteExpiredManagementReceipts } from './lib/managementWrites';

/** Internal-only maintenance; each execution deletes at most 100 expired receipts. */
export const pruneExpired = internalMutation({
  args: {},
  handler: deleteExpiredManagementReceipts,
});
