//
//  HealthTabView.swift
//  Home
//
//  HealthKit permission, scoped-token setup, foreground sync and diagnostics.
//

import SwiftUI
import UIKit

struct HealthTabView: View {
    @Environment(HomeAppModel.self) private var model
    @State private var health = HealthSyncService.shared
    @State private var pastedToken = ""
    @State private var issuedCredential: IssuedHealthCredential?
    @State private var isIssuingToken = false
    @State private var confirmsTokenRemoval = false

    var body: some View {
        List {
            Section("Today") {
                if let day = health.latestDay {
                    LabeledContent("Day", value: day.day)
                    LabeledContent("Steps") {
                        Text(day.steps, format: .number.precision(.fractionLength(0)))
                            .font(HorizonStyle.mono())
                            .horizonNumerals()
                    }
                    LabeledContent("Walking distance") {
                        Text("\(day.distanceKm.formatted(.number.precision(.fractionLength(2)))) km")
                            .font(HorizonStyle.mono())
                            .horizonNumerals()
                    }
                    LabeledContent("Activities") {
                        Text(day.activities.count, format: .number)
                            .font(HorizonStyle.mono())
                            .horizonNumerals()
                    }
                } else {
                    ContentUnavailableView(
                        "No local summary yet",
                        systemImage: "figure.walk",
                        description: Text("Grant read access, then sync today’s totals.")
                    )
                }

                Button("Grant Health Access & Sync", systemImage: "heart.text.square") {
                    Task { await health.requestAccessAndSync() }
                }
                .disabled(health.isSyncing || !health.hasToken)

                Button("Sync Now", systemImage: "arrow.triangle.2.circlepath") {
                    Task { await health.syncToday() }
                }
                .disabled(health.isSyncing || !health.hasToken)
            }

            Section {
                HStack {
                    Label(
                        health.hasToken ? "Token stored in Keychain" : "No health token",
                        systemImage: health.hasToken ? "checkmark.shield" : "key"
                    )
                    Spacer()
                    if health.hasToken {
                        Text("health:write")
                            .font(HorizonStyle.monoCaption)
                            .foregroundStyle(.secondary)
                    }
                }

                Button("Create This iPhone Token", systemImage: "plus.circle") {
                    issueHealthToken()
                }
                .disabled(model.isBusy || isIssuingToken)

                SecureField("Paste health:write token", text: $pastedToken)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()

                Button("Save Pasted Token", systemImage: "key.fill") {
                    if health.saveToken(pastedToken) {
                        pastedToken = ""
                    }
                }
                .disabled(pastedToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                if health.hasToken {
                    Button("Remove Stored Token", systemImage: "trash", role: .destructive) {
                        confirmsTokenRemoval = true
                    }
                }
            } header: {
                Text("Scoped credential")
            } footer: {
                Text("The plaintext is stored only in this app’s Keychain. It authenticates background health writes and is independent of your Clerk session.")
            }

            Section("Diagnostics") {
                LabeledContent("Background delivery") {
                    Text(health.monitoringEnabled ? "Enabled" : "Not enabled")
                }
                LabeledContent("Last successful push") {
                    if let date = health.lastSyncedAt {
                        Text(date, format: .dateTime.month().day().hour().minute())
                    } else {
                        Text("Never").foregroundStyle(.secondary)
                    }
                }
                LabeledContent("Endpoint") {
                    Text(Config.convexSiteURL?.host() ?? "Not configured")
                        .font(HorizonStyle.monoCaption)
                        .textSelection(.enabled)
                }
            }

            if let error = health.errorMessage ?? model.lastErrorMessage {
                Section { ContentInlineError(message: error) }
            }
        }
        .navigationTitle("Health sync")
        .navigationBarBackButtonHidden(isIssuingToken)
        .overlay {
            if health.isSyncing || isIssuingToken {
                ProgressView(isIssuingToken ? "Issuing token…" : "Syncing Health…")
                    .padding()
                    .background(.regularMaterial, in: .rect(cornerRadius: 12))
            }
        }
        .sheet(item: $issuedCredential) { credential in
            IssuedHealthTokenSheet(
                token: credential.token,
                storedInKeychain: credential.storedInKeychain,
                previousTokenRevoked: credential.previousTokenRevoked
            )
        }
        .confirmationDialog(
            "Remove the stored health token?",
            isPresented: $confirmsTokenRemoval,
            titleVisibility: .visible
        ) {
            Button(
                health.managedTokenID == nil ? "Remove from Keychain" : "Revoke & Remove",
                role: .destructive
            ) {
                removeStoredToken()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(
                health.managedTokenID == nil
                    ? "Background HealthKit uploads will stop. A pasted or legacy token must be revoked separately if it should no longer be usable."
                    : "The server credential will be revoked before it is removed from this iPhone."
            )
        }
        .task { await health.startBackgroundMonitoring() }
    }

    private func issueHealthToken() {
        guard !isIssuingToken else { return }
        let deviceName = UIDevice.current.name
        let previousTokenID = health.managedTokenID
        isIssuingToken = true
        Task {
            defer { isIssuingToken = false }
            guard let issued = await model.issueToken(
                name: "\(deviceName) HealthKit",
                scopes: [.healthWrite]
            ) else { return }

            let storedInKeychain = health.saveToken(
                issued.token,
                tokenID: issued.tokenId
            )
            var previousTokenRevoked: Bool?
            if storedInKeychain,
               let previousTokenID,
               previousTokenID != issued.tokenId
            {
                previousTokenRevoked = await model.revokeToken(previousTokenID)
            }

            issuedCredential = IssuedHealthCredential(
                token: issued.token,
                storedInKeychain: storedInKeychain,
                previousTokenRevoked: previousTokenRevoked
            )
        }
    }

    private func removeStoredToken() {
        Task {
            if let tokenID = health.managedTokenID {
                let revoked = await model.revokeToken(tokenID)
                guard revoked else { return }
            }
            health.removeToken()
        }
    }
}

private struct IssuedHealthCredential: Identifiable {
    let id = UUID()
    let token: String
    let storedInKeychain: Bool
    let previousTokenRevoked: Bool?
}

private struct IssuedHealthTokenSheet: View {
    @Environment(\.dismiss) private var dismiss
    let token: String
    let storedInKeychain: Bool
    let previousTokenRevoked: Bool?
    @State private var copied = false

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: HorizonStyle.flow) {
                Label(
                    storedInKeychain ? "Saved to this iPhone" : "Copy this token now",
                    systemImage: storedInKeychain
                        ? "checkmark.shield.fill"
                        : "exclamationmark.shield.fill"
                )
                    .font(.title2.bold())

                Text(
                    storedInKeychain
                        ? "This plaintext is available only now. It is already secured in Keychain; copy it only if you also need an external backup."
                        : "Keychain could not store this one-time credential. Copy it before closing, then paste it into the token field and try again."
                )
                    .foregroundStyle(.secondary)

                if previousTokenRevoked == false {
                    Label(
                        "The new token is saved, but the previous server token could not be revoked. Revoke it from Token management.",
                        systemImage: "exclamationmark.triangle.fill"
                    )
                    .font(.callout)
                    .foregroundStyle(.orange)
                }

                Text(token)
                    .font(HorizonStyle.mono(.callout))
                    .textSelection(.enabled)
                    .padding(HorizonStyle.stack)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.quaternary, in: .rect(cornerRadius: 10))

                Button(copied ? "Copied" : "Copy Token", systemImage: copied ? "checkmark" : "doc.on.doc") {
                    UIPasteboard.general.string = token
                    copied = true
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)

                Spacer()
            }
            .padding(HorizonStyle.flow)
            .navigationTitle("New health token")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(storedInKeychain ? "Done" : "I’ve copied it") {
                        dismiss()
                    }
                    .disabled(!storedInKeychain && !copied)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled()
    }
}

#Preview {
    NavigationStack { HealthTabView() }
        .environment(HomeAppModel.preview)
}
