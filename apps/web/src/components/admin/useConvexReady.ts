"use client";

/**
 * Is there a Convex backend to talk to?
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * No Convex deployment and no Clerk application are provisioned yet, and the
 * repo's rule is that everything must build and render with **zero** environment
 * variables set. Under that rule `ConvexClientProvider` mounts no provider at
 * all, which means `useQuery` and `useMutation` have no client in context and
 * throw the moment they run. React's rules forbid calling a hook conditionally,
 * so a page cannot "just skip" the query.
 *
 * The answer is to decide *before* the hook exists: read the same two variables
 * the provider reads, and render a different subtree. `<ConvexGate>` is the
 * ready-made version of that; this hook is for the cases where a component needs
 * the answer without changing its structure (a status line, a disabled button).
 *
 * ── Why both keys ──────────────────────────────────────────────────────────
 *
 * `ConvexClientProvider` treats one key without the other as *unconfigured*
 * rather than half-configured, because a Convex client with no way to
 * authenticate is a runtime error waiting for the first admin page. This check
 * mirrors that exactly. If the two ever disagree, the symptom is the worst
 * possible one — a page that believes it can query, calling a hook with no
 * provider — so they must be read the same way, in the same order, from the same
 * two names.
 *
 * ── Why `process.env` and not the client object ─────────────────────────────
 *
 * `NEXT_PUBLIC_` variables are inlined at build time, which makes both constants
 * below build-time constants: the server render and the browser hydration always
 * take the same branch, so there is no hydration mismatch. Asking Convex's own
 * context instead (`useConvex()`) would work in the browser and be wrong on the
 * server, and a component that renders differently in the two is a hydration
 * error by construction.
 *
 * Unset variables inline as `undefined`, not `""`, hence the plain truthiness.
 */
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

/**
 * The module-scope answer, for code that is not a component.
 *
 * A constant rather than a function: it cannot change during a session, and a
 * function invites the reader to think it might.
 */
export const CONVEX_READY = Boolean(convexUrl && clerkPublishableKey);

/**
 * `true` when `useQuery` / `useMutation` are safe to call in this subtree.
 *
 * Use it to *choose a subtree*, never to decide whether to call a hook:
 *
 * ```tsx
 * // Wrong — conditional hook, crashes on the second render.
 * if (useConvexReady()) { const rows = useQuery(api.projects.list, {}); }
 *
 * // Right — the hook lives in a component that only mounts when ready.
 * function Page() {
 *   return <ConvexGate><ProjectRows /></ConvexGate>;
 * }
 * ```
 */
export function useConvexReady(): boolean {
  return CONVEX_READY;
}
