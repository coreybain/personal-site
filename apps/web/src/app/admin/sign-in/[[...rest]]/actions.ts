"use server";

import { checkBotId } from "botid/server";

/**
 * Verify the browser before mounting Clerk's sign-in flow.
 *
 * Clerk owns the credential requests made by its prebuilt component, so those
 * requests cannot call a Next.js server-side BotID check. This first-party
 * Server Action is the enforceable boundary BotID requires; Clerk's own bot,
 * enumeration, and brute-force protections remain active behind it.
 */
export async function verifyAdminSignInAccess(): Promise<boolean> {
  try {
    const verification = await checkBotId();
    return !verification.isBot;
  } catch (error) {
    console.error(
      "[auth] BotID verification failed.",
      error instanceof Error ? error.message : "Unknown error",
    );
    return false;
  }
}
