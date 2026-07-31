import { SignIn } from "@clerk/nextjs";
import type { Metadata } from "next";
import Link from "next/link";

/**
 * `/admin/sign-in` — the only page under `/admin` a signed-out visitor may see.
 *
 * ── Why the optional catch-all segment ──────────────────────────────────────
 *
 * The directory is `sign-in/[[...rest]]`, so this one file serves `/admin/sign-in`
 * *and* every path beneath it. Clerk's `<SignIn />` is a multi-step flow that
 * navigates to sub-routes of its own — `/admin/sign-in/factor-two` for a second
 * factor, `/admin/sign-in/reset-password`, an SSO callback — and with a plain
 * `page.tsx` every one of those would 404 mid sign-in. The double brackets make
 * the segment *optional*, which is what keeps the bare path working too.
 *
 * `path` tells Clerk which prefix it owns, so the URLs it builds match the routes
 * that exist. It is required by `SignInProps`' routing union whenever
 * `routing: 'path'` is implied, which it is for a catch-all page.
 *
 * ── Why it sits outside the `(shell)` group ─────────────────────────────────
 *
 * `(shell)/layout.tsx` redirects a session-less caller here. If this page were
 * inside that group, it would redirect to itself. Same reason `src/proxy.ts` lists
 * `/admin/sign-in` in `UNPROTECTED_PATHS` — `auth.protect()` on the sign-in page
 * is an infinite loop, and the loop only appears once `NEXT_PUBLIC_CLERK_SIGN_IN_URL`
 * points at this path.
 *
 * It is still inside `admin/layout.tsx`, which is what supplies the
 * `ClerkProvider` that `<SignIn />` needs, plus the theme scope and stylesheet.
 * There is no sidebar, on purpose: navigation you cannot use is worse than no
 * navigation.
 *
 * ── With no Clerk keys ──────────────────────────────────────────────────────
 *
 * `ConvexClientProvider` mounts nothing, so `<SignIn />` has no provider and would
 * throw. The page therefore checks the same two variables everything else does and
 * renders an explanation instead. This is the one screen where "not configured"
 * has to be the whole page rather than a banner: there is no sign-in to attempt
 * and nothing else here to do.
 *
 * ── No sign-up, ever ────────────────────────────────────────────────────────
 *
 * ADR 006: this is a single-user admin. So there is no `<SignUp />` route and no
 * link to one. The one account is created by hand in the Clerk dashboard, and
 * `ADMIN_CLERK_USER_ID` independently authorizes that stable subject. Public
 * sign-up should still be disabled there as defense in depth.
 */
export const metadata: Metadata = {
  title: "Sign in — admin",
  robots: { index: false, follow: false },
};

const clerkConfigured = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
);

export default function AdminSignInPage() {
  return (
    <main className="adm-signin">
      {clerkConfigured ? (
        <SignIn
          path="/admin/sign-in"
          /*
           * Where to land after signing in, when nothing else has an opinion.
           * `fallbackRedirectUrl` rather than `forceRedirectUrl`: a `redirect_url`
           * search param — which Clerk adds when it is the one doing the
           * redirecting — should still win, so a deep link into the admin survives
           * the sign-in it triggered.
           */
          fallbackRedirectUrl="/admin"
          /* No sign-up route exists (see the docblock). Pointing this at the
             sign-in path stops Clerk rendering a "Sign up" link to a 404. */
          signUpUrl="/admin/sign-in"
        />
      ) : (
        <div className="adm-panel adm-signin-panel">
          <div className="adm-panel-body">
            <p className="adm-eyebrow">Admin</p>
            <h1 className="adm-page-title">Auth is not configured</h1>
            <p className="adm-page-sub">
              There is no Clerk application wired to this deployment, so there is
              no sign-in to attempt. Set{" "}
              <code>NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code> and{" "}
              <code>CLERK_SECRET_KEY</code> — see{" "}
              <code>apps/web/.env.example</code>, and{" "}
              <code>packages/convex/README.md</code> for the one-time setup order,
              which matters: the Clerk JWT template must be named exactly{" "}
              <code>convex</code> or every authenticated request reads as signed
              out.
            </p>
            <p className="adm-micro" style={{ marginTop: "1rem" }}>
              <Link href="/admin" className="adm-link">
                Continue to the admin anyway
              </Link>{" "}
              — the screens render, but nothing can read or write.
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
