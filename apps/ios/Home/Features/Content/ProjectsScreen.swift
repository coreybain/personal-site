//
//  ProjectsScreen.swift
//  Home
//

import SwiftUI

struct ProjectsScreen: View {
    @Environment(HomeAppModel.self) private var model
    @State private var presentedDraft: ProjectDraft?
    @State private var deletionTarget: ContentDeleteTarget?
    @State private var publicationTarget: ContentPublicationTarget?
    @State private var operationError: String?
    @State private var hasLoaded = false

    var body: some View {
        List {
            if let error = model.lastErrorMessage, !model.projects.isEmpty {
                Section {
                    ContentInlineError(message: error)
                }
            }

            ForEach(model.projects) { project in
                HStack(spacing: HorizonStyle.snug) {
                    Button {
                        presentedDraft = ProjectDraft(record: project)
                    } label: {
                        ProjectRow(project: project)
                    }
                    .buttonStyle(.plain)

                    Menu("Project actions", systemImage: "ellipsis") {
                        Button("Edit", systemImage: "pencil") {
                            presentedDraft = ProjectDraft(record: project)
                        }

                        if project.published {
                            Button("Unpublish", systemImage: "eye.slash") {
                                requestPublicationChange(for: project, publish: false)
                            }
                        } else {
                            Button("Publish", systemImage: "paperplane") {
                                requestPublicationChange(for: project, publish: true)
                            }
                        }

                        Button("Delete", systemImage: "trash", role: .destructive) {
                            deletionTarget = ContentDeleteTarget(
                                id: project.id,
                                title: project.title,
                                expectedRevision: project.revision
                            )
                        }
                    }
                    .labelStyle(.iconOnly)
                    .disabled(model.isBusy)
                }
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    Button("Delete", systemImage: "trash", role: .destructive) {
                        deletionTarget = ContentDeleteTarget(
                            id: project.id,
                            title: project.title,
                            expectedRevision: project.revision
                        )
                    }

                    Button(
                        project.published ? "Unpublish" : "Publish",
                        systemImage: project.published ? "eye.slash" : "paperplane"
                    ) {
                        requestPublicationChange(for: project, publish: !project.published)
                    }
                    .tint(HorizonStyle.accent)
                }
            }
        }
        .navigationTitle("Projects")
        .overlay {
            if let overlayState {
                ContentCollectionOverlay(state: overlayState, retry: refresh)
            }
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("New Project", systemImage: "plus") {
                    presentedDraft = newDraft()
                }
                .disabled(model.isBusy)
            }
        }
        .sheet(item: $presentedDraft) { draft in
            ProjectEditorView(draft: draft)
        }
        .confirmationDialog(
            "Change project publication?",
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
                    ? "This makes the project visible on the public site."
                    : "This removes the project from the public site without deleting its draft."
            )
        }
        .confirmationDialog(
            "Delete project?",
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
            Text("This removes the project record. Uploaded media may need separate CDN cleanup.")
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

    private func newDraft() -> ProjectDraft {
        var draft = ProjectDraft()
        let maximum = model.projects.lazy.map(\.sortOrder).filter(\.isFinite).max() ?? -1
        draft.sortOrder = min(maximum + 1, 1_000_000_000)
        return draft
    }

    private var overlayState: ContentCollectionOverlay.State? {
        if !hasLoaded && model.projects.isEmpty {
            return .loading
        }
        if model.projects.isEmpty, let error = model.lastErrorMessage {
            return .failure(title: "Couldn’t load projects", message: error)
        }
        if model.projects.isEmpty {
            return .empty(
                title: "No Projects",
                systemImage: "rectangle.stack",
                description: "Create a case study to start building the work index."
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
            result = await model.publishProject(
                id: target.id,
                expectedRevision: target.expectedRevision
            )
        } else {
            result = await model.unpublishProject(
                id: target.id,
                expectedRevision: target.expectedRevision
            )
        }
        if !result.succeeded {
            operationError = result.errorMessage
                ?? "The publication state could not be changed."
        }
    }

    private func requestPublicationChange(for project: ProjectRecord, publish: Bool) {
        publicationTarget = ContentPublicationTarget(
            id: project.id,
            title: project.title,
            publish: publish,
            expectedRevision: project.revision
        )
    }

    private func delete(_ target: ContentDeleteTarget) async {
        let succeeded = await model.deleteProject(
            id: target.id,
            expectedRevision: target.expectedRevision
        )
        if succeeded {
            deletionTarget = nil
        } else {
            operationError = model.lastErrorMessage ?? "The project could not be deleted."
        }
    }
}

private struct ProjectRow: View {
    let project: ProjectRecord

    var body: some View {
        VStack(alignment: .leading, spacing: HorizonStyle.snug) {
            HStack(alignment: .firstTextBaseline) {
                Text(project.title)
                    .font(.headline)
                    .lineLimit(2)
                Spacer()
                Text(project.sortOrder, format: .number)
                    .font(HorizonStyle.monoCaption)
                    .foregroundStyle(.secondary)
                    .horizonNumerals()
            }

            Text(project.slug)
                .font(HorizonStyle.monoCaption)
                .foregroundStyle(.secondary)
                .lineLimit(1)

            ContentStatusLabel(isPublished: project.published, isFeatured: project.featured)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, HorizonStyle.snug)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens the project editor")
    }
}

struct ProjectEditorView: View {
    @Environment(HomeAppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var draft: ProjectDraft
    @State private var savedDraft: ProjectDraft
    @State private var isWorking = false
    @State private var activeUploads = 0
    @State private var operationError: String?
    @State private var confirmsDeletion = false
    @State private var confirmsDiscard = false
    @State private var confirmsServerReload = false
    @State private var pendingSlugRenameIntent: ContentSaveIntent?
    @State private var pendingServerChange: ProjectServerChange?

    init(draft: ProjectDraft) {
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
                    TextField("Client", text: $draft.client)
                    TextField("Attribution", text: $draft.attribution, axis: .vertical)
                    TextField("Role", text: $draft.role)
                    TextField("Period", text: $draft.period)
                    TextField("Summary", text: $draft.summary, axis: .vertical)
                        .lineLimit(3...8)
                }

                Section("Narrative") {
                    TextField("Problem", text: $draft.problem, axis: .vertical)
                        .lineLimit(3...12)
                    TextField("Approach", text: $draft.approach, axis: .vertical)
                        .lineLimit(3...12)
                    TextEditor(text: $draft.body)
                        .frame(minHeight: 180)
                        .accessibilityLabel("Long-form Markdown")
                }

                StableLineListEditor(
                    title: "Outcomes",
                    singularLabel: "Outcome",
                    values: $draft.outcomes
                )

                StableLineListEditor(
                    title: "Technology stack",
                    singularLabel: "Technology",
                    values: $draft.stack
                )

                MediaAssetListEditor(
                    assets: $draft.media,
                    onUploadActivity: updateUploadActivity
                )

                Section("Links") {
                    TextField("Live URL", text: $draft.links.live.contentOrEmpty)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                    TextField("Press URL", text: $draft.links.press.contentOrEmpty)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                }

                Section("Presentation") {
                    TextField("Accent colour", text: $draft.accent)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    RequiredNumberField(
                        "Accent hue",
                        value: $draft.accentHue,
                        range: 0...360
                    )
                    Toggle("Featured", isOn: $draft.featured)
                    RequiredNumberField(
                        "Sort order",
                        value: $draft.sortOrder,
                        wholeNumber: true,
                        range: 0...1_000_000_000
                    )
                }

                ProjectBuildStatsEditor(stats: $draft.aiBuildStats)

                if hasUnsanitisedMedia {
                    Section {
                        Label(
                            "Every project image must be marked as sanitised before publishing.",
                            systemImage: "exclamationmark.shield"
                        )
                        .foregroundStyle(.secondary)
                    }
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
                        .disabled(
                            !canSave
                                || operationInFlight
                                || model.isBusy
                                || (!isPublished && hasUnsanitisedMedia)
                        )

                        Button("Delete Project", systemImage: "trash", role: .destructive) {
                            confirmsDeletion = true
                        }
                        .disabled(operationInFlight || model.isBusy || pendingServerChange != nil)
                    }
                }

                if !canSave {
                    Section {
                        Text("Complete every required field. Media needs a URL and alternative text, and list rows cannot be blank.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .disabled(operationInFlight)
            .navigationTitle(draft.recordID == nil ? "New Project" : "Edit Project")
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
                "Rename project slug?",
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
                    "Changing this slug breaks existing inbound links, featured-slug "
                        + "references and the old indexed knowledge source."
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
                Text("Unsaved project changes will be lost.")
            }
            .confirmationDialog(
                "Delete project?",
                isPresented: $confirmsDeletion,
                titleVisibility: .visible
            ) {
                Button("Delete Project", role: .destructive) {
                    Task { await delete() }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This cannot be undone. Uploaded media may need separate CDN cleanup.")
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

    private var currentRecord: ProjectRecord? {
        guard let recordID = draft.recordID else { return nil }
        return model.projects.first(where: { $0.id == recordID })
    }

    private var isPublished: Bool {
        currentRecord?.published ?? false
    }

    private var isDirty: Bool { draft != savedDraft }

    private var slugChanged: Bool {
        draft.recordID != nil && draft.slug != savedDraft.slug
    }

    private var operationInFlight: Bool { isWorking || activeUploads > 0 }

    private var hasUnsanitisedMedia: Bool {
        draft.media.contains { $0.sanitised != true }
    }

    private var buildStatsWereEdited: Bool {
        draft.aiBuildStats != savedDraft.aiBuildStats
    }

    private var canSave: Bool {
        let required = [
            draft.slug, draft.title, draft.client, draft.attribution,
            draft.role, draft.summary, draft.accent,
        ]
        let statsAreValid = draft.aiBuildStats.map {
            $0.sessions.isFinite
                && $0.hours.isFinite
                && (0...100_000).contains($0.sessions)
                && (0...100_000).contains($0.hours)
        } ?? true
        return required.allSatisfy { !$0.contentIsBlank }
            && draft.outcomes.allSatisfy { !$0.contentIsBlank }
            && draft.stack.allSatisfy { !$0.contentIsBlank }
            && draft.media.allSatisfy(\.contentIsValid)
            && draft.accentHue.isFinite
            && (0...360).contains(draft.accentHue)
            && draft.sortOrder.isFinite
            && draft.sortOrder.rounded() == draft.sortOrder
            && draft.sortOrder >= 0
            && statsAreValid
    }

    private func save() async {
        isWorking = true
        defer { isWorking = false }
        let result = await model.saveProject(
            draft,
            includeBuildStats: buildStatsWereEdited
        )
        if result.succeeded {
            adoptSavedMutation(result.outcome)
            dismiss()
        } else {
            operationError = result.errorMessage ?? "The project could not be saved."
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
            let unpublishResult = await model.unpublishProject(
                id: id,
                expectedRevision: draft.baseRevision
            )
            guard unpublishResult.succeeded else {
                operationError = unpublishResult.errorMessage
                    ?? "The project could not be unpublished."
                return
            }
            adoptMutationRevision(unpublishResult.outcome)
            let saveResult = await model.saveProject(
                draft,
                includeBuildStats: buildStatsWereEdited
            )
            guard saveResult.succeeded else {
                let detail = saveResult.errorMessage
                    ?? "The edited fields could not be saved."
                operationError = "The project is already unpublished. "
                    + "Saving its edited fields failed: \(detail) "
                    + "Your edits remain in this form; try Save again."
                return
            }
            adoptSavedMutation(saveResult.outcome)
            dismiss()
            return
        }

        let saveResult = await model.saveProject(
            draft,
            includeBuildStats: buildStatsWereEdited
        )
        guard saveResult.succeeded else {
            operationError = saveResult.errorMessage ?? "The project could not be saved."
            return
        }
        adoptSavedMutation(saveResult.outcome)

        let publishResult = await model.publishProject(
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
        if await model.deleteProject(
            id: recordID,
            expectedRevision: draft.baseRevision
        ) {
            dismiss()
        } else {
            operationError = model.lastErrorMessage ?? "The project could not be deleted."
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

    /// Publication mutations do not change editable fields, but they do advance
    /// the record revision. Rebase both sides so the subscription echo is not
    /// mistaken for somebody else's edit while a chained save is still running.
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

    private func receive(_ record: ProjectRecord?) {
        guard let record else {
            guard draft.recordID != nil else { return }
            pendingServerChange = .deleted
            return
        }

        let incoming = ProjectDraft(record: record)
        guard incoming != savedDraft else { return }

        if incoming.hasSameEditorialContent(as: savedDraft) {
            let statsWereEditedLocally = draft.aiBuildStats != savedDraft.aiBuildStats
            savedDraft.aiBuildStats = incoming.aiBuildStats
            if !statsWereEditedLocally {
                draft.aiBuildStats = incoming.aiBuildStats
            }
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

    private func keepDraft(over change: ProjectServerChange) {
        switch change {
        case .updated(let incoming):
            draft.baseRevision = incoming.baseRevision
            savedDraft = incoming
        case .deleted:
            draft.recordID = nil
            draft.baseRevision = 0
            savedDraft = ProjectDraft()
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

private enum ProjectServerChange: Equatable {
    case updated(ProjectDraft)
    case deleted

    var message: String {
        switch self {
        case .updated: "This project changed elsewhere while you were editing."
        case .deleted: "This project was deleted elsewhere while you were editing."
        }
    }
}

private struct ProjectBuildStatsEditor: View {
    @Binding var stats: AiBuildStats?

    var body: some View {
        Section("AI build stats") {
            Toggle(
                "Track build stats",
                isOn: Binding(
                    get: { stats != nil },
                    set: { enabled in
                        stats = enabled ? (stats ?? AiBuildStats()) : nil
                    }
                )
            )

            if stats != nil {
                RequiredNumberField(
                    "Sessions",
                    value: sessions,
                    range: 0...100_000
                )
                RequiredNumberField(
                    "Hours",
                    value: hours,
                    range: 0...100_000
                )
            }
        }
    }

    private var sessions: Binding<Double> {
        Binding(
            get: { stats?.sessions ?? 0 },
            set: { newValue in
                var value = stats ?? AiBuildStats()
                value.sessions = newValue
                stats = value
            }
        )
    }

    private var hours: Binding<Double> {
        Binding(
            get: { stats?.hours ?? 0 },
            set: { newValue in
                var value = stats ?? AiBuildStats()
                value.hours = newValue
                stats = value
            }
        )
    }
}
