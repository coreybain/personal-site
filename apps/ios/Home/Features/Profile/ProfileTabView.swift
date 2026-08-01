//
//  ProfileTabView.swift
//  Home — résumé, experience and public identity
//

import SwiftUI

struct ProfileTabView: View {
    private enum Route: Hashable {
        case experience
    }

    private enum ProfileSheet: String, Identifiable {
        case resume
        case siteSettings
        case businessCard

        var id: String { rawValue }
    }

    @Environment(HomeAppModel.self) private var model
    @State private var activeSheet: ProfileSheet?

    var body: some View {
        NavigationStack {
            List {
                if let error = model.lastErrorMessage {
                    Section {
                        ProfileInlineError(message: error)
                    }
                }

                if !model.hasLoadedProfile {
                    Section {
                        HStack {
                            Spacer()
                            ProgressView("Loading profile…")
                            Spacer()
                        }
                    } footer: {
                        Text("Waiting for the first live résumé, experience and site-settings values.")
                    }
                } else {
                    Section("Quick availability") {
                        if let settings = model.siteSettings {
                            QuickAvailabilityEditor(
                                initialValue: settings.identity.availability,
                                initialVisible: settings.availabilityVisible ?? true,
                                initialRevision: settings.revision ?? 0
                            )
                        } else {
                            ContentUnavailableView(
                                "Create site settings first",
                                systemImage: "person.crop.circle.badge.exclamationmark",
                                description: Text(
                                    "Availability needs an existing settings record. "
                                        + "Open Site settings below to create it."
                                )
                            )
                        }
                    }

                    Section("Public profile") {
                        NavigationLink(value: Route.experience) {
                            ProfileDestinationRow(
                                title: "Experience",
                                subtitle: "Roles, résumé order and case-study links",
                                systemImage: "briefcase",
                                count: model.experienceEntries.count
                            )
                        }

                        Button {
                            activeSheet = .resume
                        } label: {
                            ProfileDestinationRow(
                                title: "Résumé",
                                subtitle: model.resumeDocument == nil
                                    ? "Create the résumé document"
                                    : "Summary, capabilities and education",
                                systemImage: "doc.text"
                            )
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint("Opens the résumé editor")

                        Button {
                            activeSheet = .siteSettings
                        } label: {
                            ProfileDestinationRow(
                                title: "Site settings",
                                subtitle: model.siteSettings == nil
                                    ? "Create identity and site navigation"
                                    : "Identity, headline, featured content and nav",
                                systemImage: "person.text.rectangle"
                            )
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint("Opens the site-settings editor")
                    }

                    if model.siteSettings != nil {
                        Section("Share") {
                            Button {
                                activeSheet = .businessCard
                            } label: {
                                ProfileDestinationRow(
                                    title: "Business card",
                                    subtitle: "QR code, contact card and website link",
                                    systemImage: "qrcode"
                                )
                            }
                            .buttonStyle(.plain)
                            .accessibilityHint("Opens the shareable business card")
                        }
                    }
                }
            }
            .navigationTitle("Profile")
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .experience:
                    ExperienceListScreen()
                }
            }
            .sheet(item: $activeSheet) { sheet in
                switch sheet {
                case .resume:
                    NavigationStack {
                        ResumeEditorScreen(
                            initial: model.resumeDocument.map(ResumeDraft.init(record:))
                                ?? ResumeDraft(),
                            documentExists: model.resumeDocument != nil
                        )
                    }
                case .siteSettings:
                    NavigationStack {
                        SiteSettingsEditorScreen(
                            initial: model.siteSettings.map(SiteSettingsDraft.init(record:))
                                ?? SiteSettingsDraft(),
                            settingsExist: model.siteSettings != nil,
                            lastUpdatedAt: model.siteSettings?.updatedAt
                        )
                    }
                case .businessCard:
                    BusinessCardSheet(identity: model.businessCardIdentity)
                }
            }
        }
    }
}

private struct QuickAvailabilityEditor: View {
    private struct AvailabilityDraft: Equatable {
        var value: String
        var visible: Bool
    }

    @Environment(HomeAppModel.self) private var model

    let liveValue: String
    let liveVisible: Bool
    let liveRevision: Double

    @State private var value: String
    @State private var visible: Bool
    @State private var saved: AvailabilityDraft
    @State private var baseRevision: Double
    @State private var savedConfirmation: String?
    @State private var pendingExternal: AvailabilityDraft?
    @State private var pendingExternalRevision: Double?

