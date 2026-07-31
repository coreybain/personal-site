//
//  HealthTabView.swift
//  Home — Health tab
//
//  ═══════════════════════════════════════════════════════════════════════════
//   PLACEHOLDER. This directory (`Home/Features/Health/`) is owned by the
//   health agent. Replace the body below; keep the type name, because
//   `RootView` refers to it and `RootView` is not yours to edit.
//  ═══════════════════════════════════════════════════════════════════════════
//
//  What goes here: pipeline 3. An `HKObserverQuery` with background delivery on
//  step count and walking distance, posting a daily summary to `/ingest/health`
//  on the Convex *site* origin (`Config.convexSiteURL`), with a foreground sync
//  on app open as the fallback.
//
//  ── Two things the foundation has already decided for you ──────────────────
//
//  1. AUTH IS NOT CLERK HERE. Every other tab talks to Convex as a signed-in
//     human. This one does not, and must not: background delivery fires when
//     nobody is holding the phone, and a launchd-style push has no session to
//     borrow. The phone gets its OWN `health:write` scoped bearer token,
//     separate from the Mac collector's so that revoking one does not kill the
//     other (ADR 006a). Issue it from the browser admin, store it in the
//     Keychain — never in `Config.local.plist`, which ships inside the bundle
//     and is extractable. See `packages/convex/convex/ingestTokens.ts`
//     (`issueForMachine`) and `http.ts` for the endpoint's exact contract.
//
//  2. THE APP READS AND NEVER WRITES. `Info.plist` declares
//     `NSHealthShareUsageDescription` only; `NSHealthUpdateUsageDescription` is
//     deliberately absent, so `HKHealthStore.requestAuthorization(toShare:)`
//     with a non-empty share set will fail. Ask for `read:` types only. If a
//     write is genuinely needed later, that is a `project.yml` change plus a
//     README note, not a quiet plist edit.
//
//  The entitlements — `com.apple.developer.healthkit` and
//  `.healthkit.background-delivery` — are already declared. They are not
//  enforced on the simulator, so the first device build is where a missing
//  capability on the App ID will show up.
//

import SwiftUI

struct HealthTabView: View {
    var body: some View {
        FeaturePlaceholder(
            title: "Health",
            systemImage: "heart",
            summary: "Steps and walking distance, pushed daily to the site's activity signal.",
            ownedBy: "Home/Features/Health/"
        )
    }
}

#Preview {
    HealthTabView()
}
