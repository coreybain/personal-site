//
//  ContentEditorComponents.swift
//  Home
//
//  Small editing controls shared by Projects, Labs and Posts. These stay in
//  the Content feature because they encode the content contract (MediaAsset,
//  ordered string fields), not an app-wide design system.
//

import PhotosUI
import SwiftUI

// MARK: - Collection state

struct ContentCollectionOverlay: View {
    enum State {
        case loading
        case empty(title: String, systemImage: String, description: String)
        case failure(title: String, message: String)
    }

    let state: State
    let retry: () async -> Void

    var body: some View {
        switch state {
        case .loading:
            ProgressView("Loading…")

        case .empty(let title, let systemImage, let description):
            ContentUnavailableView(
                title,
                systemImage: systemImage,
                description: Text(description)
            )

        case .failure(let title, let message):
            ContentUnavailableView {
                Label(title, systemImage: "exclamationmark.triangle")
            } description: {
                Text(message)
            } actions: {
                Button("Try Again") {
                    Task { await retry() }
                }
            }
        }
    }
}

struct ContentDeleteTarget: Identifiable {
    let id: String
    let title: String
    let expectedRevision: Double?
}

struct ContentPublicationTarget: Identifiable {
    let id: String
    let title: String
    let publish: Bool
    let expectedRevision: Double?
}

struct ContentStatusLabel: View {
    let isPublished: Bool
    let isFeatured: Bool

    var body: some View {
        HStack(spacing: HorizonStyle.snug) {
            Label(
                isPublished ? "Published" : "Draft",
                systemImage: isPublished ? "checkmark.circle.fill" : "circle.dashed"
            )

            if isFeatured {
                Label("Featured", systemImage: "star.fill")
            }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .accessibilityElement(children: .combine)
    }
}

struct ContentInlineError: View {
    let message: String

    var body: some View {
        Label(message, systemImage: "exclamationmark.triangle")
            .font(.footnote)
            .foregroundStyle(.secondary)
            .accessibilityElement(children: .combine)
    }
}

enum ContentSaveIntent {
    case save
    case publication(Bool)
}

struct ContentExternalChangeNotice: View {
    let message: String
    let reload: () -> Void
    let keepDraft: () -> Void

    var body: some View {
        Section {
            Label(
                message,
                systemImage: "arrow.trianglehead.2.clockwise.rotate.90"
            )
            .font(.footnote)
            .foregroundStyle(.secondary)

            Button("Reload latest", systemImage: "arrow.clockwise", action: reload)
            Button("Keep my draft", systemImage: "pencil", action: keepDraft)
        } header: {
            Text("Newer server state")
        } footer: {
            Text("Saving is paused until you choose which version to keep.")
        }
    }
}

// MARK: - Optional values

extension Binding where Value == String? {
    var contentOrEmpty: Binding<String> {
        Binding<String>(
            get: { wrappedValue ?? "" },
            set: { wrappedValue = $0.isEmpty ? nil : $0 }
        )
    }
}

struct OptionalNumberField: View {
    let title: String
    @Binding var value: Double?
    let wholeNumber: Bool
    let range: ClosedRange<Double>?
    @State private var text: String

    init(
        _ title: String,
        value: Binding<Double?>,
        wholeNumber: Bool = false,
        range: ClosedRange<Double>? = nil
    ) {
        self.title = title
        self.wholeNumber = wholeNumber
        self.range = range
        _value = value
        _text = State(initialValue: value.wrappedValue.map { String($0) } ?? "")
    }

    var body: some View {
        TextField(title, text: $text)
            .keyboardType(.numbersAndPunctuation)
            .onChange(of: text) {
                let cleaned = text.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !cleaned.isEmpty else {
                    value = nil
                    return
                }
                guard let parsed = Double(cleaned), isValid(parsed) else {
                    // NaN is an internal invalid sentinel. Every parent save
                    // predicate rejects non-finite numbers, so visible malformed
                    // text can never silently save the previous/empty value.
                    value = .nan
                    return
                }
                value = parsed
            }
            .onChange(of: value) { _, newValue in
                // Invalid visible input deliberately stores NaN as a sentinel;
                // do not rewrite the user's text in that branch. Real external
                // changes (for example dimensions returned by an upload) must
                // update this field's private editing buffer.
                guard newValue?.isNaN != true else { return }
                let updated = newValue.map(displayText) ?? ""
                if text != updated {
                    text = updated
                }
            }
            .foregroundStyle(isCurrentTextValid ? Color.primary : Color.red)
            .overlay(alignment: .trailing) {
                if !isCurrentTextValid {
                    Image(systemName: "exclamationmark.circle.fill")
                        .foregroundStyle(.red)
                        .accessibilityHidden(true)
                }
            }
            .padding(.trailing, isCurrentTextValid ? 0 : 24)
            .accessibilityValue(
                isCurrentTextValid ? text : "\(text), invalid number"
            )
            .accessibilityHint(isCurrentTextValid ? "" : "Enter a valid number")
    }

