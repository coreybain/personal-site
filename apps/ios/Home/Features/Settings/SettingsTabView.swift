//
//  SettingsTabView.swift
//  Home
//
//  Operational controls: inbox, machine credentials, HealthKit and session
//  diagnostics. Content and public profile editing live in their own tabs.
//

import SwiftUI

struct SettingsTabView: View {
    private enum Route: Hashable {
        case inbox
        case tokens
        case health
        case diagnostics
    }

    @Environment(HomeAppModel.self) private var model
    @State private var confirmsSignOut = false

    var body: some View {
        NavigationStack {
            List {
                Section("Operations") {
                    NavigationLink(value: Route.inbox) {
                        SettingsRow(
                            title: "Inbox",
                            subtitle: "Read, triage and delete contact messages",
                            systemImage: "tray.full",
                            badge: model.newMessageCount == 0 ? nil : "\(model.newMessageCount) new"
                        )
                    }

                    NavigationLink(value: Route.health) {
                        SettingsRow(
                            title: "Health sync",
                            subtitle: "Daily steps and walking distance",
                            systemImage: "heart.text.square",
                            badge: HealthSyncService.shared.hasToken ? "Ready" : "Setup"
                        )
                    }

                    NavigationLink(value: Route.tokens) {
                        SettingsRow(
                            title: "Ingest tokens",
                            subtitle: "Issue and revoke machine credentials",
                            systemImage: "key.horizontal",
                            badge: "\(activeTokenCount) active"
                        )
                    }
                }

                Section("App") {
                    NavigationLink(value: Route.diagnostics) {
                        SettingsRow(
                            title: "Diagnostics",
                            subtitle: "Authentication, backend and connection",
                            systemImage: "waveform.path.ecg",
                            badge: model.connectionState.rawValue.capitalized
                        )
                    }

                    Link(destination: BusinessCardIdentity.siteURL) {
                        Label("Open public site", systemImage: "safari")
                    }

                    Button("Sign Out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
                        confirmsSignOut = true
                    }
                    .disabled(model.isBusy)
                }

                if let error = model.lastErrorMessage {
                    Section { ContentInlineError(message: error) }
                }
            }
            .navigationTitle("Operations")
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .inbox: InboxScreen()
                case .tokens: TokenManagementScreen()
                case .health: HealthTabView()
                case .diagnostics: DiagnosticsScreen()
                }
            }
            .confirmationDialog(
                "Sign out of Home?",
                isPresented: $confirmsSignOut,
                titleVisibility: .visible
            ) {
                Button("Sign Out", role: .destructive) {
                    Task { await model.signOut() }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("The separate HealthKit ingest token remains in Keychain so background health sync can continue.")
            }
            .refreshable { await model.refreshSubscriptions() }
        }
    }

    private var activeTokenCount: Int {
        model.ingestTokens.count { $0.revokedAt == nil }
    }
}

private struct SettingsRow: View {
    let title: String
    let subtitle: String
    let systemImage: String
    let badge: String?

    var body: some View {
        HStack(spacing: HorizonStyle.stack) {
            Image(systemName: systemImage)
                .font(.title3)
                .frame(width: 28)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: HorizonStyle.snug) {
                Text(title).font(.headline)
                Text(subtitle).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            if let badge {
                Text(badge)
                    .font(HorizonStyle.monoCaption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, HorizonStyle.snug)
        .accessibilityElement(children: .combine)
    }
}

private struct DiagnosticsScreen: View {
    @Environment(HomeAppModel.self) private var model

    var body: some View {
        List {
            Section("Session") {
                LabeledContent("Authentication", value: authDescription)
                LabeledContent("Live connection", value: model.connectionState.rawValue.capitalized)
            }

            Section("Backend") {
                LabeledContent("Convex client") {
                    Text(Config.convexDeploymentURL?.host() ?? "Not configured")
                        .font(HorizonStyle.monoCaption)
                        .textSelection(.enabled)
                }
                LabeledContent("Convex HTTP") {
                    Text(Config.convexSiteURL?.host() ?? "Not configured")
                        .font(HorizonStyle.monoCaption)
                        .textSelection(.enabled)
                }
                LabeledContent("Media API") {
                    Text(Config.nativeUploadURL?.host() ?? "Not configured")
                        .font(HorizonStyle.monoCaption)
                        .textSelection(.enabled)
                }
            }

            Section("Live records") {
                LabeledContent("Projects", value: model.projects.count.formatted())
                LabeledContent("Labs", value: model.labs.count.formatted())
                LabeledContent("Posts", value: model.posts.count.formatted())
                LabeledContent("Fun entries", value: model.funEntries.count.formatted())
                LabeledContent("Experience", value: model.experienceEntries.count.formatted())
                LabeledContent("Inbox", value: model.contactMessages.count.formatted())
            }

            Button("Reconnect Live Data", systemImage: "arrow.triangle.2.circlepath") {
                Task { await model.refreshSubscriptions() }
            }
        }
        .navigationTitle("Diagnostics")
    }

    private var authDescription: String {
        switch model.sessionState {
        case .configurationMissing: "Not configured"
        case .loading: "Connecting"
        case .signedOut: "Signed out"
        case .signedIn(let email): email ?? "Signed in"
        }
    }
}

#Preview {
    SettingsTabView()
        .environment(HomeAppModel.preview)
}
