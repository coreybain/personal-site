//
//  PostsScreen.swift
//  Home
//

import SwiftUI

struct PostsScreen: View {
    @Environment(HomeAppModel.self) private var model
    @State private var presentedDraft: PostDraft?
    @State private var deletionTarget: ContentDeleteTarget?
    @State private var publicationTarget: ContentPublicationTarget?
    @State private var operationError: String?
    @State private var hasLoaded = false

    var body: some View {
        List {
            if let error = model.lastErrorMessage, !model.posts.isEmpty {
                Section {
                    ContentInlineError(message: error)
                }
            }

            ForEach(model.posts) { post in
                HStack(spacing: HorizonStyle.snug) {
                    Button {
                        presentedDraft = PostDraft(record: post)
                    } label: {
                        PostRow(post: post)
                    }
                    .buttonStyle(.plain)

                    Menu("Post actions", systemImage: "ellipsis") {
                        Button("Edit", systemImage: "pencil") {
                            presentedDraft = PostDraft(record: post)
                        }

                        if post.published {
                            Button("Unpublish", systemImage: "eye.slash") {
                                requestPublicationChange(for: post, publish: false)
                            }
                        } else {
                            Button("Publish", systemImage: "paperplane") {
                                requestPublicationChange(for: post, publish: true)
                            }
                        }

                        Button("Delete", systemImage: "trash", role: .destructive) {
                            deletionTarget = ContentDeleteTarget(
                                id: post.id,
                                title: post.title,
                                expectedRevision: post.revision
                            )
                        }
                    }
                    .labelStyle(.iconOnly)
                    .disabled(model.isBusy)
                }
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    Button("Delete", systemImage: "trash", role: .destructive) {
                        deletionTarget = ContentDeleteTarget(
                            id: post.id,
                            title: post.title,
                            expectedRevision: post.revision
                        )
                    }

                    Button(
                        post.published ? "Unpublish" : "Publish",
                        systemImage: post.published ? "eye.slash" : "paperplane"
                    ) {
                        requestPublicationChange(for: post, publish: !post.published)
                    }
                    .tint(HorizonStyle.accent)
                }
            }
        }
        .navigationTitle("Posts")
        .overlay {
            if let overlayState {
                ContentCollectionOverlay(state: overlayState, retry: refresh)
            }
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("New Post", systemImage: "plus") {
                    presentedDraft = PostDraft()
                }
                .disabled(model.isBusy)
            }
        }
        .sheet(item: $presentedDraft) { draft in
            PostEditorView(draft: draft)
        }
        .confirmationDialog(
            "Change post publication?",
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
                    ? "This makes the post visible on the public site."
                    : "This removes the post from the public site without deleting its draft."
            )
        }
        .confirmationDialog(
            "Delete post?",
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
            Text("This removes the post and its search index entry. The cover upload may need separate CDN cleanup.")
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

    private var overlayState: ContentCollectionOverlay.State? {
        if !hasLoaded && model.posts.isEmpty {
            return .loading
        }
        if model.posts.isEmpty, let error = model.lastErrorMessage {
            return .failure(title: "Couldn’t load posts", message: error)
        }
        if model.posts.isEmpty {
            return .empty(
                title: "No Posts",
                systemImage: "doc.richtext",
                description: "Create a draft to start the writing archive."
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
            result = await model.publishPost(
                id: target.id,
                expectedRevision: target.expectedRevision
            )
        } else {
            result = await model.unpublishPost(
                id: target.id,
                expectedRevision: target.expectedRevision
            )
        }
        if !result.succeeded {
            operationError = result.errorMessage
                ?? "The publication state could not be changed."
        }
    }

    private func requestPublicationChange(for post: PostRecord, publish: Bool) {
        publicationTarget = ContentPublicationTarget(
            id: post.id,
            title: post.title,
            publish: publish,
            expectedRevision: post.revision
        )
    }

    private func delete(_ target: ContentDeleteTarget) async {
        let succeeded = await model.deletePost(
            id: target.id,
            expectedRevision: target.expectedRevision
        )
        if succeeded {
            deletionTarget = nil
        } else {
            operationError = model.lastErrorMessage ?? "The post could not be deleted."
        }
    }
}

private struct PostRow: View {
    let post: PostRecord

    var body: some View {
        VStack(alignment: .leading, spacing: HorizonStyle.snug) {
            Text(post.title)
                .font(.headline)
                .lineLimit(2)

            Text(post.slug)
                .font(HorizonStyle.monoCaption)
                .foregroundStyle(.secondary)
                .lineLimit(1)

            HStack {
                ContentStatusLabel(isPublished: post.published, isFeatured: false)
                Spacer()
                if let publishedAt = post.publishedAt {
                    Text(BackendDate.abbreviatedDateTime(publishedAt))
                        .font(HorizonStyle.monoCaption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, HorizonStyle.snug)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens the post editor")
    }
}

struct PostEditorView: View {
    @Environment(HomeAppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var draft: PostDraft
    @State private var savedDraft: PostDraft
    @State private var isWorking = false
    @State private var activeUploads = 0
    @State private var operationError: String?
    @State private var confirmsDeletion = false
    @State private var confirmsDiscard = false
    @State private var confirmsServerReload = false
    @State private var pendingSlugRenameIntent: ContentSaveIntent?
    @State private var pendingServerChange: PostServerChange?

    init(draft: PostDraft) {
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
                    TextField("Excerpt", text: $draft.excerpt, axis: .vertical)
                        .lineLimit(3...10)
                }

                Section {
                    TextEditor(text: $draft.body)
                        .frame(minHeight: 320)
                        .font(.body.monospaced())
                        .accessibilityLabel("Post Markdown")
                } header: {
                    Text("Body")
                } footer: {
                    Text("Markdown is rendered by the website after saving.")
                }

                Section("Cover") {
                    MediaAssetEditor(
                        title: "Post cover",
                        asset: $draft.coverImage,
                        showsSanitisation: false,
                        onUploadActivity: updateUploadActivity
                    )
                }

                StableLineListEditor(
                    title: "Tags",
                    singularLabel: "Tag",
                    values: $draft.tags
                )

                if draft.recordID != nil {
                    Section("Publication") {
                        ContentStatusLabel(isPublished: isPublished, isFeatured: false)

                        if let publishedAt {
                            LabeledContent("First published") {
                                Text(BackendDate.abbreviatedDateTime(publishedAt))
                                    .font(HorizonStyle.monoCaption)
                            }
                        }

                        Button(
                            isPublished ? "Save & Unpublish" : "Save & Publish",
                            systemImage: isPublished ? "eye.slash" : "paperplane"
                        ) {
                            request(.publication(!isPublished))
                        }
                        .disabled(!canSave || operationInFlight || model.isBusy)

                        Button("Delete Post", systemImage: "trash", role: .destructive) {
                            confirmsDeletion = true
                        }
                        .disabled(operationInFlight || model.isBusy || pendingServerChange != nil)
                    }
                }

                if !canSave {
                    Section {
                        Text("Complete the title, slug, excerpt and body. The cover needs a URL and alternative text, and tags cannot be blank.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .disabled(operationInFlight)
            .navigationTitle(draft.recordID == nil ? "New Post" : "Edit Post")
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
                "Rename post slug?",
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
                Text("Unsaved post changes will be lost.")
            }
            .confirmationDialog(
                "Delete post?",
                isPresented: $confirmsDeletion,
                titleVisibility: .visible
            ) {
                Button("Delete Post", role: .destructive) {
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

    private var currentRecord: PostRecord? {
        guard let recordID = draft.recordID else { return nil }
        return model.posts.first(where: { $0.id == recordID })
    }

    private var isDirty: Bool { draft != savedDraft }

    private var slugChanged: Bool {
        draft.recordID != nil && draft.slug != savedDraft.slug
    }

    private var operationInFlight: Bool { isWorking || activeUploads > 0 }

    private var isPublished: Bool {
        currentRecord?.published ?? false
    }

    private var publishedAt: String? {
        currentRecord?.publishedAt
    }

    private var canSave: Bool {
        let required = [draft.slug, draft.title, draft.excerpt, draft.body]
        return required.allSatisfy { !$0.contentIsBlank }
            && draft.coverImage.contentIsValid
            && draft.tags.allSatisfy { !$0.contentIsBlank }
    }

    private func save() async {
        isWorking = true
        defer { isWorking = false }
        let result = await model.savePost(draft)
        if result.succeeded {
            adoptSavedMutation(result.outcome)
            dismiss()
        } else {
            operationError = result.errorMessage ?? "The post could not be saved."
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
            let unpublishResult = await model.unpublishPost(
                id: id,
                expectedRevision: draft.baseRevision
            )
            guard unpublishResult.succeeded else {
                operationError = unpublishResult.errorMessage
                    ?? "The post could not be unpublished."
                return
            }
            adoptMutationRevision(unpublishResult.outcome)
            let saveResult = await model.savePost(draft)
            guard saveResult.succeeded else {
                let detail = saveResult.errorMessage
                    ?? "The edited fields could not be saved."
                operationError = "The post is already unpublished. "
                    + "Saving its edited fields failed: \(detail) "
                    + "Your edits remain in this form; try Save again."
                return
            }
            adoptSavedMutation(saveResult.outcome)
            dismiss()
            return
        }

        let saveResult = await model.savePost(draft)
        guard saveResult.succeeded else {
            operationError = saveResult.errorMessage ?? "The post could not be saved."
            return
        }
        adoptSavedMutation(saveResult.outcome)

        let publishResult = await model.publishPost(
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
        if await model.deletePost(
            id: recordID,
            expectedRevision: draft.baseRevision
        ) {
            dismiss()
        } else {
            operationError = model.lastErrorMessage ?? "The post could not be deleted."
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

    private func receive(_ record: PostRecord?) {
        guard let record else {
            guard draft.recordID != nil else { return }
            pendingServerChange = .deleted
            return
        }

        let incoming = PostDraft(record: record)
        guard incoming != savedDraft else { return }
        if isDirty {
            pendingServerChange = .updated(incoming)
        } else {
            draft = incoming
            savedDraft = incoming
            pendingServerChange = nil
        }
    }

    private func keepDraft(over change: PostServerChange) {
        switch change {
        case .updated(let incoming):
            draft.baseRevision = incoming.baseRevision
            savedDraft = incoming
        case .deleted:
            draft.recordID = nil
            draft.baseRevision = 0
            savedDraft = PostDraft()
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

private enum PostServerChange: Equatable {
    case updated(PostDraft)
    case deleted

    var message: String {
        switch self {
        case .updated: "This post changed elsewhere while you were editing."
        case .deleted: "This post was deleted elsewhere while you were editing."
        }
    }
}
