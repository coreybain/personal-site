//
//  LabsScreen.swift
//  Home
//

import SwiftUI

struct LabsScreen: View {
    @Environment(HomeAppModel.self) private var model
    @State private var presentedDraft: LabDraft?
    @State private var deletionTarget: ContentDeleteTarget?
    @State private var publicationTarget: ContentPublicationTarget?
    @State private var operationError: String?
    @State private var hasLoaded = false

    var body: some View {
        List {
            if let error = model.lastErrorMessage, !model.labs.isEmpty {
                Section {
                    ContentInlineError(message: error)
                }
            }

            ForEach(model.labs) { lab in
                HStack(spacing: HorizonStyle.snug) {
                    Button {
                        presentedDraft = LabDraft(record: lab)
                    } label: {
                        LabRow(lab: lab)
                    }
                    .buttonStyle(.plain)

                    Menu("Lab actions", systemImage: "ellipsis") {
                        Button("Edit", systemImage: "pencil") {
                            presentedDraft = LabDraft(record: lab)
                        }

                        if lab.published {
                            Button("Unpublish", systemImage: "eye.slash") {
                                requestPublicationChange(for: lab, publish: false)
                            }
                        } else {
                            Button("Publish", systemImage: "paperplane") {
                                requestPublicationChange(for: lab, publish: true)
                            }
                        }

                        Button("Delete", systemImage: "trash", role: .destructive) {
                            deletionTarget = ContentDeleteTarget(
                                id: lab.id,
                                title: lab.title,
                                expectedRevision: lab.revision
                            )
                        }
                    }
                    .labelStyle(.iconOnly)
                    .disabled(model.isBusy)
                }
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    Button("Delete", systemImage: "trash", role: .destructive) {
                        deletionTarget = ContentDeleteTarget(
                            id: lab.id,
                            title: lab.title,
                            expectedRevision: lab.revision
                        )
                    }

                    Button(
                        lab.published ? "Unpublish" : "Publish",
                        systemImage: lab.published ? "eye.slash" : "paperplane"
                    ) {
                        requestPublicationChange(for: lab, publish: !lab.published)
                    }
                    .tint(HorizonStyle.accent)
                }
            }
        }
        .navigationTitle("Labs")
        .overlay {
            if let overlayState {
                ContentCollectionOverlay(state: overlayState, retry: refresh)
            }
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("New Lab", systemImage: "plus") {
                    presentedDraft = newDraft()
                }
                .disabled(model.isBusy)
            }
        }
        .sheet(item: $presentedDraft) { draft in
            LabEditorView(draft: draft)
        }
        .confirmationDialog(
            "Change lab publication?",
            isPresented: Binding(
                get: { publicationTarget != nil },
                set: { if !$0 { publicationTarget = nil } }
            ),
            titleVisibility: .visible
        ) {
            if let target = publicationTarget {
                Button(target.publish ? "Publish \(target.title)" : "Unpublish \(target.title)") {
                    Task {
                        await setPublished(target)
                        publicationTarget = nil
                    }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(
                publicationTarget?.publish == true
                    ? "This makes the lab visible on the public site."
                    : "This removes the lab from the public site without deleting its draft."
            )
        }
        .confirmationDialog(
            "Delete lab?",
            isPresented: Binding(
                get: { deletionTarget != nil },
                set: { if !$0 { deletionTarget = nil } }
            ),
            titleVisibility: .visible
        ) {
            if let deletionTarget {
                Button("Delete \(deletionTarget.title)", role: .destructive) {
                    Task { await delete(deletionTarget) }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This removes the lab record. Its cover upload may need separate CDN cleanup.")
        }
        .alert(
            "Couldn’t complete action",
            isPresented: Binding(
                get: { operationError != nil },
                set: { if !$0 { operationError = nil } }
            )
        ) {
            Button("OK") { operationError = nil }
        } message: {
            Text(operationError ?? "Try again.")
        }
        .refreshable {
            await refresh()
        }
        .task {
            guard !hasLoaded else { return }
            await refresh()
        }
    }

    private func newDraft() -> LabDraft {
        var draft = LabDraft()
        let maximum = model.labs.lazy.map(\.sortOrder).filter(\.isFinite).max() ?? -1
        draft.sortOrder = min(maximum + 1, 1_000_000_000)
        return draft
    }

    private var overlayState: ContentCollectionOverlay.State? {
        if !hasLoaded && model.labs.isEmpty {
            return .loading
        }
        if model.labs.isEmpty, let error = model.lastErrorMessage {
            return .failure(title: "Couldn’t load labs", message: error)
        }
        if model.labs.isEmpty {
            return .empty(
                title: "No Labs",
                systemImage: "hammer",
                description: "Add a repository-backed side project to start the Labs index."
            )
        }
        return nil
    }

    private func refresh() async {
        model.clearError()
        await model.refreshSubscriptions()
        hasLoaded = true
    }

    private func setPublished(_ target: ContentPublicationTarget) async {
        let result: MutationResult
        if target.publish {
            result = await model.publishLab(
                id: target.id,
                expectedRevision: target.expectedRevision
            )
        } else {
            result = await model.unpublishLab(
                id: target.id,
                expectedRevision: target.expectedRevision
            )
        }
        if !result.succeeded {
            operationError = result.errorMessage
                ?? "The publication state could not be changed."
        }
    }

    private func requestPublicationChange(for lab: LabRecord, publish: Bool) {
        publicationTarget = ContentPublicationTarget(
            id: lab.id,
            title: lab.title,
            publish: publish,
            expectedRevision: lab.revision
        )
    }

    private func delete(_ target: ContentDeleteTarget) async {
        let succeeded = await model.deleteLab(
            id: target.id,
            expectedRevision: target.expectedRevision
        )
        if succeeded {
            deletionTarget = nil
        } else {
            operationError = model.lastErrorMessage ?? "The lab could not be deleted."
        }
    }
}

private struct LabRow: View {
    let lab: LabRecord

    var body: some View {
        VStack(alignment: .leading, spacing: HorizonStyle.snug) {
            HStack(alignment: .firstTextBaseline) {
                Text(lab.title)
                    .font(.headline)
                    .lineLimit(2)
                Spacer()
                Text(lab.language)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Text(lab.repoFullName)
                .font(HorizonStyle.monoCaption)
                .foregroundStyle(.secondary)
                .lineLimit(1)

            HStack {
                ContentStatusLabel(isPublished: lab.published, isFeatured: lab.featured)
                Spacer()
                Label(lab.liveStats.stars.formatted(), systemImage: "star")
                Label(lab.liveStats.forks.formatted(), systemImage: "arrow.triangle.branch")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .horizonNumerals()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, HorizonStyle.snug)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens the lab editor")
    }
}

struct LabEditorView: View {
    @Environment(HomeAppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var draft: LabDraft
    @State private var savedDraft: LabDraft
    @State private var isWorking = false
    @State private var activeUploads = 0
    @State private var operationError: String?
    @State private var confirmsDeletion = false
    @State private var confirmsDiscard = false
    @State private var confirmsServerReload = false
    @State private var pendingSlugRenameIntent: ContentSaveIntent?
    @State private var pendingServerChange: LabServerChange?

    init(draft: LabDraft) {
        _draft = State(initialValue: draft)
        _savedDraft = State(initialValue: draft)
    }

    var body: some View {
        NavigationStack {
            Form {
                if let pendingServerChange {
                    ContentExternalChangeNotice(
                        message: pendingServerChange.message,
                        reload: { confirmsServerReload = true },
                        keepDraft: { keepDraft(over: pendingServerChange) }
                    )
                }

                Section("Identity") {
                    TextField("Title", text: $draft.title)
                    TextField("Slug", text: $draft.slug)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("Summary", text: $draft.summary, axis: .vertical)
                        .lineLimit(3...10)
                    TextField("Repository (owner/name)", text: $draft.repoFullName)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("Language", text: $draft.language)
                }

                Section("Cover") {
                    MediaAssetEditor(
                        title: "Lab cover",
                        asset: $draft.coverImage,
                        showsSanitisation: false,
                        onUploadActivity: updateUploadActivity
                    )
                }

                Section("Links") {
                    TextField("Repository URL", text: $draft.links.repo)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                    TextField("Live URL", text: $draft.links.live.contentOrEmpty)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                    TextField("Docs URL", text: $draft.links.docs.contentOrEmpty)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                }

                Section {
                    Label("Managed by GitHub sync", systemImage: "arrow.trianglehead.2.clockwise.rotate.90")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    LabeledContent("Stars", value: draft.liveStats.stars.formatted())
                    LabeledContent("Forks", value: draft.liveStats.forks.formatted())
                    LabeledContent(
                        "Commits in trailing year",
                        value: draft.liveStats.commitsYear.formatted()
                    )
                    LabeledContent(
                        "Days since last push",
                        value: draft.liveStats.lastPushDaysAgo.formatted()
                    )
                    LabeledContent(
                        "Last pushed",
                        value: draft.liveStats.lastPushedAt.map(BackendDate.abbreviatedDateTime)
                            ?? "Unknown"
                    )
                    LabeledContent(
                        "Last synced",
                        value: draft.liveStats.syncedAt.map(BackendDate.abbreviatedDateTime)
                            ?? "Not yet"
                    )
                } header: {
                    Text("Live stats")
                } footer: {
                    Text("Read-only. The scheduled GitHub sync updates these values.")
                }

                Section("Presentation") {
                    Toggle("Featured", isOn: $draft.featured)
                    RequiredNumberField(
                        "Sort order",
                        value: $draft.sortOrder,
                        wholeNumber: true,
                        range: 0...1_000_000_000
                    )
                }

                if draft.recordID != nil {
                    Section("Publication") {
                        ContentStatusLabel(isPublished: isPublished, isFeatured: draft.featured)

                        Button(
                            isPublished ? "Save & Unpublish" : "Save & Publish",
                            systemImage: isPublished ? "eye.slash" : "paperplane"
                        ) {
                            request(.publication(!isPublished))
                        }
                        .disabled(!canSave || operationInFlight || model.isBusy)

                        Button("Delete Lab", systemImage: "trash", role: .destructive) {
                            confirmsDeletion = true
                        }
                        .disabled(operationInFlight || model.isBusy || pendingServerChange != nil)
                    }
                }

                if !canSave {
                    Section {
                        Text("Complete every required field. The cover needs a URL and alternative text, and sort order must be a non-negative whole number.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .disabled(operationInFlight)
            .navigationTitle(draft.recordID == nil ? "New Lab" : "Edit Lab")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { cancel() }
                        .disabled(operationInFlight)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        request(.save)
                    }
                    .disabled(
                        !canSave
                            || operationInFlight
                            || model.isBusy
                            || pendingServerChange != nil
                    )
                }
            }
            .interactiveDismissDisabled(isDirty || operationInFlight)
            .confirmationDialog(
                "Reload the server version?",
                isPresented: $confirmsServerReload,
                titleVisibility: .visible
            ) {
                Button("Reload and discard my changes", role: .destructive) {
                    reloadServerChange()
                }
                Button("Keep editing", role: .cancel) {}
            }
            .confirmationDialog(
                "Rename lab slug?",
                isPresented: Binding(
                    get: { pendingSlugRenameIntent != nil },
                    set: { if !$0 { pendingSlugRenameIntent = nil } }
                ),
                titleVisibility: .visible
            ) {
                Button("Rename and continue", role: .destructive) {
                    guard let intent = pendingSlugRenameIntent else { return }
                    pendingSlugRenameIntent = nil
                    perform(intent)
                }
                Button("Keep editing", role: .cancel) {}
            } message: {
                Text(
                    "Changing this slug breaks existing inbound links and "
                        + "featured-slug references to the old value."
                )
            }
            .confirmationDialog(
                "Discard changes?",
                isPresented: $confirmsDiscard,
                titleVisibility: .visible
            ) {
                Button("Discard changes", role: .destructive) { dismiss() }
                Button("Keep editing", role: .cancel) {}
            } message: {
                Text("Unsaved lab changes will be lost.")
            }
            .confirmationDialog(
                "Delete lab?",
                isPresented: $confirmsDeletion,
                titleVisibility: .visible
            ) {
                Button("Delete Lab", role: .destructive) {
                    Task { await delete() }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This cannot be undone. The cover upload may need separate CDN cleanup.")
            }
            .alert(
                "Couldn’t complete action",
                isPresented: Binding(
                    get: { operationError != nil },
                    set: { if !$0 { operationError = nil } }
                )
            ) {
                Button("OK") { operationError = nil }
            } message: {
                Text(operationError ?? "Try again.")
            }
            .onChange(of: currentRecord) { _, record in
                receive(record)
            }
        }
    }

    private var currentRecord: LabRecord? {
        guard let recordID = draft.recordID else { return nil }
        return model.labs.first(where: { $0.id == recordID })
    }

    private var isPublished: Bool {
        currentRecord?.published ?? false
    }

    private var isDirty: Bool { draft != savedDraft }

    private var slugChanged: Bool {
        draft.recordID != nil && draft.slug != savedDraft.slug
    }

    private var operationInFlight: Bool { isWorking || activeUploads > 0 }

    private var canSave: Bool {
        let required = [
            draft.slug, draft.title, draft.summary, draft.repoFullName,
            draft.language, draft.links.repo,
        ]
        return required.allSatisfy { !$0.contentIsBlank }
            && draft.coverImage.contentIsValid
            && draft.sortOrder.isFinite
            && draft.sortOrder.rounded() == draft.sortOrder
            && draft.sortOrder >= 0
    }

    private func save() async {
        isWorking = true
        defer { isWorking = false }
        let result = await model.saveLab(draft)
        if result.succeeded {
            adoptSavedMutation(result.outcome)
            dismiss()
        } else {
            operationError = result.errorMessage ?? "The lab could not be saved."
        }
    }

    private func request(_ intent: ContentSaveIntent) {
        if slugChanged {
            pendingSlugRenameIntent = intent
        } else {
            perform(intent)
        }
    }

    private func perform(_ intent: ContentSaveIntent) {
        switch intent {
        case .save:
            Task { await save() }
        case .publication(let published):
            guard let recordID = draft.recordID else { return }
            Task { await saveAndSetPublished(published, id: recordID) }
        }
    }

    private func saveAndSetPublished(_ published: Bool, id: String) async {
        isWorking = true
        defer { isWorking = false }

        if !published {
            let unpublishResult = await model.unpublishLab(
                id: id,
                expectedRevision: draft.baseRevision
            )
            guard unpublishResult.succeeded else {
                operationError = unpublishResult.errorMessage
                    ?? "The lab could not be unpublished."
                return
            }
            adoptMutationRevision(unpublishResult.outcome)
            let saveResult = await model.saveLab(draft)
            guard saveResult.succeeded else {
                let detail = saveResult.errorMessage
                    ?? "The edited fields could not be saved."
                operationError = "The lab is already unpublished. "
                    + "Saving its edited fields failed: \(detail) "
                    + "Your edits remain in this form; try Save again."
                return
            }
            adoptSavedMutation(saveResult.outcome)
            dismiss()
            return
        }

        let saveResult = await model.saveLab(draft)
        guard saveResult.succeeded else {
            operationError = saveResult.errorMessage ?? "The lab could not be saved."
            return
        }
        adoptSavedMutation(saveResult.outcome)

        let publishResult = await model.publishLab(
            id: id,
            expectedRevision: draft.baseRevision
        )

        if publishResult.succeeded {
            adoptMutationRevision(publishResult.outcome)
            dismiss()
        } else {
            operationError = publishResult.errorMessage
                ?? "The publication state could not be changed."
        }
    }

    private func delete() async {
        guard let recordID = draft.recordID else { return }
        isWorking = true
        defer { isWorking = false }
        if await model.deleteLab(
            id: recordID,
            expectedRevision: draft.baseRevision
        ) {
            dismiss()
        } else {
            operationError = model.lastErrorMessage ?? "The lab could not be deleted."
        }
    }

    private func cancel() {
        if isDirty {
            confirmsDiscard = true
        } else {
            dismiss()
        }
    }

    private func updateUploadActivity(_ started: Bool) {
        activeUploads = max(0, activeUploads + (started ? 1 : -1))
    }

    private func adoptMutationRevision(_ outcome: MutationOutcome?) {
        guard let revision = outcome?.revision else { return }
        draft.baseRevision = revision
        savedDraft.baseRevision = revision
        clearMatchingServerEcho()
    }

    private func adoptSavedMutation(_ outcome: MutationOutcome?) {
        if let revision = outcome?.revision {
            draft.baseRevision = revision
        }
        savedDraft = draft
        clearMatchingServerEcho()
    }

    private func clearMatchingServerEcho() {
        if case .updated(let incoming)? = pendingServerChange,
           incoming == savedDraft {
            pendingServerChange = nil
        }
    }

    private func receive(_ record: LabRecord?) {
        guard let record else {
            guard draft.recordID != nil else { return }
            pendingServerChange = .deleted
            return
        }

        let incoming = LabDraft(record: record)
        guard incoming != savedDraft else { return }


        if incoming.hasSameEditorialContent(as: savedDraft) {
            // These fields are read-only in the form. Refresh them in place
            // without manufacturing a content conflict or a dirty draft.
            draft.liveStats = incoming.liveStats
            savedDraft.liveStats = incoming.liveStats
            return
        }

        if isDirty {
            pendingServerChange = .updated(incoming)
        } else {
            draft = incoming
            savedDraft = incoming
            pendingServerChange = nil
        }
    }

    private func keepDraft(over change: LabServerChange) {
        switch change {
        case .updated(let incoming):
            draft.baseRevision = incoming.baseRevision
            savedDraft = incoming
        case .deleted:
            draft.recordID = nil
            draft.baseRevision = 0
            savedDraft = LabDraft()
        }
        pendingServerChange = nil
    }

    private func reloadServerChange() {
        guard let pendingServerChange else { return }
        switch pendingServerChange {
        case .updated(let incoming):
            draft = incoming
            savedDraft = incoming
            self.pendingServerChange = nil
        case .deleted:
            dismiss()
        }
    }
}

private enum LabServerChange: Equatable {
    case updated(LabDraft)
    case deleted

    var message: String {
        switch self {
        case .updated: "This lab changed elsewhere while you were editing."
        case .deleted: "This lab was deleted elsewhere while you were editing."
        }
    }
}
