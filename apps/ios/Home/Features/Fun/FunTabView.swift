//
//  FunTabView.swift
//  Home
//
//  Photo-first CRUD for the public beer, coffee, walk and pub feed.
//

import SwiftUI
import UIKit

struct FunTabView: View {
    @Environment(HomeAppModel.self) private var model
    @State private var presentedDraft: FunEntryDraft?
    @State private var deletionTarget: FunDeleteTarget?

    var body: some View {
        NavigationStack {
            List {
                if let error = model.lastErrorMessage, !model.funEntries.isEmpty {
                    Section { ContentInlineError(message: error) }
                }

                ForEach(model.funEntries) { entry in
                    Button {
                        presentedDraft = FunEntryDraft(record: entry)
                    } label: {
                        FunEntryRow(entry: entry)
                    }
                    .buttonStyle(.plain)
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button("Delete", systemImage: "trash", role: .destructive) {
                            deletionTarget = FunDeleteTarget(
                                id: entry.id,
                                title: entry.title,
                                expectedRevision: entry.revision
                            )
                        }
                        Button("Edit", systemImage: "pencil") {
                            presentedDraft = FunEntryDraft(record: entry)
                        }
                        .tint(HorizonStyle.accent)
                    }
                }
            }
            .navigationTitle("Fun")
            .overlay {
                if model.funEntries.isEmpty {
                    if model.lastErrorMessage != nil {
                        ContentUnavailableView(
                            "Couldn’t load fun entries",
                            systemImage: "exclamationmark.triangle",
                            description: Text(model.lastErrorMessage ?? "Try again.")
                        )
                    } else {
                        ContentUnavailableView(
                            "No fun entries",
                            systemImage: "camera",
                            description: Text("Capture a beer, coffee, walk or pub to start the feed.")
                        )
                    }
                }
            }
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button("New Fun Entry", systemImage: "plus") {
                        presentedDraft = FunEntryDraft()
                    }
                    .disabled(model.isBusy)
                }
            }
            .sheet(item: $presentedDraft) { draft in
                FunEntryEditor(draft: draft)
            }
            .confirmationDialog(
                "Delete fun entry?",
                isPresented: Binding(
                    get: { deletionTarget != nil },
                    set: { if !$0 { deletionTarget = nil } }
                ),
                titleVisibility: .visible
            ) {
                if let target = deletionTarget {
                    Button("Delete \(target.title)", role: .destructive) {
                        Task {
                            if await model.deleteFunEntry(
                                target.id,
                                expectedRevision: target.expectedRevision
                            ) {
                                deletionTarget = nil
                            }
                        }
                    }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This removes the entry from the public feed. The uploaded image is retained for manual CDN cleanup.")
            }
            .refreshable { await model.refreshSubscriptions() }
        }
    }
}

private struct FunDeleteTarget: Identifiable {
    let id: String
    let title: String
    let expectedRevision: Double?
}

private struct FunEntryRow: View {
    let entry: FunEntryRecord

