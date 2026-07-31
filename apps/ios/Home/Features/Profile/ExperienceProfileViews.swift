//
//  ExperienceProfileViews.swift
//  Home — normalised résumé experience CRUD
//

import SwiftUI

struct ExperienceListScreen: View {
    @Environment(HomeAppModel.self) private var model

    @State private var editorDraft: ExperienceDraft?
    @State private var pendingDelete: ExperienceDeleteTarget?
    @State private var movingID: String?

    var body: some View {
        List {
            if let error = model.lastErrorMessage {
                Section {
                    ProfileInlineError(message: error)
                }
            }

            Section {
                if orderedEntries.isEmpty {
                    ContentUnavailableView(
                        "No roles yet",
                        systemImage: "briefcase",
                        description: Text(
                            "Add a role to build the work-history section of the résumé."
                        )
                    )
                } else {
                    ForEach(Array(orderedEntries.enumerated()), id: \.element.id) {
                        index,
                        entry in
                        ExperienceRow(
                            entry: entry,
                            canMoveEarlier: index > orderedEntries.startIndex,
                            canMoveLater: index < orderedEntries.index(before: orderedEntries.endIndex),
                            isMoving: movingID == entry.id,
                            edit: { editorDraft = ExperienceDraft(record: entry) },
                            moveEarlier: { move(entry, by: -1) },
                            moveLater: { move(entry, by: 1) }
                        )
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button("Delete", systemImage: "trash", role: .destructive) {
                                pendingDelete = ExperienceDeleteTarget(
                                    id: entry.id,
                                    title: "\(entry.title) at \(entry.company)",
                                    expectedRevision: entry.revision
                                )
                            }
                        }
                    }
                }
            } header: {
                Text("Résumé order")
            } footer: {
                Text("The top row prints first. Every write rebuilds the résumé’s work history.")
            }
        }
        .navigationTitle("Experience")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Add role", systemImage: "plus") {
                    editorDraft = newDraft()
                }
                .disabled(model.isBusy)
            }
        }
        .sheet(item: $editorDraft) { draft in
            ExperienceEditorSheet(initial: draft)
        }
        .alert(
            "Delete role?",
            isPresented: deleteAlertPresented,
            presenting: pendingDelete
        ) { target in
            Button("Delete", role: .destructive) {
                delete(target)
            }
            Button("Cancel", role: .cancel) {}
        } message: { target in
            Text(
                "\(target.title) will be removed permanently and the résumé will be rebuilt without it."
            )
        }
    }

    private var orderedEntries: [ExperienceRecord] {
        model.experienceEntries.sorted {
            if $0.sortOrder == $1.sortOrder {
                return $0.creationTime < $1.creationTime
            }
            return $0.sortOrder < $1.sortOrder
        }
    }

    private var deleteAlertPresented: Binding<Bool> {
        Binding(
            get: { pendingDelete != nil },
            set: { isPresented in
                if !isPresented {
                    pendingDelete = nil
                }
            }
        )
    }

    private func newDraft() -> ExperienceDraft {
        var draft = ExperienceDraft()
        draft.sortOrder = (orderedEntries.first?.sortOrder ?? 1) - 1
        return draft
    }

    private func move(_ entry: ExperienceRecord, by offset: Int) {
        guard movingID == nil,
              let source = orderedEntries.firstIndex(where: { $0.id == entry.id })
        else { return }

        let destination = source + offset
        guard orderedEntries.indices.contains(destination) else { return }
        let neighbour = orderedEntries[destination]

        movingID = entry.id
        Task {
            defer { movingID = nil }

            if entry.sortOrder == neighbour.sortOrder {
                guard let repairedOrder = availableOrder(
                    startingAfter: entry.sortOrder,
                    direction: offset
                ) else {
                    model.lastErrorMessage = "No safe sort-order value is available for this move."
                    return
                }
                let result = await model.moveExperience(
                    entry.id,
                    to: repairedOrder,
                    expectedRevision: entry.revision
                )
                guard result.succeeded else { return }
                return
            }

            let result = await model.swapExperience(
                entry.id,
                neighbour.id,
                firstExpectedRevision: entry.revision,
                secondExpectedRevision: neighbour.revision
            )
            guard result.succeeded else { return }
        }
    }

    private func availableOrder(startingAfter value: Double, direction: Int) -> Double? {
        let limit = 100_000.0
        let occupied = Set(orderedEntries.map(\.sortOrder))
        var candidate = value + Double(direction)

        while abs(candidate) <= limit {
            if !occupied.contains(candidate) {
                return candidate
            }
            candidate += Double(direction)
        }
        return nil
    }

    private func delete(_ target: ExperienceDeleteTarget) {
        Task {
            if await model.deleteExperience(
                target.id,
                expectedRevision: target.expectedRevision
            ) {
                pendingDelete = nil
            }
        }
    }
}

