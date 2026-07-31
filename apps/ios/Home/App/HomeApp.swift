//
//  HomeApp.swift
//  Home — the pocket admin for coreybaines.com
//
//  The entry point. Deliberately almost empty.
//
//  ── What belongs here, and what does not ───────────────────────────────────
//
//  This file owns exactly one thing: the `Scene`. It does NOT own the Convex
//  client, the Clerk configuration call, or any session state — those land in
//  `Home/Backend/`, which the auth agent owns, because ADR 007's Clerk
//  `AuthProvider` adapter is the risky part of this phase and it needs to be
//  reviewable in one place rather than smeared across the app entry point.
//
//  The seam the auth agent should use is an `.environment(…)` injection here
//  plus a root-level "signed out" branch inside `RootView`. It is written that
//  way rather than pre-stubbed because a stub of an object whose shape is not
//  yet known is just a merge conflict with extra steps.
//
//  ── Why there is no `init()` doing setup ───────────────────────────────────
//
//  `Clerk.configure(publishableKey:)` is `@MainActor` and must run once before
//  anything reads `Clerk.shared`. The obvious home for it is a `App.init()`,
//  and that is the wrong home: `init()` runs before the first frame, so a
//  configuration failure there is a launch crash with no UI to explain itself.
//  `Config.status` is checked inside `RootView` instead, where "you have not
//  run seed-config.sh" can be rendered as a sentence.
//

import SwiftUI

@main
struct HomeApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}
