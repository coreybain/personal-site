//
//  SettingsTabView.swift
//  Home — Settings tab
//
//  ═══════════════════════════════════════════════════════════════════════════
//   PLACEHOLDER. This directory (`Home/Features/Settings/`) is owned by the
//   content agent. Replace the body below; keep the type name, because
//   `RootView` refers to it and `RootView` is not yours to edit.
//  ═══════════════════════════════════════════════════════════════════════════
//
//  What goes here, roughly in order of how often it is touched:
//
//    - Availability. `siteSettings.setAvailability` in
//      `packages/convex/convex/siteSettings.ts` — read its exact args. This is
//      the single highest-value thing the phone can do that the browser cannot:
//      flipping "open to work" from wherever you happen to be.
//    - Sign out. Clerk session teardown, which also has to tear down the
//      ConvexMobile client's auth state (ADR 007's adapter owns that seam).
//    - The `health:write` ingest token. Paste once, store in the Keychain,
//      show only a masked prefix and `lastUsedAt` thereafter — the plaintext is
//      shown once at issue time and is not recoverable from the database
//      (ADR 006a).
//    - Diagnostics. Which deployment am I pointed at, is the WebSocket
//      connected, when did the last health push land. `Config` already exposes
//      the first of those, and `ConvexClient.watchWebSocketState()` the second.
//
//  Diagnostics are worth building properly rather than treating as debug spew:
//  they are how "the phone silently stopped syncing" gets noticed at all, which
//  is the same argument ADR 006a makes for `lastUsedAt`.
//

import SwiftUI

struct SettingsTabView: View {
    var body: some View {
        FeaturePlaceholder(
            title: "Settings",
            systemImage: "gearshape",
            summary: "Availability, sign-in, the ingest token and connection diagnostics.",
            ownedBy: "Home/Features/Settings/"
        )
    }
}

#Preview {
    SettingsTabView()
}
