"use client";

import { SignIn } from "@clerk/nextjs";
import { useEffect, useState } from "react";

import { verifyAdminSignInAccess } from "./actions";

type GateState = "checking" | "allowed" | "denied";

/** Mount Clerk only after BotID has classified this browser as human. */
export function BotProtectedSignIn() {
  const [gate, setGate] = useState<GateState>("checking");

  useEffect(() => {
    let active = true;

    void verifyAdminSignInAccess()
      .then((allowed) => {
        if (active) setGate(allowed ? "allowed" : "denied");
      })
      .catch(() => {
        // Network and Server Action transport failures must fail closed too.
        if (active) setGate("denied");
      });

    return () => {
      active = false;
    };
  }, []);

  if (gate === "allowed") {
    return (
      <SignIn
        path="/admin/sign-in"
        /* Preserve the originally requested admin page after Clerk redirects a
           signed-out deep link here; use the dashboard only as the fallback. */
        fallbackRedirectUrl="/admin"
        /* This is a single-user admin with no public sign-up route. */
        signUpUrl="/admin/sign-in"
      />
    );
  }

  return (
    <div
      className="adm-panel adm-signin-panel"
      aria-busy={gate === "checking" || undefined}
      aria-live="polite"
    >
      <div className="adm-panel-body">
        <p className="adm-eyebrow">Admin</p>
        <h1 className="adm-page-title">
          {gate === "checking" ? "Verifying browser…" : "Access unavailable"}
        </h1>
        <p className="adm-page-sub">
          {gate === "checking"
            ? "Checking this browser before opening the sign-in form."
            : "This browser could not be verified. Reload the page to try again."}
        </p>
      </div>
    </div>
  );
}
