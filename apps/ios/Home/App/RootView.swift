//
//  RootView.swift
//  Home
//
//  Authentication gate and the five durable admin areas.
//

import ClerkKitUI
import SwiftUI

struct RootView: View {
    enum Section: String, Hashable, CaseIterable {
        case content
        case fun
        case profile
        case operations
        case card
    }

    @Environment(HomeAppModel.self) private var model
    @State private var selection: Section = .content

    var body: some View {
        Group {
            switch model.sessionState {
            case .configurationMissing:
                MissingConfigurationView()
            case .loading:
                ProgressView("Connecting to your site…")
            case .signedOut:
                AuthView(mode: .signIn, isDismissible: false)
            case .signedIn:
                adminTabs
            }
        }
        .tint(HorizonStyle.accent)
    }

    private var adminTabs: some View {
        TabView(selection: $selection) {
            Tab("Content", systemImage: "doc.text", value: Section.content) {
                ContentTabView()
            }

            Tab("Fun", systemImage: "cup.and.saucer", value: Section.fun) {
                FunTabView()
            }

            Tab("Profile", systemImage: "person.text.rectangle", value: Section.profile) {
                ProfileTabView()
            }

            Tab("Operations", systemImage: "slider.horizontal.3", value: Section.operations) {
                SettingsTabView()
            }

            Tab("Card", systemImage: "qrcode", value: Section.card) {
                if model.hasLoadedSiteSettings {
                    BusinessCardView(identity: model.businessCardIdentity)
                } else {
                    NavigationStack {
                        ProgressView("Loading your current contact details…")
                            .navigationTitle("Business card")
                    }
                }
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
    }
}

private struct MissingConfigurationView: View {
    var body: some View {
        ContentUnavailableView {
            Label("Home isn’t configured", systemImage: "wrench.and.screwdriver")
        } description: {
            VStack(spacing: HorizonStyle.snug) {
                if case .missing(let names) = Config.status {
                    Text(names.joined(separator: "\n"))
                        .font(HorizonStyle.monoCaption)
                }
                Text(Config.remedy)
            }
        }
        .padding(HorizonStyle.flow)
    }
}

#Preview {
    RootView()
        .environment(HomeAppModel.preview)
}
