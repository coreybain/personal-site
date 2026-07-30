"use client";

import { SignOutButton } from "@clerk/nextjs";

/**
 * Sign out, as a client leaf.
 *
 * `SignOutButton` needs a `ClerkProvider` above it, which only exists when both
 * public keys are set (see `ConvexClientProvider`). So this component is
 * rendered conditionally by the shell rather than defensively here: a component
 * that renders nothing when unconfigured would still put the import in the
 * client graph of a page that can never use it, and the caller already knows the
 * answer.
 *
 * `redirectUrl` goes to our own sign-in page rather than Clerk's hosted one, so
 * signing out lands somewhere that can sign back in without leaving the app.
 */
export function AdminSignOut() {
  return (
    <SignOutButton redirectUrl="/admin/sign-in">
      <button type="button" className="adm-btn" data-variant="ghost" data-size="sm">
        Sign out
      </button>
    </SignOutButton>
  );
}
