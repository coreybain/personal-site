//
//  TokenManagementScreen.swift
//  Home
//

import SwiftUI
import UIKit

struct TokenManagementScreen: View {
    @Environment(HomeAppModel.self) private var model
    @State private var presentation: TokenPresentation?
    @State private var revokeTarget: IngestToken?
    @State private var operationError: String?

    var body: some View {
        List {
            ForEach(model.ingestTokens) { token in
                TokenRow(token: token)
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        if token.revokedAt == nil {
                            Button("Revoke", systemImage: "xmark.shield", role: .destructive) {
                                revokeTarget = token
                            }
                        }
                    }
            }
        }
        .navigationTitle("Ingest tokens")
        .overlay {
            if model.ingestTokens.isEmpty {
                ContentUnavailableView(
                    "No machine tokens",
                    systemImage: "key.horizontal",
                    description: Text("Issue a least-privilege credential for a data source.")
                )
            }
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Issue Token", systemImage: "plus") {
                    presentation = .issue
                }
                    .disabled(model.isBusy)
            }
        }
        .sheet(item: $presentation) { presentation in
            switch presentation {
            case .issue:
                IssueTokenSheet { token in
                    self.presentation = .issued(token)
                }
            case .issued(let token):
                OneTimeTokenSheet(token: token)
            }
        }
        .confirmationDialog(
            "Revoke token?",
            isPresented: Binding(
                get: { revokeTarget != nil },
                set: { if !$0 { revokeTarget = nil } }
            ),
            titleVisibility: .visible
        ) {
            if let token = revokeTarget {
                Button("Revoke \(token.name)", role: .destructive) {
                    Task {
                        operationError = nil
                        if await model.revokeToken(token.id) {
                            revokeTarget = nil
                        } else {
                            operationError = model.lastErrorMessage
                                ?? "The token could not be revoked."
                        }
                    }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Every future request using this credential will be rejected. Revocation cannot be undone.")
        }
        .alert(
            "Couldn’t revoke token",
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
}

nonisolated enum TokenPresentation: Identifiable {
    case issue
    case issued(IssuedToken)

    var id: String {
        switch self {
        case .issue:
            "issue"
        case .issued(let token):
            "issued-\(token.tokenId)"
        }
    }
}

private struct TokenRow: View {
    let token: IngestToken

    var body: some View {
        VStack(alignment: .leading, spacing: HorizonStyle.snug) {
            HStack {
                Text(token.name).font(.headline)
                Spacer()
                Label(
                    token.revokedAt == nil ? "Active" : "Revoked",
                    systemImage: token.revokedAt == nil ? "checkmark.shield" : "xmark.shield"
                )
                .font(.caption)
                .foregroundStyle(token.revokedAt == nil ? HorizonStyle.accent : .secondary)
            }
            Text(token.scopes.map(\.rawValue).joined(separator: " · "))
                .font(HorizonStyle.monoCaption)
                .foregroundStyle(.secondary)
            Text("Issued \(Self.date(token.issuedAt)) · Last used \(token.lastUsedAt.map(Self.date) ?? "never")")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, HorizonStyle.snug)
        .accessibilityElement(children: .combine)
    }

    private static func date(_ value: String) -> String {
        BackendDate.abbreviatedDateTime(value)
    }
}

private struct IssueTokenSheet: View {
    @Environment(HomeAppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var scopes: Set<IngestScope> = []
    @State private var isIssuing = false
    let onIssued: (IssuedToken) -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section("Machine") {
                    TextField("Name", text: $name)
                }
                Section("Least-privilege scopes") {
                    ForEach(IngestScope.allCases) { scope in
                        Toggle(scope.label, isOn: binding(for: scope))
                    }
                }
                if let error = model.lastErrorMessage {
                    Section { ContentInlineError(message: error) }
                }
            }
            .disabled(isIssuing)
            .navigationTitle("Issue token")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(isIssuing)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Issue") { issue() }
                        .disabled(
                            name.contentIsBlank
                                || scopes.isEmpty
                                || model.isBusy
                                || isIssuing
                        )
                }
            }
        }
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled(isIssuing)
    }

    private func binding(for scope: IngestScope) -> Binding<Bool> {
        Binding(
            get: { scopes.contains(scope) },
            set: { enabled in
                if enabled { scopes.insert(scope) } else { scopes.remove(scope) }
            }
        )
    }

    private func issue() {
        guard !isIssuing else { return }
        let requestedName = name
        let requestedScopes = IngestScope.allCases.filter(scopes.contains)
        isIssuing = true
        Task {
            defer { isIssuing = false }
            if let token = await model.issueToken(
                name: requestedName,
                scopes: requestedScopes
            ) {
                onIssued(token)
            }
        }
    }
}

private struct OneTimeTokenSheet: View {
    @Environment(\.dismiss) private var dismiss
    let token: IssuedToken
    @State private var copied = false

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: HorizonStyle.flow) {
                Label("Copy this token now", systemImage: "exclamationmark.shield")
                    .font(.title2.bold())
                Text("Only its SHA-256 digest is stored on the server. Closing this screen permanently loses the plaintext.")
                    .foregroundStyle(.secondary)
                Text(token.token)
                    .font(HorizonStyle.mono(.callout))
                    .textSelection(.enabled)
                    .padding(HorizonStyle.stack)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.quaternary, in: .rect(cornerRadius: 10))
                Button(copied ? "Copied" : "Copy Token", systemImage: copied ? "checkmark" : "doc.on.doc") {
                    UIPasteboard.general.string = token.token
                    copied = true
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                Spacer()
            }
            .padding(HorizonStyle.flow)
            .navigationTitle(token.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("I’ve saved it") { dismiss() }
                        .disabled(!copied)
                }
            }
        }
        .interactiveDismissDisabled()
    }
}

extension IssuedToken: Identifiable {
    var id: String { tokenId }
}
