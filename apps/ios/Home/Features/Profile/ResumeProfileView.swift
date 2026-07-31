//
//  ResumeProfileView.swift
//  Home — résumé singleton editing and projection repair
//

import SwiftUI

struct ResumeEditorScreen: View {
    @Environment(HomeAppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var draft: ResumeDraft
    @State private var savedDraft: ResumeDraft
    @State private var hasDocument: Bool
    @State private var statusMessage: String?
    @State private var pendingServerChange: ResumeServerChange?
    @State private var showingDiscardConfirmation = false
    @State private var showingReloadConfirmation = false
    @State private var showingDeleteConfirmation = false
    @State private var pendingEducationRemoval: [UUID] = []
    @State private var isWorking = false

    init(initial: ResumeDraft, documentExists: Bool) {
        _draft = State(initialValue: initial)
        _savedDraft = State(initialValue: initial)
        _hasDocument = State(initialValue: documentExists)
    }

    var body: some View {
        Form {
            if let error = model.lastErrorMessage {
                Section {
                    ProfileInlineError(message: error)
                }
            }

            if !hasDocument {
                Section {
                    Label(
                        "No résumé document exists yet. Saving creates it and projects "
                            + "the experience entries into it.",
                        systemImage: "doc.badge.plus"
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

            Section("Summary") {
                TextField("Professional summary", text: $draft.summary, axis: .vertical)
                    .lineLimit(6...14)

                Toggle("Embed live Git statistics", isOn: $draft.embedGitStats)
            }

            Section("Capabilities") {
                ProfileLinesEditor(
                    "Capability list",
                    values: $draft.capabilities,
                    hint: "One capability per line, in print order."
                )
            }

            Section {
                if draft.education.isEmpty {
                    Text("No education entries")
                        .foregroundStyle(.secondary)
                }

                ForEach($draft.education) { $education in
                    DisclosureGroup(
                        education.institution.profileIsBlank
                            ? "New education entry"
                            : education.institution
                    ) {
                        TextField("Institution", text: $education.institution)
                        TextField("Credential", text: $education.credential)

                        VStack(alignment: .leading, spacing: HorizonStyle.stack) {
                            TextField("Started", text: $education.start)
                            TextField("Ended", text: $education.end)
                        }

                        Text("Education dates are free-form print labels, such as “2011” or “Present”.")
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        Button("Remove education", systemImage: "trash", role: .destructive) {
                            pendingEducationRemoval = [education.id]
                        }
                    }
                }
                .onDelete { offsets in
                    pendingEducationRemoval = offsets.compactMap { index in
                        draft.education.indices.contains(index)
                            ? draft.education[index].id
                            : nil
                    }
                }
                .onMove { offsets, destination in
                    draft.education.move(fromOffsets: offsets, toOffset: destination)
                }

                Button("Add education", systemImage: "plus") {
                    draft.education.append(ResumeEducation())
                }
            } header: {
                Text("Education")
            } footer: {
                Text("Use Edit to reorder entries. All four fields are required when an entry is present.")
            }

            Section("Work-history projection") {
                LabeledContent("Source entries") {
                    Text(model.experienceEntries.count, format: .number)
                        .font(HorizonStyle.mono(.body))
                        .horizonNumerals()
                }

                if let projectedCount = model.resumeDocument?.experience.count {
                    LabeledContent("Currently projected") {
                        Text(projectedCount, format: .number)
                            .font(HorizonStyle.mono(.body))
                            .horizonNumerals()
                    }
                }

                Button("Rebuild from experience", systemImage: "arrow.triangle.2.circlepath") {
                    syncFromExperience()
                }
                .disabled(!hasDocument || model.isBusy || isWorking)

                if !hasDocument {
                    Text("Save the résumé once before rebuilding its work history.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            if hasDocument {
                Section {
                    Button("Delete résumé", systemImage: "trash", role: .destructive) {
                        showingDeleteConfirmation = true
                    }
                    .disabled(model.isBusy || isWorking)
                } footer: {
                    Text(
                        "Deletes the résumé document. Experience entries remain and can "
                            + "be projected into a new résumé later."
                    )
                }
            }

            if let validationMessage {
                Section {
                    Label(validationMessage, systemImage: "info.circle")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }

            if let statusMessage {
                Section {
                    Label(statusMessage, systemImage: "checkmark.circle")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .accessibilityElement(children: .combine)
                }
            }
        }
        .disabled(isWorking)
        .navigationTitle("Résumé")
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Close") {
                    close()
                }
                .disabled(isWorking)
            }

            ToolbarItem(placement: .topBarTrailing) {
                EditButton()
                    .disabled(draft.education.count < 2 || isWorking)
            }

            ToolbarItem(placement: .primaryAction) {
                Button(hasDocument ? "Save" : "Create") {
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
        .onChange(of: model.resumeDocument) { _, newValue in
            receive(newValue)
        }
        .interactiveDismissDisabled(isDirty || isWorking)
        .confirmationDialog(
            pendingEducationRemoval.count == 1
                ? "Remove education entry?"
                : "Remove education entries?",
            isPresented: Binding(
                get: { !pendingEducationRemoval.isEmpty },
                set: { if !$0 { pendingEducationRemoval = [] } }
            ),
            titleVisibility: .visible
        ) {
            Button("Remove", role: .destructive) {
                let ids = Set(pendingEducationRemoval)
                draft.education.removeAll { ids.contains($0.id) }
                pendingEducationRemoval = []
            }
            Button("Keep", role: .cancel) {}
        } message: {
            Text("The selected education information is removed from this draft. You can still cancel the editor to discard the change.")
        }
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
        .alert("Delete résumé?", isPresented: $showingDeleteConfirmation) {
            Button("Delete", role: .destructive) {
                deleteResume()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(
                "The public résumé document will be removed. Your normalised experience entries are not deleted."
            )
        }
    }

    private var isDirty: Bool {
        draft != savedDraft
    }

    private var validationMessage: String? {
        if draft.summary.profileIsBlank {
            return "Enter a professional summary."
        }

        for education in draft.education {
            if education.institution.profileIsBlank
                || education.credential.profileIsBlank
                || education.start.profileIsBlank
                || education.end.profileIsBlank {
                return "Complete every field in each education entry."
            }
        }

        return nil
    }

    private func save() {
        guard !isWorking else { return }
        var payload = draft
        isWorking = true
        Task {
            defer { isWorking = false }
            let result = await model.saveResume(payload)
            guard result.succeeded else { return }
            if let revision = result.outcome?.revision {
                payload.baseRevision = revision
            }
            draft = payload
            savedDraft = payload
            hasDocument = true
            clearMatchingServerEcho()
            statusMessage = "Résumé saved and work history rebuilt"
        }
    }

    private func syncFromExperience() {
        guard !isWorking else { return }
        isWorking = true
        Task {
            defer { isWorking = false }
            let result = await model.syncResume(expectedRevision: draft.baseRevision)
            guard result.succeeded else { return }
            if let revision = result.outcome?.revision {
                draft.baseRevision = revision
                savedDraft.baseRevision = revision
            }
            clearMatchingServerEcho()
            statusMessage = model.experienceEntries.count == 1
                ? "Work history rebuilt from 1 role"
                : "Work history rebuilt from \(model.experienceEntries.count) roles"
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

    private func receive(_ record: ResumeRecord?) {
        guard let record else {
            guard hasDocument else { return }
            if isDirty {
                pendingServerChange = .deleted
            } else {
                let empty = ResumeDraft()
                draft = empty
                savedDraft = empty
                hasDocument = false
            }
            return
        }

        let incoming = ResumeDraft(record: record)
        hasDocument = true
        guard incoming != savedDraft else { return }

        if isDirty {
            pendingServerChange = .updated(incoming)
        } else {
            draft = incoming
            savedDraft = incoming
            pendingServerChange = nil
        }
    }

    private func keepDraft(over change: ResumeServerChange) {
        switch change {
        case .updated(let incoming):
            draft.baseRevision = incoming.baseRevision
            savedDraft = incoming
            hasDocument = true
        case .deleted:
            draft.baseRevision = 0
            savedDraft = ResumeDraft()
            hasDocument = false
        }
        pendingServerChange = nil
    }

    private func reloadServerChange() {
        guard let pendingServerChange else { return }
        switch pendingServerChange {
        case .updated(let incoming):
            draft = incoming
            savedDraft = incoming
            hasDocument = true
        case .deleted:
            let empty = ResumeDraft()
            draft = empty
            savedDraft = empty
            hasDocument = false
        }
        self.pendingServerChange = nil
        statusMessage = "Loaded the latest server version"
    }

    private func deleteResume() {
        guard !isWorking else { return }
        isWorking = true
        Task {
            defer { isWorking = false }
            guard await model.deleteResume(expectedRevision: draft.baseRevision) else { return }
            savedDraft = draft
            hasDocument = false
            dismiss()
        }
    }
}

private enum ResumeServerChange: Equatable {
    case updated(ResumeDraft)
    case deleted

    var message: String {
        switch self {
        case .updated:
            "The résumé changed elsewhere while you were editing."
        case .deleted:
            "The résumé was deleted elsewhere while you were editing."
        }
    }
}