    var body: some View {
        HStack(spacing: HorizonStyle.stack) {
            AsyncImage(url: URL(string: entry.photo.url)) { phase in
                if case .success(let image) = phase {
                    image.resizable().scaledToFill()
                } else {
                    Image(systemName: entry.type.symbol)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(.quaternary)
                }
            }
            .frame(width: 68, height: 68)
            .clipShape(.rect(cornerRadius: 10))
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: HorizonStyle.snug) {
                HStack {
                    Label(entry.type.label, systemImage: entry.type.symbol)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text(Self.date(entry.occurredAt))
                        .font(HorizonStyle.monoCaption)
                        .foregroundStyle(.secondary)
                }

                Text(entry.title)
                    .font(.headline)
                    .lineLimit(2)

                if entry.type == .walk, let steps = entry.steps, let km = entry.km {
                    Text("\(steps.formatted()) steps · \(km.formatted(.number.precision(.fractionLength(1)))) km")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .horizonNumerals()
                } else if let rating = entry.rating {
                    Text("\(rating.formatted(.number.precision(.fractionLength(0...1)))) / 5")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, HorizonStyle.snug)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens the fun entry editor")
    }

    private static func date(_ value: String) -> String {
        BackendDate.abbreviatedDate(value)
    }
}

private struct FunEntryEditor: View {
    @Environment(HomeAppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var draft: FunEntryDraft
    @State private var savedDraft: FunEntryDraft
    @State private var isWorking = false
    @State private var activePickerUploads = 0
    @State private var confirmsDeletion = false
    @State private var confirmsDiscard = false
    @State private var confirmsServerReload = false
    @State private var operationError: String?
    @State private var showsCamera = false
    @State private var isUploadingCameraPhoto = false
    @State private var pendingServerChange: FunServerChange?

    init(draft: FunEntryDraft) {
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

                Section("Entry") {
                    Picker("Kind", selection: $draft.type) {
                        ForEach(FunKind.allCases) { kind in
                            Label(kind.label, systemImage: kind.symbol).tag(kind)
                        }
                    }
                    .pickerStyle(.segmented)

                    TextField("Title", text: $draft.title)
                    DatePicker(
                        "When it happened",
                        selection: $draft.occurredAt,
                        displayedComponents: [.date, .hourAndMinute]
                    )
                }

                Section("Photo") {
                    Button("Take Photo", systemImage: "camera") {
                        showsCamera = true
                    }
                    .disabled(
                        !UIImagePickerController.isSourceTypeAvailable(.camera)
                            || operationInFlight
                            || model.isBusy
                    )

                    if !UIImagePickerController.isSourceTypeAvailable(.camera) {
                        Text("Camera capture is available on a physical iPhone. Choose Image remains available below.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    if isUploadingCameraPhoto {
                        ProgressView("Uploading camera photo…")
                    }

                    MediaAssetEditor(
                        title: "Fun entry photo",
                        asset: $draft.photo,
                        showsSanitisation: false,
                        onUploadActivity: updatePickerUploadActivity
                    )
                }

                if draft.type == .walk {
                    Section("Walk") {
                        OptionalNumberField(
                            "Steps",
                            value: $draft.steps,
                            wholeNumber: true,
                            range: 0...250_000
                        )
                        OptionalNumberField(
                            "Kilometres",
                            value: $draft.km,
                            range: 0...1_000
                        )
                        TextField("Note (optional)", text: $draft.note, axis: .vertical)
                    }
                } else {
                    Section("Details") {
                        TextField("Note", text: $draft.note, axis: .vertical)
                            .lineLimit(2...8)
                        OptionalNumberField(
                            "Rating out of 5",
                            value: $draft.rating,
                            wholeNumber: true,
                            range: 1...5
                        )
                    }
                }

                Section("Location") {
                    TextField("Venue or route", text: $draft.location.name)
                    TextField("Suburb", text: $draft.location.suburb.contentOrEmpty)
                    OptionalNumberField(
                        "Latitude",
                        value: $draft.location.latitude,
                        range: -90...90
                    )
                    OptionalNumberField(
                        "Longitude",
                        value: $draft.location.longitude,
                        range: -180...180
                    )
                }

                if let recordID = draft.recordID {
                    Section {
                        Button("Delete Entry", systemImage: "trash", role: .destructive) {
                            confirmsDeletion = true
                        }
                        .disabled(operationInFlight || model.isBusy || pendingServerChange != nil)
                        .accessibilityHint("Permanently removes this entry from the public feed")

                        Text("Record \(recordID)")
                            .font(HorizonStyle.monoCaption)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    }
                }

                if !canSave {
                    Section {
                        Text(validationMessage)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .disabled(operationInFlight)
            .navigationTitle(draft.recordID == nil ? "New Fun Entry" : "Edit Fun Entry")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { cancel() }
                        .disabled(operationInFlight)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .disabled(
                            !canSave
                                || operationInFlight
                                || model.isBusy
                                || pendingServerChange != nil
                        )
                }
            }
            .interactiveDismissDisabled(isDirty || operationInFlight)
            .fullScreenCover(isPresented: $showsCamera) {
                CameraCaptureView { image in
                    showsCamera = false
                    guard let image else { return }
                    Task { await uploadCameraImage(image) }
                }
                .ignoresSafeArea()
            }
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
                "Discard changes?",
                isPresented: $confirmsDiscard,
                titleVisibility: .visible
            ) {
                Button("Discard changes", role: .destructive) { dismiss() }
                Button("Keep editing", role: .cancel) {}
            } message: {
                Text("Unsaved fun-entry changes will be lost.")
            }
            .confirmationDialog(
                "Delete entry?",
                isPresented: $confirmsDeletion,
                titleVisibility: .visible
            ) {
                Button("Delete Entry", role: .destructive) { Task { await delete() } }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This cannot be undone.")
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

    private var currentRecord: FunEntryRecord? {
        guard let recordID = draft.recordID else { return nil }
        return model.funEntries.first(where: { $0.id == recordID })
    }

    private var canSave: Bool {
        guard !draft.title.contentIsBlank, draft.photo.contentIsValid else { return false }
        if draft.type != .walk,
           let rating = draft.rating,
           !Self.validNumber(rating, range: 1...5, wholeNumber: true) {
            return false
        }
        guard locationIsValid else { return false }
        if draft.type == .walk {
            guard let steps = draft.steps, let km = draft.km else { return false }
            return Self.validNumber(steps, range: 0...250_000, wholeNumber: true)
                && Self.validNumber(km, range: 0...1_000)
        }
        return !draft.note.contentIsBlank
    }

    private var locationIsValid: Bool {
        let hasDetails = !(draft.location.suburb ?? "").contentIsBlank
            || draft.location.latitude != nil
            || draft.location.longitude != nil
        if draft.location.name.contentIsBlank {
            return !hasDetails
        }
        if let latitude = draft.location.latitude,
           !Self.validNumber(latitude, range: -90...90) {
            return false
        }
        if let longitude = draft.location.longitude,
           !Self.validNumber(longitude, range: -180...180) {
            return false
        }
        return true
    }

    private static func validNumber(
        _ value: Double,
        range: ClosedRange<Double>,
        wholeNumber: Bool = false
    ) -> Bool {
        value.isFinite
            && range.contains(value)
            && (!wholeNumber || value.rounded() == value)
    }

    private var isDirty: Bool { draft != savedDraft }

    private var operationInFlight: Bool {
        isWorking || isUploadingCameraPhoto || activePickerUploads > 0
    }

    private var validationMessage: String {
        if draft.type == .walk {
            "Add a title, photo URL, alternative text, steps and kilometres."
        } else {
            "Add a title, photo URL, alternative text and note. Ratings must be between 1 and 5."
        }
    }

    private func save() async {
        isWorking = true
        defer { isWorking = false }
        let result = await model.saveFunEntry(draft)
        if result.succeeded {
            if let revision = result.outcome?.revision {
                draft.baseRevision = revision
            }
            savedDraft = draft
            dismiss()
        } else {
            operationError = result.errorMessage ?? "The fun entry could not be saved."
        }
    }

    private func delete() async {
        guard let id = draft.recordID else { return }
        isWorking = true
        defer { isWorking = false }
        if await model.deleteFunEntry(id, expectedRevision: draft.baseRevision) {
            dismiss()
        } else {
            operationError = model.lastErrorMessage ?? "The fun entry could not be deleted."
        }
    }

    private func uploadCameraImage(_ image: UIImage) async {
        isUploadingCameraPhoto = true
        defer { isUploadingCameraPhoto = false }
        let data: Data
        do {
            data = try await NativeUploadService.preparedJPEG(from: image)
        } catch {
            operationError = error.localizedDescription
            return
        }
        let alt = draft.photo.alt.contentIsBlank
            ? (draft.title.contentIsBlank ? "Fun entry photo" : draft.title)
            : draft.photo.alt

        guard var uploaded = await model.uploadImage(
            data: data,
            fileName: "fun-\(UUID().uuidString).jpg",
            contentType: "image/jpeg",
            alt: alt
        ) else {
            operationError = model.lastErrorMessage ?? "The camera photo could not be uploaded."
            return
        }

        uploaded.caption = draft.photo.caption
        draft.photo = uploaded
    }

    private func cancel() {
        if isDirty {
            confirmsDiscard = true
        } else {
            dismiss()
        }
    }

    private func updatePickerUploadActivity(_ started: Bool) {
        activePickerUploads = max(0, activePickerUploads + (started ? 1 : -1))
    }

    private func receive(_ record: FunEntryRecord?) {
        guard let record else {
            guard draft.recordID != nil else { return }
            pendingServerChange = .deleted
            return
        }

        let incoming = FunEntryDraft(record: record)
        guard incoming != savedDraft else { return }
        if isDirty {
            pendingServerChange = .updated(incoming)
        } else {
            draft = incoming
            savedDraft = incoming
            pendingServerChange = nil
        }
    }

    private func keepDraft(over change: FunServerChange) {
        switch change {
        case .updated(let incoming):
            draft.baseRevision = incoming.baseRevision
            savedDraft = incoming
        case .deleted:
            draft.recordID = nil
            draft.baseRevision = 0
            savedDraft = FunEntryDraft()
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

private enum FunServerChange: Equatable {
    case updated(FunEntryDraft)
    case deleted

    var message: String {
        switch self {
        case .updated: "This fun entry changed elsewhere while you were editing."
        case .deleted: "This fun entry was deleted elsewhere while you were editing."
        }
    }
}

private struct CameraCaptureView: UIViewControllerRepresentable {
    let completion: (UIImage?) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(completion: completion)
    }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let controller = UIImagePickerController()
        controller.sourceType = .camera
        controller.cameraCaptureMode = .photo
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let completion: (UIImage?) -> Void

        init(completion: @escaping (UIImage?) -> Void) {
            self.completion = completion
        }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            completion(info[.originalImage] as? UIImage)
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            completion(nil)
        }
    }
}

#Preview {
    FunTabView()
        .environment(HomeAppModel.preview)
}