    private var isCurrentTextValid: Bool {
        let cleaned = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty else { return true }
        guard let parsed = Double(cleaned) else { return false }
        return isValid(parsed)
    }

    private func isValid(_ number: Double) -> Bool {
        number.isFinite
            && (!wholeNumber || number.rounded() == number)
            && (range?.contains(number) ?? true)
    }

    private func displayText(_ number: Double) -> String {
        if wholeNumber, number.rounded() == number {
            return String(Int(number))
        }
        return String(number)
    }
}

struct RequiredNumberField: View {
    let title: String
    @Binding var value: Double
    let wholeNumber: Bool
    let range: ClosedRange<Double>?
    @State private var text: String

    init(
        _ title: String,
        value: Binding<Double>,
        wholeNumber: Bool = false,
        range: ClosedRange<Double>? = nil
    ) {
        self.title = title
        self.wholeNumber = wholeNumber
        self.range = range
        _value = value
        _text = State(initialValue: String(value.wrappedValue))
    }

    var body: some View {
        TextField(title, text: $text)
            .keyboardType(.numbersAndPunctuation)
            .onChange(of: text) {
                let cleaned = text.trimmingCharacters(in: .whitespacesAndNewlines)
                guard let parsed = Double(cleaned), isValid(parsed) else {
                    value = .nan
                    return
                }
                value = parsed
            }
            .onChange(of: value) { _, newValue in
                guard !newValue.isNaN else { return }
                let updated = displayText(newValue)
                if text != updated {
                    text = updated
                }
            }
            .foregroundStyle(isCurrentTextValid ? Color.primary : Color.red)
            .overlay(alignment: .trailing) {
                if !isCurrentTextValid {
                    Image(systemName: "exclamationmark.circle.fill")
                        .foregroundStyle(.red)
                        .accessibilityHidden(true)
                }
            }
            .padding(.trailing, isCurrentTextValid ? 0 : 24)
            .accessibilityValue(
                isCurrentTextValid ? text : "\(text), invalid number"
            )
            .accessibilityHint(isCurrentTextValid ? "" : "Enter a valid number")
    }

    private var isCurrentTextValid: Bool {
        guard let parsed = Double(text.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            return false
        }
        return isValid(parsed)
    }

    private func isValid(_ number: Double) -> Bool {
        number.isFinite
            && (!wholeNumber || number.rounded() == number)
            && (range?.contains(number) ?? true)
    }

    private func displayText(_ number: Double) -> String {
        if wholeNumber, number.rounded() == number {
            return String(Int(number))
        }
        return String(number)
    }
}

struct OptionalBooleanPicker: View {
    let title: String
    @Binding var value: Bool?

    var body: some View {
        Picker(title, selection: $value) {
            Text("Not set").tag(Bool?.none)
            Text("Yes").tag(Bool?.some(true))
            Text("No").tag(Bool?.some(false))
        }
    }
}

// MARK: - Stable ordered string fields

struct EditableLine: Identifiable, Equatable {
    let id: UUID
    var text: String

    init(id: UUID = UUID(), text: String = "") {
        self.id = id
        self.text = text
    }

    /// Applies an external value replacement without discarding editor row
    /// identity. Exact matches survive moves and insertions; changed rows keep
    /// their positional identity where possible.
    static func reconciling(_ existing: [EditableLine], with values: [String]) -> [EditableLine] {
        var result = Array<EditableLine?>(repeating: nil, count: values.count)
        var usedIDs = Set<UUID>()

        // Preserve rows that did not move or change first. This also gives
        // duplicate values deterministic identity.
        for index in values.indices where existing.indices.contains(index) {
            let row = existing[index]
            guard row.text == values[index] else { continue }
            result[index] = row
            usedIDs.insert(row.id)
        }

        // Then preserve identity for exact values that moved.
        for index in values.indices where result[index] == nil {
            guard let row = existing.first(where: {
                !usedIDs.contains($0.id) && $0.text == values[index]
            }) else { continue }
            result[index] = row
            usedIDs.insert(row.id)
        }

        // A true text edit should retain its positional row identity when that
        // identity was not already claimed by a move. New inserted rows get a
        // fresh identity.
        for index in values.indices where result[index] == nil {
            if existing.indices.contains(index), !usedIDs.contains(existing[index].id) {
                let row = EditableLine(id: existing[index].id, text: values[index])
                result[index] = row
                usedIDs.insert(row.id)
            } else {
                result[index] = EditableLine(text: values[index])
            }
        }

        return result.compactMap { $0 }
    }
}

struct StableLineListEditor: View {
    let title: String
    let singularLabel: String
    @Binding private var values: [String]
    @State private var rows: [EditableLine]

