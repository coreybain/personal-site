import "server-only";

import { createHash } from "node:crypto";
import { headers } from "next/headers";

/**
 * requestIdentity.ts — who is asking, as a digest that cannot be traced back.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  SERVER ONLY. The `import "server-only"` above is load-bearing — this module
 *  reads request headers and a secret salt, and neither may reach a bundle.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every rate-limited surface in `packages/convex` is keyed on an
 * `identifierHash`, and this is the only place that value is produced. The
 * arrangement exists because of a hard constraint, not a preference:
 *
 *   • A Convex mutation **cannot see the caller's IP**. The browser talks to
 *     Convex directly, and even when it does not (a Server Action, a Route
 *     Handler), the address terminates in Next.
 *   • So the identifier has to be computed here and passed in as an argument.
 *   • An argument is caller-controlled. Sending the raw address would put every
 *     visitor's IP into a database column and a Convex log for the privilege.
 *
 * Hashing solves both at once. The digest keys a counter perfectly well, it is
 * not an identifier anyone can read, and — because it is **salted** — a third
 * party who knows a target's address still cannot compute the digest that would
 * let them burn that target's quota. Read the header of
 * `packages/convex/convex/lib/rateLimit.ts` for what remains possible anyway
 * (inventing digests, which costs table rows and nothing else).
 *
 * ── Which header, and why the order ───────────────────────────────────────
 *
 * On Vercel the request reaches the function through the edge network, so the
 * socket address is useless and the proxy headers are authoritative. They are
 * also **forgeable by anyone talking to the origin directly**, which is fine
 * for a rate limiter — forging one costs the forger their own quota tracking
 * and buys them nothing but a different bucket — and would not be fine for
 * anything security-bearing. Do not reuse this value for authorisation.
 *
 * `x-forwarded-for` is a list, client-first, appended to by each hop; the first
 * entry is the closest thing to the originating address.
 *
 * ── Degradation ───────────────────────────────────────────────────────────
 *
 * Two states this deployment is actually in are handled rather than thrown on:
 *
 *   • **No salt.** `RATE_LIMIT_SALT` is not set. The digest is still computed
 *     (so no raw address ever leaves this module) with a constant fallback, and
 *     a warning is logged once per process. The limiter works; what is lost is
 *     the guarantee that a stranger cannot compute somebody else's bucket key.
 *   • **No address.** Local development, some proxies, a synthetic request. All
 *     such callers share one bucket, which is the safe direction to fail:
 *     limited together rather than unlimited apart.
 */

/**
 * The salt, or a stand-in.
 *
 * Read per call rather than cached at module scope so setting the variable
 * takes effect on the next request rather than the next deploy.
 */
function salt(): string {
  const configured = process.env.RATE_LIMIT_SALT;
  if (configured !== undefined && configured.length > 0) return configured;

  warnOnce();
  // Not a secret and not pretending to be. Its only job is to keep the digest
  // shape valid so the Convex side's format check passes and the limiter
  // functions; the security property it replaces is documented as lost.
  return "unsalted:coreybaines.com";
}

/** So the warning is one line in the log, not one line per request. */
let warned = false;
function warnOnce(): void {
  if (warned) return;
  warned = true;
  console.warn(
    "[rate-limit] RATE_LIMIT_SALT is not set. Counters still work and no raw " +
      "address is stored, but bucket keys are computable by anyone who knows a " +
      "visitor's IP. Set it with: bunx vercel env add RATE_LIMIT_SALT — or add " +
      "it to the root .env for local runs.",
  );
}

/**
 * The caller's address as the proxy reports it, or `null`.
 *
 * `null` is a real answer — see "Degradation" above — and is deliberately not
 * substituted with a random value: a fresh identifier per request would be a
 * rate limiter that never limits anything.
 */
function clientAddress(headerList: Headers): string | null {
  const forwarded = headerList.get("x-forwarded-for");
  if (forwarded !== null) {
    const first = forwarded.split(",")[0]?.trim();
    if (first !== undefined && first.length > 0) return first;
  }

  // Vercel sets this; several other proxies set it too. Checked second because
  // it carries a single value with no client-first convention to rely on.
  const real = headerList.get("x-real-ip");
  if (real !== null && real.trim().length > 0) return real.trim();

  return null;
}

/**
 * The salted digest to send to `checkRateLimit`, `retrieve` or `submit`.
 *
 * @returns 64 lowercase hex characters — the shape
 *   `assertIdentifierHash` in `packages/convex/convex/lib/rateLimit.ts`
 *   enforces. Anything else is rejected at the boundary, on purpose.
 *
 * Async because `headers()` is async in this version of Next (it became a
 * promise in 15.0; reading it synchronously is deprecated), and because reading
 * it opts the calling route into dynamic rendering — which every caller of this
 * is already, being a POST handler or a Server Action.
 */
export async function requestIdentifierHash(): Promise<string> {
  const address = clientAddress(await headers());

  // A namespace in front of the address so this digest can never collide with
  // some other salted hash computed elsewhere in the app from the same secret.
  return createHash("sha256")
    .update(`${salt()}:ip:${address ?? "unknown"}`)
    .digest("hex");
}
