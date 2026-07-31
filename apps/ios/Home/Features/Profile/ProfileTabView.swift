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
    @Environment(HomeAppModel.self) private var model

    let liveValue: String
    let liveRevision: Double

    @State private var value: String
    @State private var savedValue: String
    @State private var baseRevision: Double
    @State private var savedConfirmation: String?
    @State private var pendingExternalValue: String?
    @State private var pendingExternalRevision: Double?

    init(initialValue: String, initialRevision: Double) {
        liveValue = initialValue
        liveRevision = initialRevision
        _value = State(initialValue: initialValue)
        _savedValue = State(initialValue: initialValue.profileTrimmed)
        _baseRevision = State(initialValue: initialRevision)
    }

    var body: some View {
        TextField("Availability line", text: $value, axis: .vertical)
            .lineLimit(2...4)
            .onChange(of: value) { _, newValue in
                if let pendingExternalValue,
                   newValue.profileTrimmed == pendingExternalValue {
                    savedValue = pendingExternalValue
                    self.pendingExternalValue = nil
                }
                if newValue.profileTrimmed != savedValue {
                    savedConfirmation = nil
                }
            }
            .onChange(of: liveValue) { _, newValue in
                receive(newValue, revision: liveRevision)
            }
            .onChange(of: liveRevision) { _, newRevision in
                receive(liveValue, revision: newRevision)
            }

        Button("Publish availability", systemImage: "bolt.fill") {
            save()
        }
        .disabled(!canSave)

        if let pendingExternalValue {
            Label(
                "Availability changed elsewhere while you were editing.",
                systemImage: "arrow.trianglehead.2.clockwise.rotate.90"
            )
            .font(.caption)
            .foregroundStyle(.secondary)

            ViewThatFits(in: .horizontal) {
                HStack {
                    conflictButtons(pendingExternalValue)
                }
                VStack(alignment: .leading) {
                    conflictButtons(pendingExternalValue)
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
            && value.profileTrimmed != savedValue
            && pendingExternalValue == nil
    }

    private func save() {
        let availability = value.profileTrimmed
        Task {
            let result = await model.setAvailability(
                availability,
                expectedRevision: baseRevision
            )
            guard result.succeeded else { return }
            value = availability
            savedValue = availability
            if let revision = result.outcome?.revision {
                baseRevision = revision
                if pendingExternalRevision == revision,
                   pendingExternalValue?.profileTrimmed == availability {
                    pendingExternalValue = nil
                    pendingExternalRevision = nil
                }
            }
            savedConfirmation = "Availability published"
        }
    }

    @ViewBuilder
    private func conflictButtons(_ latestValue: String) -> some View {
        Button("Use latest") {
            value = latestValue
            savedValue = latestValue
            baseRevision = pendingExternalRevision ?? baseRevision
            pendingExternalValue = nil
            pendingExternalRevision = nil
            savedConfirmation = nil
        }

        Button("Keep mine") {
            savedValue = latestValue
            baseRevision = pendingExternalRevision ?? baseRevision
            pendingExternalValue = nil
            pendingExternalRevision = nil
            savedConfirmation = nil
        }
    }

    private func receive(_ newValue: String, revision: Double) {
        let incoming = newValue.profileTrimmed
        guard incoming != savedValue else {
            baseRevision = revision
            return
        }

        if value.profileTrimmed == savedValue {
            value = incoming
            savedValue = incoming
            baseRevision = revision
            savedConfirmation = nil
        } else {
            pendingExternalValue = incoming
            pendingExternalRevision = revision
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
