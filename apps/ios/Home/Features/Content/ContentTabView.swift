//
//  ContentTabView.swift
//  Home — Content tab
//
//  ═══════════════════════════════════════════════════════════════════════════
//   PLACEHOLDER. This directory (`Home/Features/Content/`) is owned by the
//   content agent. Replace the body below; keep the type name, because
//   `RootView` refers to it and `RootView` is not yours to edit.
//  ═══════════════════════════════════════════════════════════════════════════
//
//  What goes here: CRUD over the publishable entities — `posts`, `projects`,
//  `labs` — against the Convex functions in `packages/convex/convex/`. Read the
//  real argument shapes from those files; the api paths are generated, and the
//  Swift `Codable` structs come from `Home/Generated/` (built from
//  `packages/types` Zod schemas, so the contract cannot drift — ADR 007).
//
//  The verification test for the whole iOS phase runs through this tab: create
//  a post on the phone, confirm it appears in the browser admin without a
//  refresh. That is what proves ConvexMobile's live queries and the Clerk
//  `AuthProvider` adapter are both working.
//

import SwiftUI

struct ContentTabView: View {
    var body: some View {
        FeaturePlaceholder(
            title: "Content",
            systemImage: "doc.text",
            summary: "Write and publish posts, projects and labs from the phone.",
            ownedBy: "Home/Features/Content/"
        )
    }
}

#Preview {
    ContentTabView()
}