    init(title: String, singularLabel: String, values: Binding<[String]>) {
        self.title = title
        self.singularLabel = singularLabel
        _values = values
        _rows = State(initialValue: values.wrappedValue.map { EditableLine(text: $0) })
    }

    var body: some View {
        Section {
            ForEach($rows) { $row in
                HStack(alignment: .firstTextBaseline, spacing: HorizonStyle.snug) {
                    TextField(singularLabel, text: $row.text, axis: .vertical)

                    Button("Move Up", systemImage: "chevron.up") {
                        move(rowID: row.id, offset: -1)
                    }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.borderless)
                    .frame(minWidth: 44, minHeight: 44)
                    .disabled(rows.first?.id == row.id)

                    Button("Move Down", systemImage: "chevron.down") {
                        move(rowID: row.id, offset: 1)
                    }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.borderless)
                    .frame(minWidth: 44, minHeight: 44)
                    .disabled(rows.last?.id == row.id)

                    Button("Remove \(singularLabel)", systemImage: "minus.circle", role: .destructive) {
                        rows.removeAll { $0.id == row.id }
                    }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.borderless)
                    .frame(minWidth: 44, minHeight: 44)
                }
            }

            Button("Add \(singularLabel)", systemImage: "plus") {
                rows.append(EditableLine())
            }
        } header: {
            Text(title)
        }
        .onChange(of: rows) { _, newRows in
            let updatedValues = newRows.map(\.text)
            if values != updatedValues {
                values = updatedValues
            }
        }
        .onChange(of: values) { _, newValues in
            guard rows.map(\.text) != newValues else { return }
            rows = EditableLine.reconciling(rows, with: newValues)
        }
    }

    private func move(rowID: UUID, offset: Int) {
        guard let source = rows.firstIndex(where: { $0.id == rowID }) else { return }
        let destination = source + offset
        guard rows.indices.contains(destination) else { return }
        rows.swapAt(source, destination)
    }
}

// MARK: - Media

struct MediaAssetEditor: View {
    @Environment(HomeAppModel.self) private var model
    let title: String
    @Binding var asset: MediaAsset
    var showsSanitisation = true
    var onUploadActivity: (Bool) -> Void = { _ in }
    @State private var selectedPhoto: PhotosPickerItem?
    @State private var isUploading = false
    @State private var uploadError: String?

