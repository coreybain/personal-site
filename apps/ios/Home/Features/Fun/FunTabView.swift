//
//  FunTabView.swift
//  Home — Fun tab
//
//  ═══════════════════════════════════════════════════════════════════════════
//   PLACEHOLDER. This directory (`Home/Features/Fun/`) is owned by the fun
//   agent. Replace the body below; keep the type name, because `RootView`
//   refers to it and `RootView` is not yours to edit.
//  ═══════════════════════════════════════════════════════════════════════════
//
//  What goes here: capturing a Fun Entry — beer, coffee, walk or pub — camera
//  first, then title, note, rating and location, written to the `funEntries`
//  table via `packages/convex/convex/funEntries.ts`.
//
//  This tab is the site's main source of imagery, which is why `photo` is a
//  required field on the table rather than an optional one. Image upload goes
//  through UploadThing (ADR 010), which vends presigned URLs for exactly this
//  client.
//
//  Both usage-description strings you need are already in `Info.plist` —
//  `NSCameraUsageDescription` and `NSPhotoLibraryUsageDescription`. They were
//  written at foundation time so that four agents would not each add a variant
//  of the same sentence. If you need a permission that is not declared, add it
//  to `project.yml` and say so in `apps/ios/README.md`; do not edit
//  `Home/Info.plist`, which is generated.
//

import SwiftUI

struct FunTabView: View {
    var body: some View {
        FeaturePlaceholder(
            title: "Fun",
            systemImage: "cup.and.saucer",
            summary: "Capture a beer, coffee, walk or pub — photo first.",
            ownedBy: "Home/Features/Fun/"
        )
    }
}

#Preview {
    FunTabView()
}
