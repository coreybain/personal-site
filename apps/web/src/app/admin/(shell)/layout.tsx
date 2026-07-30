import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AdminShell } from "@/components/admin/AdminShell";

/**
 * The gate, and the chrome.
 *
 * ── Why this is a route group ────────────────────────────────────────────────
 *
 * `(shell)` is a Next route group: parentheses mean the segment contributes
 * nothing to the URL, so `(shell)/projects/page.tsx` is served at
 * `/admin/projects`. The group exists to draw a line the URL cannot draw — every
 * admin route *except* `/admin/sign-in` needs a session, and `/admin/sign-in`
 * is a sibling of this group rather than a child of it.
 *
 * **Every admin page belongs inside this group.** A page at
 * `src/app/admin/projects/page.tsx` instead of
 * `src/app/admin/(shell)/projects/page.tsx` still resolves to `/admin/projects`,
 * silently skipping the gate below *and* the sidebar. The symptom is a page that
 * renders bare, with no nav — if that happens, this is why.
 *
 * ── Three layers of the same rule ───────────────────────────────────────────
 *
 * Any authenticated Clerk identity is the admin (ADR 006 — single user), and
 * that rule is enforced three times, on purpose:
 *
 *   1. `src/proxy.ts` — `auth.protect()` on `/admin(.*)`, before a render begins.
 *      Cheap perimeter; keeps unauthenticated traffic out of React entirely.
 *   2. **Here** — `auth()` at the resource, which is where Clerk's own guidance
 *      puts the real gate. The proxy could be misconfigured, its matcher could
 *      be edited, and a future deployment target might not run it at all.
 *   3. `requireAdmin(ctx)` in every Convex mutation. This is the only one that
 *      actually protects the *data*: layers 1 and 2 protect a UI, and a UI is
 *      not a permission. A stolen session token used directly against the Convex
 *      deployment never touches this file.
 *
 * Removing any one of the three leaves the system safe. Removing 3 does not.
 *
 * ── The unconfigured branch ─────────────────────────────────────────────────
 *
 * No Clerk application exists yet and the whole repo must build and render with
 * zero environment variables set. `auth()` cannot help here: it throws when
 * `clerkMiddleware` never ran, and with no keys `src/proxy.ts` is a
 * pass-through, so it never runs. Calling it unconditionally would turn every
 * `/admin` request into a 500 on a fresh clone.
 *
 * So the shell renders with a banner saying auth is off, and the pages render
 * below it. That is a deliberate choice over refusing to render:
 *
 *   - There is nothing to protect. With no Clerk keys `ConvexClientProvider`
 *     mounts no provider at all — it treats one key without the other as
 *     unconfigured — so no query and no mutation can reach a backend from these
 *     pages. The screens are furniture around an absent data source.
 *   - The alternative makes the admin undevelopable. Four agents are building
 *     entity screens against a repo with no live services; a shell that refuses
 *     to render means none of that work can be looked at.
 *
 * The honest summary: on a deployment with Clerk keys this is a gate; on one
 * without, `/admin` is a set of inert forms wired to nothing, and the banner says
 * so out loud.
 */

/**
 * Is Clerk actually set up? Same two-part check as `src/proxy.ts` and
 * `src/app/api/uploadthing/core.ts`, and it must stay the same in all three: the
 * publishable key is inlined at build, the secret key is read from the process at
 * cold start, and a deployment missing either is not configured.
 */
const clerkConfigured = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
);

export default async function AdminShellLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  if (!clerkConfigured) {
    return (
      <AdminShell authConfigured={false}>
        <div className="adm-banner" data-tone="warn" role="status">
          <strong>Auth is not configured.</strong> Nothing on these screens is
          protected and nothing can read or write data — <code>
            NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
          </code>{" "}
          and <code>CLERK_SECRET_KEY</code> are unset. See{" "}
          <code>apps/web/.env.example</code>.
        </div>
        {children}
      </AdminShell>
    );
  }

  const { userId } = await auth();

  if (!userId) {
    /*
     * Our own sign-in page, not Clerk's hosted one, and not
     * `redirectToSignIn()`: that helper builds its URL from environment
     * variables or dynamic middleware keys, so it silently sends people to
     * accounts.dev on a deployment that has not set NEXT_PUBLIC_CLERK_SIGN_IN_URL.
     * A literal path always lands somewhere that exists.
     *
     * The originally-requested path is lost, which is a real (small) cost: a
     * layout has no access to the pathname, and threading it through would mean
     * a client component reading `usePathname` just to build a `redirect_url`.
     * Sign-in returns to `/admin`, and from the dashboard everything is one
     * click away. Revisit if deep links into the admin ever get shared.
     */
    redirect("/admin/sign-in");
  }

  return <AdminShell authConfigured>{children}</AdminShell>;
}
