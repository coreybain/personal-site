//
//  InboxScreen.swift
//  Home
//

import SwiftUI

struct InboxScreen: View {
    @Environment(HomeAppModel.self) private var model
    @State private var filter: ContactStatus?
    @State private var selection: ContactMessage?
    @State private var deletionTarget: ContactMessage?
    @State private var operationError: String?

    var body: some View {
        List {
            Section {
                Picker("Status", selection: $filter) {
                    Text("All").tag(ContactStatus?.none)
                    ForEach(ContactStatus.allCases) { status in
                        Text(status.label).tag(ContactStatus?.some(status))
                    }
                }
                .pickerStyle(.menu)
            }

            ForEach(filteredMessages) { message in
                Button {
                    selection = message
                } label: {
                    InboxRow(message: message)
                }
                .buttonStyle(.plain)
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    Button("Delete", systemImage: "trash", role: .destructive) {
                        deletionTarget = message
                    }
                    Button("Archive", systemImage: "archivebox") {
                        Task {
                            operationError = nil
                            guard await model.setContactStatus(
                                message.id,
                                status: .archived
                            ) else {
                                operationError = model.lastErrorMessage
                                    ?? "The message could not be archived."
                                return
                            }
                        }
                    }
                    .tint(HorizonStyle.accent)
                }
            }
        }
        .navigationTitle("Inbox")
        .overlay {
            if filteredMessages.isEmpty {
                ContentUnavailableView(
                    "No messages",
                    systemImage: "tray",
                    description: Text(filter.map { "No \($0.label.lowercased()) messages." } ?? "The contact inbox is empty.")
                )
            }
        }
        .sheet(item: $selection) { message in
            ContactMessageSheet(message: message)
        }
        .confirmationDialog(
            "Delete message?",
            isPresented: Binding(
                get: { deletionTarget != nil },
                set: { if !$0 { deletionTarget = nil } }
            ),
            titleVisibility: .visible
        ) {
            if let message = deletionTarget {
                Button("Delete from \(message.name)", role: .destructive) {
                    Task {
                        operationError = nil
                        if await model.deleteContactMessage(message.id) {
                            deletionTarget = nil
                        } else {
                            operationError = model.lastErrorMessage
                                ?? "The message could not be deleted."
                        }
                    }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Deletion is permanent. Archive genuine correspondence instead.")
        }
        .alert(
            "Couldn’t update inbox",
            isPresented: Binding(
                get: { operationError != nil },
                set: { if !$0 { operationError = nil } }
            )
        ) {
            Button("OK") { operationError = nil }
        } message: {
            Text(operationError ?? "Try again.")
        }
        .refreshable { await model.refreshSubscriptions() }
    }

    private var filteredMessages: [ContactMessage] {
        guard let filter else { return model.contactMessages }
        return model.contactMessages.filter { $0.status == filter }
    }
}

private struct InboxRow: View {
    let message: ContactMessage

    var body: some View {
        VStack(alignment: .leading, spacing: HorizonStyle.snug) {
            HStack {
                Text(message.name)
                    .font(message.status == .new ? .headline.bold() : .headline)
                Spacer()
                Text(message.status.label)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(message.status == .new ? HorizonStyle.accent : .secondary)
            }
            if let company = message.company, !company.isEmpty {
                Text(company).font(.subheadline).foregroundStyle(.secondary)
            }
            Text(message.message)
                .font(.subheadline)
                .lineLimit(2)
            Text(Self.displayDate(message.createdAt))
                .font(HorizonStyle.monoCaption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, HorizonStyle.snug)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens the message and triage controls")
    }

    private static func displayDate(_ value: String) -> String {
        BackendDate.abbreviatedDateTime(value)
    }
}

private struct ContactMessageSheet: View {
    @Environment(HomeAppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var status: ContactStatus
    @State private var confirmsDeletion = false
    @State private var isUpdatingStatus = false
    @State private var isRevertingStatus = false
    @State private var statusError: String?
    let message: ContactMessage

    init(message: ContactMessage) {
        self.message = message
        _status = State(initialValue: message.status)
    }

    var body: some View {
        NavigationStack {
            List {
                Section("Sender") {
                    LabeledContent("Name", value: message.name)
                    LabeledContent("Email") {
                        if let mailURL {
                            Link(message.email, destination: mailURL)
                        } else {
                            Text(message.email).textSelection(.enabled)
                        }
                    }
                    if let company = message.company {
                        LabeledContent("Company", value: company)
                    }
                LabeledContent(
                    "Received",
                    value: BackendDate.abbreviatedDateTime(message.createdAt)
                )
                        .font(.caption)
                }

                Section("Message") {
                    Text(message.message)
                        .textSelection(.enabled)
                }

                if let statusError {
                    Section {
                        Label(statusError, systemImage: "exclamationmark.triangle")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }

                Section("Triage") {
                    Picker("Status", selection: $status) {
                        ForEach(ContactStatus.allCases) { state in
                            Text(state.label).tag(state)
                        }
                    }
                    .onChange(of: status) { oldValue, newValue in
                        guard !isRevertingStatus else {
                            isRevertingStatus = false
                            return
                        }
                        Task { await updateStatus(from: oldValue, to: newValue) }
                    }
                    .disabled(isUpdatingStatus || model.isBusy)

                    if let mailURL {
                        Link(destination: mailURL) {
                            Label("Reply in Mail", systemImage: "arrowshape.turn.up.left")
                        }
                    }

                    Button("Delete Message", systemImage: "trash", role: .destructive) {
                        confirmsDeletion = true
                    }
                }
            }
            .navigationTitle(message.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .task {
                if message.status == .new {
                    status = .read
                }
            }
            .confirmationDialog(
                "Delete message permanently?",
                isPresented: $confirmsDeletion,
                titleVisibility: .visible
            ) {
                Button("Delete Message", role: .destructive) {
                    Task {
                        statusError = nil
                        if await model.deleteContactMessage(message.id) {
                            dismiss()
                        } else {
                            statusError = model.lastErrorMessage
                                ?? "The message could not be deleted."
                        }
                    }
                }
                Button("Cancel", role: .cancel) {}
            }
        }
    }

    private var mailURL: URL? {
        var components = URLComponents()
        components.scheme = "mailto"
        components.path = message.email
        return components.url
    }

    private func updateStatus(from oldValue: ContactStatus, to newValue: ContactStatus) async {
        guard oldValue != newValue, !isUpdatingStatus else { return }
        isUpdatingStatus = true
        statusError = nil
        defer { isUpdatingStatus = false }

        guard await model.setContactStatus(message.id, status: newValue) else {
            statusError = model.lastErrorMessage ?? "The message status could not be updated."
            isRevertingStatus = true
            status = oldValue
            return
        }
    }
}