private struct ExperienceDeleteTarget: Identifiable {
    let id: String
    let title: String
    let expectedRevision: Double?
}

private struct ExperienceRow: View {
    let entry: ExperienceRecord
    let canMoveEarlier: Bool
    let canMoveLater: Bool
    let isMoving: Bool
    let edit: () -> Void
    let moveEarlier: () -> Void
    let moveLater: () -> Void

    var body: some View {
        HStack(spacing: HorizonStyle.stack) {
            Button(action: edit) {
                VStack(alignment: .leading, spacing: HorizonStyle.snug) {
                    Text(entry.title)
                        .font(.headline)
                        .foregroundStyle(.primary)

                    Text(entry.company)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)

                    HStack(spacing: HorizonStyle.stack) {
                        Label(period, systemImage: "calendar")
                        Label(
                            "\(entry.highlights.count)",
                            systemImage: "list.bullet"
                        )
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(
                "\(entry.title) at \(entry.company), \(period), \(entry.highlights.count) highlights"
            )
            .accessibilityHint("Opens this role for editing")

            if isMoving {
                ProgressView()
                    .controlSize(.small)
                    .accessibilityLabel("Reordering role")
            } else {
                Menu("Reorder role", systemImage: "arrow.up.arrow.down") {
                    Button("Move earlier", systemImage: "arrow.up") {
                        moveEarlier()
                    }
                    .disabled(!canMoveEarlier)

                    Button("Move later", systemImage: "arrow.down") {
                        moveLater()
                    }
                    .disabled(!canMoveLater)
                }
                .labelStyle(.iconOnly)
                .frame(minWidth: 44, minHeight: 44)
            }
        }
        .padding(.vertical, HorizonStyle.snug)
    }

    private var period: String {
        let start = Self.monthLabel(entry.startDate)
        let end = entry.endDate.map(Self.monthLabel) ?? "Present"
        return "\(start) to \(end)"
    }

    private static func monthLabel(_ value: String) -> String {
        guard value.count >= 7 else { return value }
        return String(value.prefix(7))
    }
}

private struct ExperienceEditorSheet: View {
    @Environment(HomeAppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var draft: ExperienceDraft
    @State private var savedDraft: ExperienceDraft
    @State private var currentRole: Bool
    @State private var savedCurrentRole: Bool
    @State private var showingDiscardConfirmation = false
    @State private var showingReloadConfirmation = false
    @State private var isWorking = false
    @State private var pendingServerChange: ExperienceServerChange?

    init(initial: ExperienceDraft) {
        let isCurrent = initial.endDate.isEmpty
        _draft = State(initialValue: initial)
        _savedDraft = State(initialValue: initial)
        _currentRole = State(initialValue: isCurrent)
        _savedCurrentRole = State(initialValue: isCurrent)
    }

    var body: some View {
        NavigationStack {
            Form {
                if let pendingServerChange {
                    ContentExternalChangeNotice(
                        message: pendingServerChange.message,
                        reload: { showingReloadConfirmation = true },
                        keepDraft: { keepDraft(over: pendingServerChange) }
                    )
                }

                if let error = model.lastErrorMessage {
                    Section {
                        ProfileInlineError(message: error)
                    }
                }

                Section("Role") {
                    TextField("Title", text: $draft.title)
                        .textContentType(.jobTitle)
                    TextField("Company", text: $draft.company)
                        .textContentType(.organizationName)
                    TextField("Summary", text: $draft.summary, axis: .vertical)
                        .lineLimit(4...10)
                }

                Section("Dates") {
                    TextField("Started (YYYY-MM-DD)", text: $draft.startDate)
                        .keyboardType(.numbersAndPunctuation)
                        .textInputAutocapitalization(.never)

                    Toggle("Current role", isOn: $currentRole)

                    TextField("Ended (YYYY-MM-DD)", text: $draft.endDate)
                        .keyboardType(.numbersAndPunctuation)
                        .textInputAutocapitalization(.never)
                        .disabled(currentRole)

                    Text(
                        currentRole
                            ? "The résumé prints “Present” and stores no end date."
                            : "The end date must be on or after the start date."
                    )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }

                Section("Highlights and links") {
                    ProfileLinesEditor(
                        "Highlights",
                        values: $draft.highlights,
                        hint: "One achievement per line, in print order."
                    )

                    ProfileLinesEditor(
                        "Skills",
                        values: $draft.skills,
                        hint: "One skill per line."
                    )

                    ProfileLinesEditor(
                        "Case-study slugs",
                        values: $draft.projectSlugs,
                        hint: "One slug per line.",
                        monospaced: true
                    )
                }

                if let validationMessage {
                    Section {
                        Label(validationMessage, systemImage: "info.circle")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .disabled(isWorking)
            .navigationTitle(draft.recordID == nil ? "New role" : "Edit role")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        cancel()
                    }
                    .disabled(isWorking)
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button(draft.recordID == nil ? "Create" : "Save") {
                        save()
                    }
                    .disabled(
                        !isDirty || validationMessage != nil || model.isBusy || isWorking
                            || pendingServerChange != nil
                    )
                }
            }
            .interactiveDismissDisabled(isDirty || isWorking)
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
            .onChange(of: currentRecord) { _, record in
                receive(record)
            }
        }
    }

    private var currentRecord: ExperienceRecord? {
        guard let recordID = draft.recordID else { return nil }
        return model.experienceEntries.first(where: { $0.id == recordID })
    }

    private var isDirty: Bool {
        draft != savedDraft || currentRole != savedCurrentRole
    }

    private var validationMessage: String? {
        if draft.title.profileIsBlank {
            return "Enter a role title."
        }
        if draft.company.profileIsBlank {
            return "Enter a company."
        }
        if draft.summary.profileIsBlank {
            return "Enter a role summary."
        }
        if !ProfileDateValidation.isCalendarDate(draft.startDate) {
            return "Enter the start date as a real calendar date in YYYY-MM-DD form."
        }
        if !currentRole {
            if !ProfileDateValidation.isCalendarDate(draft.endDate) {
                return "Enter the end date as a real calendar date in YYYY-MM-DD form."
            }
            if draft.endDate < draft.startDate {
                return "The end date cannot be before the start date."
            }
        }
        return nil
    }

    private func cancel() {
        if isDirty {
            showingDiscardConfirmation = true
        } else {
            dismiss()
        }
    }

    private func save() {
        guard !isWorking else { return }
        var payload = draft
        if currentRole {
            payload.endDate = ""
        }

        isWorking = true
        Task {
            defer { isWorking = false }
            let result = await model.saveExperience(payload)
            guard result.succeeded else { return }
            if let revision = result.outcome?.revision {
                payload.baseRevision = revision
            }
            draft = payload
            savedDraft = payload
            savedCurrentRole = currentRole
            dismiss()
        }
    }

    private func receive(_ record: ExperienceRecord?) {
        guard let record else {
            guard draft.recordID != nil else { return }
            pendingServerChange = .deleted
            return
        }

        let incoming = ExperienceDraft(record: record)
        guard incoming != savedDraft else { return }
        let incomingCurrentRole = incoming.endDate.isEmpty
        if isDirty {
            pendingServerChange = .updated(incoming)
        } else {
            draft = incoming
            savedDraft = incoming
            currentRole = incomingCurrentRole
            savedCurrentRole = incomingCurrentRole
            pendingServerChange = nil
        }
    }

    private func keepDraft(over change: ExperienceServerChange) {
        switch change {
        case .updated(let incoming):
            draft.baseRevision = incoming.baseRevision
            savedDraft = incoming
            savedCurrentRole = incoming.endDate.isEmpty
        case .deleted:
            draft.recordID = nil
            draft.baseRevision = 0
            savedDraft = ExperienceDraft()
            savedCurrentRole = true
        }
        pendingServerChange = nil
    }

    private func reloadServerChange() {
        guard let pendingServerChange else { return }
        switch pendingServerChange {
        case .updated(let incoming):
            draft = incoming
            savedDraft = incoming
            currentRole = incoming.endDate.isEmpty
            savedCurrentRole = currentRole
            self.pendingServerChange = nil
        case .deleted:
            dismiss()
        }
    }
}

private enum ExperienceServerChange: Equatable {
    case updated(ExperienceDraft)
    case deleted

    var message: String {
        switch self {
        case .updated: "This role changed elsewhere while you were editing."
        case .deleted: "This role was deleted elsewhere while you were editing."
        }
    }
}
