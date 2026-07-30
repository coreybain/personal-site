/**
 * Auth, as the rest of the app is allowed to see it (ADR 006).
 *
 * One export, deliberately. `ClerkProvider`, `ConvexReactClient` and
 * `ConvexProviderWithClerk` are wiring, not API: everything that needs an
 * authenticated Convex reads it through hooks (`useQuery`, `useMutation`), and
 * everything that needs a session reads it through Clerk's own hooks. Nothing
 * else should be constructing a client.
 *
 * Nothing imports this yet, and that is the current correct state: the provider
 * belongs to the `/admin` layout that phase 2 creates, not to the root layout.
 * Importing it from anything on the public site puts 76 KB gzip of auth SDK back
 * into that route's client bundle — see the file it re-exports, and
 * src/app/layout.tsx.
 */
export { ConvexClientProvider } from "./ConvexClientProvider";
