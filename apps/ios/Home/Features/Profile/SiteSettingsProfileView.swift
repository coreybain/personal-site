//
//  SiteSettingsProfileView.swift
//  Home — public identity, curation and navigation
//

import Foundation
import SwiftUI

struct SiteSettingsEditorScreen: View {
    @Environment(HomeAppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var draft: SiteSettingsDraft
    @State private var savedDraft: SiteSettingsDraft
    @State private var hasSettings: Bool
    @State private var statusMessage: String?
    @State private var displayedUpdatedAt: String?
    @State private var pendingServerChange: SiteSettingsServerChange?
    @State private var showingDiscardConfirmation = false
    @State private var showingReloadConfirmation = false
    @State private var showingDeleteConfirmation = false
    @State private var isWorking = false

    init(
        initial: SiteSettingsDraft,
        settingsExist: Bool,
        lastUpdatedAt: String?
    ) {
        _draft = State(initialValue: initial)
        _savedDraft = State(initialValue: initial)
        _hasSettings = State(initialValue: settingsExist)
        _displayedUpdatedAt = State(initialValue: lastUpdatedAt)
    }

    var body: some View {
        Form {
            if let error = model.lastErrorMessage {
                Section {
                    ProfileInlineError(message: error)
                }
            }

            if !hasSettings {
                Section {
                    Label(
                        "No site-settings record exists. Saving creates the whole record; "
                            + "blank fields are not merged with fallback content.",
                        systemImage: "person.crop.circle.badge.plus"
                    )
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                }
            }

            if let pendingServerChange {
                Section {
                    Label(
                        pendingServerChange.message,
                        systemImage: "arrow.trianglehead.2.clockwise.rotate.90"
                    )
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                    Button("Reload latest", systemImage: "arrow.clockwise") {
                        showingReloadConfirmation = true
                    }

                    Button("Keep my draft", systemImage: "pencil") {
                        keepDraft(over: pendingServerChange)
                    }
                } header: {
                    Text("Newer server state")
                } footer: {
                    Text("Saving is paused until you choose which version to keep.")
                }
            }

            Section("Homepage") {
                TextField("Headline", text: $draft.headline, axis: .vertical)
                    .lineLimit(2...5)

                TextField(
                    "Availability",
                    text: $draft.identity.availability,
                    axis: .vertical
                )
                .lineLimit(2...4)

                Text(
                    "Use the Profile screen’s quick action when availability is the only field that changed."
                )
                .font(.caption)
                .foregroundStyle(.secondary)
            }

            Section("Identity") {
                TextField("Name", text: $draft.identity.name)
                    .textContentType(.name)
                TextField("Role", text: $draft.identity.role)
                    .textContentType(.jobTitle)
                TextField("Company", text: $draft.identity.company)
                    .textContentType(.organizationName)
                TextField("Location", text: $draft.identity.location)
                    .textContentType(.addressCity)
            }

            Section("Contact links") {
                TextField("GitHub username", text: $draft.identity.github)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()

                TextField("LinkedIn URL", text: $draft.identity.linkedin)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)

                TextField("X URL (optional)", text: $draft.identity.x.profileOrEmpty)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)

                TextField("Email", text: $draft.identity.email)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.emailAddress)
                    .textContentType(.emailAddress)

                Text("GitHub is a bare username. LinkedIn and X are full URLs including https://.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section {
                ProfileLinesEditor(
                    "Case-study slugs",
                    values: $draft.featured.projectSlugs,
                    hint: "One slug per line, in homepage order.",
                    monospaced: true
                )

                ProfileLinesEditor(
                    "Lab slugs",
                    values: $draft.featured.labSlugs,
                    hint: "One slug per line, in homepage order.",
                    monospaced: true
                )

                ProfileLinesEditor(
                    "Post slugs",
                    values: $draft.featured.postSlugs,
                    hint: "One slug per line, in homepage order.",
                    monospaced: true
                )
            } header: {
                Text("Featured on the homepage")
            } footer: {
                Text("Slugs may be curated before the matching content is published.")
            }

            Section {
                NavigationVisibilityToggle(
                    title: "Work",
                    route: "/work",
                    isOn: $draft.nav.work
                )
                NavigationVisibilityToggle(
                    title: "Labs",
                    route: "/labs",
                    isOn: $draft.nav.labs
                )
                NavigationVisibilityToggle(
                    title: "Writing",
                    route: "/blog",
                    isOn: $draft.nav.blog
                )
                NavigationVisibilityToggle(
                    title: "Fun",
                    route: "/fun",
                    isOn: $draft.nav.fun
                )
                NavigationVisibilityToggle(
                    title: "Résumé",
                    route: "/resume",
                    isOn: $draft.nav.resume
                )
                NavigationVisibilityToggle(
                    title: "Contact",
                    route: "/contact",
                    isOn: $draft.nav.contact
                )
            } header: {
                Text("Navigation visibility")
            } footer: {
                Text("These switches hide links; they do not make the routes private.")
            }

            if let validationMessage {
                Section {
                    Label(validationMessage, systemImage: "info.circle")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }

            Section("Save status") {
                if let displayedUpdatedAt {
                    LabeledContent("Last server update") {
                            Text(BackendDate.abbreviatedDateTime(displayedUpdatedAt))
                            .font(HorizonStyle.mono(.caption))
                            .multilineTextAlignment(.trailing)
                    }
                } else {
                    LabeledContent("Last server update", value: "Never")
                }

                LabeledContent("Unsaved changes", value: isDirty ? "Yes" : "No")

                Text(
                    "Live server changes are applied while this draft is clean. If both "
                        + "versions change, saving pauses and asks which one to keep."
                )
                .font(.caption)
                .foregroundStyle(.secondary)

                if let statusMessage {
                    Label(statusMessage, systemImage: "checkmark.circle")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .accessibilityElement(children: .combine)
                }
            }

            if hasSettings {
                Section {
                    Button("Delete site settings", systemImage: "trash", role: .destructive) {
                        showingDeleteConfirmation = true
                    }
                    .disabled(model.isBusy || isWorking)
                } footer: {
                    Text(
                        "Deletes the singleton settings record. The public site falls back "
                            + "to its bundled identity and curation defaults."
                    )
                }
            }
        }
        .disabled(isWorking)
        .navigationTitle("Site settings")
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Close") {
                    close()
                }
                .disabled(isWorking)
            }

            ToolbarItem(placement: .primaryAction) {
                Button(hasSettings ? "Save" : "Create") {
                    save()
                }
                .disabled(
                    !isDirty
                        || validationMessage != nil
                        || pendingServerChange != nil
                        || model.isBusy
                        || isWorking
                )
            }
        }
        .onChange(of: model.siteSettings) { _, newValue in
            receive(newValue)
        }
        .interactiveDismissDisabled(isDirty || isWorking)
        .confirmationDialog(
            "Discard changes?",
            isPresented: $showingDiscardConfirmation,
            titleVisibility: .visible
        ) {
            Button("Discard changes", role: .destructive) {
                dismiss()
            }
            Button("Keep editing", role: .cancel) {}
        }
        .confirmationDialog(
            "Reload the server version?",
            isPresented: $showingReloadConfirmation,
            titleVisibility: .visible
        ) {
            Button("Reload and discard my changes", role: .destructive) {
                reloadServerChange()
            }
            Button("Keep editing", role: .cancel) {}
        }
        .alert("Delete site settings?", isPresented: $showingDeleteConfirmation) {
            Button("Delete", role: .destructive) {
                deleteSiteSettings()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(
                "The live identity, availability, featured selections and navigation settings will be removed."
            )
        }
    }

    private var isDirty: Bool {
        draft != savedDraft
    }

    private var validationMessage: String? {
        let requiredFields: [(String, String)] = [
            ("headline", draft.headline),
            ("name", draft.identity.name),
            ("role", draft.identity.role),
            ("company", draft.identity.company),
            ("location", draft.identity.location),
            ("availability", draft.identity.availability),
            ("GitHub username", draft.identity.github),
            ("LinkedIn URL", draft.identity.linkedin),
            ("email", draft.identity.email),
        ]

        if let blank = requiredFields.first(where: { $0.1.profileIsBlank }) {
            return "Enter a value for \(blank.0)."
        }

        let github = draft.identity.github.profileTrimmed
        if github.count > 39
            || github.rangeOfCharacter(from: CharacterSet(charactersIn: "/: ")) != nil {
            return "GitHub must be a bare username with no URL or whitespace."
        }

        if !Self.isWebURL(draft.identity.linkedin) {
            return "Enter a complete LinkedIn URL including https://."
        }

        if let x = draft.identity.x, !x.profileIsBlank, !Self.isWebURL(x) {
            return "Enter a complete X URL including https://, or leave it blank."
        }

        let email = draft.identity.email.profileTrimmed
        if !email.contains("@") || email.contains(where: \.isWhitespace) {
            return "Enter a valid email address."
        }

        return nil
    }

    private static func isWebURL(_ value: String) -> Bool {
        guard let components = URLComponents(string: value.profileTrimmed),
              let scheme = components.scheme?.lowercased(),
              scheme == "https" || scheme == "http",
              components.host != nil
        else { return false }
        return true
    }

    private func save() {
        guard !isWorking else { return }
        var payload = draft
        isWorking = true
        Task {
            defer { isWorking = false }
            let result = await model.saveSiteSettings(payload)
            guard result.succeeded else { return }
            if let revision = result.outcome?.revision {
                payload.baseRevision = revision
            }
            draft = payload
            savedDraft = payload
            hasSettings = true
            clearMatchingServerEcho()
            statusMessage = "Site settings published"
        }
    }

    private func close() {
        if isDirty {
            showingDiscardConfirmation = true
        } else {
            dismiss()
        }
    }

    private func clearMatchingServerEcho() {
        if case .updated(let incoming)? = pendingServerChange,
           incoming == savedDraft {
            pendingServerChange = nil
        }
    }

    private func receive(_ record: SiteSettingsRecord?) {
        guard let record else {
            guard hasSettings else { return }
            displayedUpdatedAt = nil
            if isDirty {
                pendingServerChange = .deleted
            } else {
                let empty = SiteSettingsDraft()
                draft = empty
                savedDraft = empty
                hasSettings = false
            }
            return
        }

        let incoming = SiteSettingsDraft(record: record)
        displayedUpdatedAt = record.updatedAt
        hasSettings = true
        guard incoming != savedDraft else { return }

        if isDirty {
            pendingServerChange = .updated(incoming)
        } else {
            draft = incoming
            savedDraft = incoming
            pendingServerChange = nil
        }
    }

    private func keepDraft(over change: SiteSettingsServerChange) {
        switch change {
        case .updated(let incoming):
            draft.baseRevision = incoming.baseRevision
            savedDraft = incoming
            hasSettings = true
        case .deleted:
            draft.baseRevision = 0
            savedDraft = SiteSettingsDraft()
            hasSettings = false
        }
        pendingServerChange = nil
    }

    private func reloadServerChange() {
        guard let pendingServerChange else { return }
        switch pendingServerChange {
        case .updated(let incoming):
            draft = incoming
            savedDraft = incoming
            hasSettings = true
        case .deleted:
            let empty = SiteSettingsDraft()
            draft = empty
            savedDraft = empty
            hasSettings = false
        }
        self.pendingServerChange = nil
        statusMessage = "Loaded the latest server version"
    }

    private func deleteSiteSettings() {
        guard !isWorking else { return }
        isWorking = true
        Task {
            defer { isWorking = false }
            guard await model.deleteSiteSettings(expectedRevision: draft.baseRevision) else { return }
            savedDraft = draft
            displayedUpdatedAt = nil
            hasSettings = false
            dismiss()
        }
    }
}

private enum SiteSettingsServerChange: Equatable {
    case updated(SiteSettingsDraft)
    case deleted

    var message: String {
        switch self {
        case .updated:
            "Site settings changed elsewhere while you were editing."
        case .deleted:
            "Site settings were deleted elsewhere while you were editing."
        }
    }
}

private struct NavigationVisibilityToggle: View {
    let title: String
    let route: String
    @Binding var isOn: Bool

    var body: some View {
        Toggle(isOn: $isOn) {
            VStack(alignment: .leading, spacing: HorizonStyle.snug) {
                Text(title)
                Text(route)
                    .font(HorizonStyle.mono(.caption))
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityHint("Controls whether this destination is linked in the public navigation")
    }
}
