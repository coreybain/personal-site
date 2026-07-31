//
//  FeaturePlaceholder.swift
//  Home — the pocket admin for coreybaines.com
//
//  The "this tab exists but has no feature in it yet" screen, shared by all
//  four tabs so the foundation commit is one placeholder rather than four
//  near-identical ones.
//
//  ── This file is scaffolding and is meant to be deleted ────────────────────
//
//  It lives in `Home/App/` rather than in any feature directory precisely so
//  that no feature agent owns it and no feature agent has to merge it. When the
//  last of the four tabs stops calling `FeaturePlaceholder`, delete this file
//  and rerun `xcodegen generate`. Until then it does one useful job beyond
//  filling space: it is the thing the foundation's screenshot check renders, so
//  "the shell builds, launches and draws" is a claim with evidence behind it.
//
//  It is also, quietly, the empty-state pattern for the real screens. A tab with
//  no records yet should say what goes in it and what to do, in the same shape.
//

import SwiftUI

/// A titled empty state naming what will eventually live in a tab.
struct FeaturePlaceholder: View {

    /// Navigation title, matching the tab's label.
    let title: String

    /// SF Symbol, matching the tab's icon.
    let systemImage: String

    /// One sentence describing what this tab will do. Written in the present
    /// tense on purpose — it is the tab's job description, and it survives into
    /// the real empty state with barely an edit.
    let summary: String

    /// The directory that owns this tab's code. Rendered in mono, on screen,
    /// because the ownership map in `project.yml` is only useful to someone who
    /// knows to go and read it — and the person most likely to be looking at
    /// this screen is the agent about to replace it.
    let ownedBy: String

    var body: some View {
        NavigationStack {
            // `ContentUnavailableView` is the system's own empty state: correct
            // metrics, correct Dynamic Type behaviour, correct VoiceOver
            // grouping, and it already looks like the rest of iOS. Hand-rolling
            // a VStack of an icon and two labels would be three of those four
            // things done slightly wrong.
            ContentUnavailableView {
                Label(title, systemImage: systemImage)
            } description: {
                Text(summary)
            } actions: {
                Text(ownedBy)
                    .font(HorizonStyle.monoCaption)
                    .foregroundStyle(.secondary)
            }
            .navigationTitle(title)
        }
    }
}

#Preview {
    FeaturePlaceholder(
        title: "Content",
        systemImage: "doc.text",
        summary: "Write and publish posts, projects and labs from the phone.",
        ownedBy: "Home/Features/Content/"
    )
}
