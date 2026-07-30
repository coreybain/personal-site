import type { Metadata } from "next";

import { AdminPage, AdminPageHeader, ConvexGate } from "@/components/admin";

import { TokensScreen } from "./TokensScreen";

/**
 * `/admin/tokens` — issue and revoke the machine ingest tokens of ADR 006a.
 *
 * A **server** component, and thin by the kit's composition rule: the header
 * renders without a backend, so a zero-env clone shows a page explaining what
 * ingest tokens are rather than a blank rectangle. Everything that touches Convex
 * is inside `TokensScreen`, below the gate.
 *
 * ── Why the "shown once" rule can be a tooltip here and nowhere else ────────
 *
 * It reads like a violation of the kit's rule that judgement text stays inline, and
 * it is not, because of *when* each copy is read. The header is read on arrival,
 * before a token exists — at which point "you will only see it once" is background.
 * The moment it becomes a fact someone can lose money on is the moment `issue`
 * returns, and there `IssuedTokenPanel` says it in a `danger` notice, in the same
 * box as the token, with a button that has to be pressed to dismiss it. That panel
 * and its warning are deliberately untouched by this pass.
 *
 * What would be wrong is stating it *only* here. So both exist, and the inline copy
 * is the one that appears when it matters.
 */
export const metadata: Metadata = {
  title: "Ingest tokens — admin",
};

export default function TokensPage() {
  return (
    <AdminPage>
      <AdminPageHeader
        eyebrow="Operations"
        title="Ingest tokens"
        info={
          <>
            Scoped bearer tokens for the machine push paths — the AI-usage
            collector, the phone&rsquo;s health export, the git stats cron (ADR
            006a). Each token is shown <strong>once</strong>, at the moment it is
            issued: only its SHA-256 hash is stored, so a lost token is reissued
            rather than recovered.
          </>
        }
      />

      <ConvexGate>
        <TokensScreen />
      </ConvexGate>
    </AdminPage>
  );
}