    init(initialValue: String, initialVisible: Bool, initialRevision: Double) {
        liveValue = initialValue
        liveVisible = initialVisible
        liveRevision = initialRevision
        _value = State(initialValue: initialValue)
        _visible = State(initialValue: initialVisible)
        _saved = State(
            initialValue: AvailabilityDraft(
                value: initialValue.profileTrimmed,
                visible: initialVisible
            )
        )
        _baseRevision = State(initialValue: initialRevision)
    }

    var body: some View {
        TextField("Availability line", text: $value, axis: .vertical)
            .lineLimit(2...4)
            .onChange(of: value) {
                reconcilePendingState()
            }
            .onChange(of: liveValue) { _, newValue in
                receive(newValue, visible: liveVisible, revision: liveRevision)
            }
            .onChange(of: liveVisible) { _, newVisible in
                receive(liveValue, visible: newVisible, revision: liveRevision)
            }
            .onChange(of: liveRevision) { _, newRevision in
                receive(liveValue, visible: liveVisible, revision: newRevision)
            }

        Toggle("Show availability badges", isOn: $visible)
            .accessibilityHint("Controls the hiring signal across the public site")
            .onChange(of: visible) {
                reconcilePendingState()
            }

        Button("Publish availability", systemImage: "bolt.fill") {
            save()
        }
        .disabled(!canSave)

        if let pendingExternal {
            Label(
                "Availability changed elsewhere while you were editing.",
                systemImage: "arrow.trianglehead.2.clockwise.rotate.90"
            )
            .font(.caption)
            .foregroundStyle(.secondary)

            ViewThatFits(in: .horizontal) {
                HStack {
                    conflictButtons(pendingExternal)
                }
                VStack(alignment: .leading) {
                    conflictButtons(pendingExternal)
                }
            }
        }

        if let savedConfirmation {
            Label(savedConfirmation, systemImage: "checkmark.circle")
                .font(.caption)
                .foregroundStyle(.secondary)
                .accessibilityElement(children: .combine)
        } else {
            Text("Updates the hiring signal everywhere it appears on the public site.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var canSave: Bool {
        !model.isBusy
            && !value.profileIsBlank
            && current != saved
            && pendingExternal == nil
    }

    private var current: AvailabilityDraft {
        AvailabilityDraft(value: value.profileTrimmed, visible: visible)
    }

    private func save() {
        let availability = value.profileTrimmed
        Task {
            let result = await model.setAvailability(
                availability,
                visible: visible,
                expectedRevision: baseRevision
            )
            guard result.succeeded else { return }
            value = availability
            saved = AvailabilityDraft(value: availability, visible: visible)
            if let revision = result.outcome?.revision {
                baseRevision = revision
                if pendingExternalRevision == revision,
                   pendingExternal == saved {
                    pendingExternal = nil
                    pendingExternalRevision = nil
                }
            }
            savedConfirmation = "Availability published"
        }
    }

    @ViewBuilder
    private func conflictButtons(_ latest: AvailabilityDraft) -> some View {
        Button("Use latest") {
            value = latest.value
            visible = latest.visible
            saved = latest
            baseRevision = pendingExternalRevision ?? baseRevision
            pendingExternal = nil
            pendingExternalRevision = nil
            savedConfirmation = nil
        }

        Button("Keep mine") {
            saved = latest
            baseRevision = pendingExternalRevision ?? baseRevision
            pendingExternal = nil
            pendingExternalRevision = nil
            savedConfirmation = nil
        }
    }

    private func receive(_ newValue: String, visible: Bool, revision: Double) {
        let incoming = AvailabilityDraft(
            value: newValue.profileTrimmed,
            visible: visible
        )
        guard incoming != saved else {
            baseRevision = revision
            return
        }

        if current == saved {
            value = incoming.value
            self.visible = incoming.visible
            saved = incoming
            baseRevision = revision
            savedConfirmation = nil
        } else {
            pendingExternal = incoming
            pendingExternalRevision = revision
        }
    }

    private func reconcilePendingState() {
        if let pendingExternal, current == pendingExternal {
            saved = pendingExternal
            self.pendingExternal = nil
            pendingExternalRevision = nil
        }
        if current != saved {
            savedConfirmation = nil
        }
    }
}

private struct BusinessCardSheet: View {
    @Environment(\.dismiss) private var dismiss

    let identity: BusinessCardIdentity

    var body: some View {
        BusinessCardView(identity: identity) {
            dismiss()
        }
    }
}

#Preview {
    ProfileTabView()
        .environment(HomeAppModel.preview)
}