    var body: some View {
        VStack(alignment: .leading, spacing: HorizonStyle.stack) {
            if asset.kind == .image,
               !asset.url.isEmpty,
               let url = URL(string: asset.url) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .empty:
                        ProgressView()
                            .frame(maxWidth: .infinity, minHeight: 120)
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFit()
                            .frame(maxHeight: 220)
                            .frame(maxWidth: .infinity)
                            .clipShape(.rect(cornerRadius: 8))
                            .accessibilityLabel(asset.alt.isEmpty ? title : asset.alt)
                    case .failure:
                        Label("Preview unavailable", systemImage: "photo.badge.exclamationmark")
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, minHeight: 80)
                    @unknown default:
                        EmptyView()
                    }
                }
            }

            Picker("Kind", selection: $asset.kind) {
                Text("Image").tag(MediaKind.image)
                Text("Video").tag(MediaKind.video)
            }
            .pickerStyle(.segmented)

            PhotosPicker("Choose Image", selection: $selectedPhoto, matching: .images)
            .disabled(isUploading || model.isBusy)

            if isUploading {
                ProgressView("Uploading image…")
            }

            if let uploadError {
                ContentInlineError(message: uploadError)
            }

            TextField("URL", text: $asset.url)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)

            TextField("Alternative text", text: $asset.alt, axis: .vertical)
            TextField("Caption", text: $asset.caption.contentOrEmpty, axis: .vertical)
            TextField("Storage key", text: $asset.storageKey.contentOrEmpty)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()

            HStack {
                OptionalNumberField(
                    "Width",
                    value: $asset.width,
                    wholeNumber: true,
                    range: 1...20_000
                )
                OptionalNumberField(
                    "Height",
                    value: $asset.height,
                    wholeNumber: true,
                    range: 1...20_000
                )
            }

            if showsSanitisation {
                OptionalBooleanPicker(title: "Sanitised", value: $asset.sanitised)
            }
        }
        .onChange(of: selectedPhoto) { _, item in
            guard let item else { return }
            Task { await upload(item) }
        }
    }

    private func upload(_ item: PhotosPickerItem) async {
        isUploading = true
        onUploadActivity(true)
        uploadError = nil
        defer {
            isUploading = false
            onUploadActivity(false)
            selectedPhoto = nil
        }

        do {
            guard let data = try await item.loadTransferable(type: Data.self) else {
                uploadError = "The selected image could not be read."
                return
            }
            let uploadData = try await NativeUploadService.preparedJPEG(from: data)
            let fileName = "content-\(UUID().uuidString).jpg"
            let alt = asset.alt.contentIsBlank ? title : asset.alt

            guard var uploaded = await model.uploadImage(
                data: uploadData,
                fileName: fileName,
                contentType: "image/jpeg",
                alt: alt
            ) else {
                uploadError = model.lastErrorMessage ?? "The image could not be uploaded."
                return
            }

            uploaded.caption = asset.caption
            uploaded.sanitised = showsSanitisation ? false : nil
            asset = uploaded
        } catch {
            uploadError = error.localizedDescription
        }
    }
}

struct MediaAssetListEditor: View {
    @Binding var assets: [MediaAsset]
    var onUploadActivity: (Bool) -> Void = { _ in }
    @State private var removalTarget: MediaAsset.ID?

    var body: some View {
        Section("Media") {
            ForEach($assets) { $asset in
                DisclosureGroup(asset.alt.isEmpty ? "New media" : asset.alt) {
                    MediaAssetEditor(
                        title: "Project media",
                        asset: $asset,
                        onUploadActivity: onUploadActivity
                    )

                    HStack {
                        Button("Move Up", systemImage: "chevron.up") {
                            move(assetID: asset.id, offset: -1)
                        }
                        .buttonStyle(.borderless)
                        .frame(minWidth: 44, minHeight: 44)
                        .disabled(assets.first?.id == asset.id)

                        Button("Move Down", systemImage: "chevron.down") {
                            move(assetID: asset.id, offset: 1)
                        }
                        .buttonStyle(.borderless)
                        .frame(minWidth: 44, minHeight: 44)
                        .disabled(assets.last?.id == asset.id)

                        Spacer()

                        Button("Remove", systemImage: "trash", role: .destructive) {
                            removalTarget = asset.id
                        }
                        .buttonStyle(.borderless)
                        .frame(minWidth: 44, minHeight: 44)
                    }
                    .labelStyle(.iconOnly)
                }
            }

            Button("Add Media", systemImage: "plus") {
                assets.append(MediaAsset())
            }
        }
        .confirmationDialog(
            "Remove this media item?",
            isPresented: Binding(
                get: { removalTarget != nil },
                set: { if !$0 { removalTarget = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Remove Media", role: .destructive) {
                guard let removalTarget else { return }
                assets.removeAll { $0.id == removalTarget }
                self.removalTarget = nil
            }
            Button("Keep Media", role: .cancel) {}
        } message: {
            Text("The item is removed from this draft. Its uploaded file is not deleted until storage cleanup runs.")
        }
    }

    private func move(assetID: MediaAsset.ID, offset: Int) {
        guard let source = assets.firstIndex(where: { $0.id == assetID }) else { return }
        let destination = source + offset
        guard assets.indices.contains(destination) else { return }
        assets.swapAt(source, destination)
    }
}

// MARK: - Validation helpers

extension String {
    var contentIsBlank: Bool {
        trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

extension MediaAsset {
    var contentIsValid: Bool {
        !url.contentIsBlank
            && !alt.contentIsBlank
            && Self.validPixelDimension(width)
            && Self.validPixelDimension(height)
    }

    private static func validPixelDimension(_ value: Double?) -> Bool {
        guard let value else { return true }
        return value.isFinite
            && value.rounded() == value
            && (1...20_000).contains(value)
    }
}
