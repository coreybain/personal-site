//
//  RootView.swift
//  Home — the pocket admin for coreybaines.com
//
//  The tab shell. Four tabs, one per feature area, one per agent:
//
//      Content   posts / projects / labs CRUD        Home/Features/Content/
//      Fun       fun entries + camera capture        Home/Features/Fun/
//      Health    HealthKit read + ingest push        Home/Features/Health/
//      Settings  availability, sign-out, diagnostics Home/Features/Settings/
//
//  Each tab's body is a single type owned by that directory. Adding a screen
//  means adding a file under the owning directory and rerunning
//  `xcodegen generate`; it never means editing this file. The only reason to
//  come back here is to add or reorder a tab.
//
//  ── Why the selection is modelled, not left implicit ───────────────────────
//
//  `TabView` works fine with no `selection:` binding, and this shell does not
//  need one *yet*. It has one anyway because the two things that will want it
//  are both already on the roadmap and both are ugly to retrofit: a "just
//  captured a photo, take me to Fun" hand-off from the camera flow, and a push
//  notification or shortcut that deep-links to a tab. `Tab(…, value:)` and
//  `TabView(selection:)` have to be adopted together — mixing the value-less
//  `Tab` initialisers with a selection binding does not compile — so doing it
//  now costs one enum and doing it later costs an edit to every tab.
//

import SwiftUI

struct RootView: View {

    /// Which tab is showing.
    ///
    /// `String`-backed so a deep link can carry `"fun"` without a lookup table,
    /// and `CaseIterable` so a future "reorder tabs" setting has something to
    /// iterate. Raw values are part of the deep-link contract: renaming one is
    /// a breaking change, renaming the *case* is not.
    enum Section: String, Hashable, CaseIterable {
        case content
        case fun
        case health
        case settings
    }

    @State private var selection: Section = .content

    var body: some View {
        TabView(selection: $selection) {
            // `Tab(_:systemImage:value:content:)` — iOS 18+, verified against
            // the iPhoneSimulator27.0 SwiftUI .swiftinterface. It replaces
            // `.tabItem { Label(…) }`, which still compiles but cannot be mixed
            // with `Tab(role:)` and does not participate in the iOS 26 tab bar
            // behaviours below.
            Tab("Content", systemImage: "doc.text", value: Section.content) {
                ContentTabView()
            }

            Tab("Fun", systemImage: "cup.and.saucer", value: Section.fun) {
                FunTabView()
            }

            Tab("Health", systemImage: "heart", value: Section.health) {
                HealthTabView()
            }

            Tab("Settings", systemImage: "gearshape", value: Section.settings) {
                SettingsTabView()
            }
        }
        // iOS 26+. The tab bar shrinks to a pill as you scroll down a long list
        // and returns on the way up. Every one of these tabs is a scrolling
        // list of records, so this is the whole screen's worth of content that
        // the "quiet" brief asks for — chrome that gets out of the way.
        .tabBarMinimizeBehavior(.onScrollDown)
        // The one accent, applied once, at the root. Tab selection, buttons,
        // toggles and pickers all inherit it; nothing downstream sets a tint.
        .tint(HorizonStyle.accent)
        // Configuration is a property of the whole app, not of any one tab, so
        // the notice belongs above all of them. It appears only on a checkout
        // where `scripts/seed-config.sh` has not run — see Config.swift.
        .safeAreaInset(edge: .top, spacing: 0) {
            ConfigurationNotice()
        }
    }
}

// MARK: - Configuration notice

/// A banner shown when `Config.status` is `.missing`, and nothing at all when
/// it is `.ready`.
///
/// This exists because the alternative failure mode is genuinely bad: an app
/// that builds, launches, looks correct, and then fails every network call with
/// a DNS error naming a hostname nobody recognises. Naming the missing `.env`
/// variables and the script that writes them turns a half-hour into ten
/// seconds.
private struct ConfigurationNotice: View {
    var body: some View {
        if case .missing(let names) = Config.status {
            VStack(alignment: .leading, spacing: HorizonStyle.snug) {
                Label("Not configured", systemImage: "exclamationmark.triangle")
                    .font(.subheadline.weight(.semibold))

                // The variable names, in mono, because they are identifiers to
                // be copied rather than prose to be read.
                Text(names.joined(separator: "\n"))
                    .font(HorizonStyle.monoCaption)

                Text(Config.remedy)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, HorizonStyle.flow)
            .padding(.vertical, HorizonStyle.stack)
            .background(.bar)
            // One element to VoiceOver, not four: the heading, the list of
            // names and the remedy are a single message.
            .accessibilityElement(children: .combine)
        }
    }
}

// MARK: - Preview

#Preview {
    RootView()
}
