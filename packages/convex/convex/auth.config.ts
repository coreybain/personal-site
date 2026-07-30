/**
 * auth.config.ts — which issuers Convex will accept a JWT from.
 *
 * Clerk is the only human auth (ADR 006): the browser admin and the iOS app
 * both sign in with Clerk, and Convex verifies the resulting JWT here. Machine
 * Ingest does NOT come through this path — HealthKit, the AI-usage Collector and
 * the git job authenticate with scoped bearer tokens against the HTTP endpoints
 * instead (ADR 006a, `ingestTokens`), because none of them has a user session.
 *
 * `applicationID` must equal the name of the JWT template configured in Clerk.
 * "convex" is Clerk's own preset name for it, and Convex checks it against the
 * token's `aud` claim — a mismatch reads as "not signed in", with no error.
 *
 * `domain` is the Clerk Frontend API URL (`https://<slug>.clerk.accounts.dev`
 * in dev, `https://clerk.coreybaines.com` in production). It is read from a
 * Convex *deployment* environment variable, not from a local `.env` — this file
 * is evaluated on the Convex side, so the value must be set per deployment in
 * the dashboard. Dev and prod resolve to different Clerk instances from the
 * same line of code. See README.md for the exact setup order.
 */

import type { AuthConfig } from 'convex/server';

export default {
  providers: [
    {
      // Non-null assertion is deliberate: if this is unset the deployment is
      // misconfigured and every authenticated call would silently fail. Better
      // to break loudly at push time.
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: 'convex',
    },
  ],
} satisfies AuthConfig;
