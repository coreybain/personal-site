//
//  ClerkAuthProvider.swift
//  Home
//
//  Bridges Clerk's renewable "convex" JWT template into ConvexMobile's
//  push-based AuthProvider contract.
//

import ClerkKit
@preconcurrency import ConvexMobile
import Foundation

nonisolated struct ClerkAuthSession: Hashable, Sendable {
    let idToken: String
    let sessionID: String
    let email: String?
}

nonisolated enum ClerkAuthProviderError: LocalizedError, Sendable, Equatable {
    case noSession
    case missingConvexToken
    case sessionChanged
    case signOutIncomplete

    var errorDescription: String? {
        switch self {
        case .noSession:
            "Sign in with Clerk before connecting to Convex."
        case .missingConvexToken:
            "Clerk did not return the required ‘convex’ JWT template."
        case .sessionChanged:
            "The Clerk session changed while its Convex token was refreshing."
        case .signOutIncomplete:
            "Clerk could not end the current session. Your signed-in data is still available."
        }
    }
}

/// A sign-out request is only complete after Clerk's authoritative session has
/// disappeared. ConvexMobile currently consumes provider logout errors, so the
/// app model independently verifies this postcondition before clearing data.
nonisolated enum ClerkSignOutPolicy {
    static func completed(currentSessionID: String?) -> Bool {
        currentSessionID == nil
    }
}

/// Maps the app's connection intent to Clerk's token-cache semantics. A normal
/// cold launch accepts a still-valid cached template token; a completed sign-in
/// must skip that cache so changed claims are visible immediately.
nonisolated enum ClerkConnectionMode: Equatable, Sendable {
    case cached
    case forced

    var skipCache: Bool { self == .forced }
}

/// Both the provider's token refresh and the app model's reconnect loop use a
/// finite retry budget. Foregrounding the app starts a fresh budget, so a
/// temporary outage cannot leave the session permanently disconnected.
nonisolated enum ClerkRetryPolicy {
    static let maximumAttempts = 5

    static func permits(attempt: Int) -> Bool {
        attempt > 0 && attempt <= maximumAttempts
    }

    static func delaySeconds(forAttempt attempt: Int) -> Double {
        let boundedAttempt = max(1, min(attempt, maximumAttempts))
        return min(pow(2, Double(boundedAttempt - 1)), 16)
    }
}

/// A failed token request is not evidence that Clerk signed out. Only the
/// provider's explicit `noSession` result may transition the app to signed out;
/// network and token-template failures retain the last authenticated snapshot.
nonisolated enum ClerkConnectionFailurePolicy {
    static func shouldSignOut(for error: Error) -> Bool {
        (error as? ClerkAuthProviderError) == .noSession
    }
}

nonisolated enum ClerkSessionChangeAction: Equatable, Sendable {
    case signedOut
    case replaceIdentity
    case connect
    case refresh
}

/// Reduces Clerk's session event (including its old and new session IDs) into
/// an identity-safe action. An A -> B switch is distinct from an in-place
/// update of A and must detach A before reconnecting as B.
nonisolated enum ClerkSessionChangePolicy {
    static func action(
        oldSessionID: String?,
        newSessionID: String?,
        connectedSessionID: String?
    ) -> ClerkSessionChangeAction {
        guard let newSessionID else { return .signedOut }

        if let connectedSessionID, connectedSessionID != newSessionID {
            return .replaceIdentity
        }
        if let oldSessionID, oldSessionID != newSessionID {
            return .replaceIdentity
        }
        if connectedSessionID == nil {
            return .connect
        }
        return .refresh
    }
}

/// Convex serialises login calls, but Clerk events can arrive while a cached
/// cold-launch login is suspended. Preserve a concurrent stronger request and
/// run it immediately afterwards instead of silently dropping it.
nonisolated struct ClerkConnectionCoalescer: Sendable {
    private(set) var activeMode: ClerkConnectionMode?
    private var forcedRefreshPending = false

    mutating func begin(_ mode: ClerkConnectionMode) -> Bool {
        guard let activeMode else {
            self.activeMode = mode
            return true
        }

        if activeMode == .cached, mode == .forced {
            forcedRefreshPending = true
        }
        return false
    }

    mutating func finishAndTakeNext() -> ClerkConnectionMode? {
        if forcedRefreshPending {
            forcedRefreshPending = false
            activeMode = .forced
            return .forced
        }

        activeMode = nil
        return nil
    }
}

/// An actor keeps the refresh callback and event task race-free. Clerk's
/// `Session` and `AuthEvent` values are Sendable, so only access to the shared
/// Clerk singleton crosses to MainActor.
actor ClerkAuthProvider: AuthProvider {
    typealias T = ClerkAuthSession

    private var onIdToken: (@Sendable (String?) -> Void)?
    private var eventTask: Task<Void, Never>?
    private var retryTask: Task<Void, Never>?
    private var retryAttempt = 0
    private var connectedSessionID: String?

    func login(
        onIdToken: @Sendable @escaping (String?) -> Void
    ) async throws -> ClerkAuthSession {
        try await connect(onIdToken: onIdToken, mode: .forced)
    }

    func loginFromCache(
        onIdToken: @Sendable @escaping (String?) -> Void
    ) async throws -> ClerkAuthSession {
        try await connect(onIdToken: onIdToken, mode: .cached)
    }

    func logout() async throws {
        try await Clerk.shared.auth.signOut()
        guard ClerkSignOutPolicy.completed(
            currentSessionID: await currentClerkSessionID()
        ) else {
            throw ClerkAuthProviderError.signOutIncomplete
        }

        // Do not detach Convex or discard retry state until Clerk confirms the
        // session is gone. If sign-out throws, the existing authenticated
        // bridge remains valid and the app can safely keep rendering its data.
        let callback = onIdToken
        onIdToken = nil
        eventTask?.cancel()
        eventTask = nil
        cancelRefreshRetry(resetAttempts: true)
        connectedSessionID = nil
        callback?(nil)
    }

    nonisolated func extractIdToken(from authResult: ClerkAuthSession) -> String {
        authResult.idToken
    }

    private func connect(
        onIdToken callback: @Sendable @escaping (String?) -> Void,
        mode: ClerkConnectionMode
    ) async throws -> ClerkAuthSession {
        onIdToken = callback
        startEventBridgeIfNeeded()

        do {
            let authSession = try await currentAuthSession(skipCache: mode.skipCache)
            cancelRefreshRetry(resetAttempts: true)
            connectedSessionID = authSession.sessionID
            callback(authSession.idToken)
            return authSession
        } catch {
            if ClerkConnectionFailurePolicy.shouldSignOut(for: error) {
                cancelRefreshRetry(resetAttempts: true)
                connectedSessionID = nil
                callback(nil)
            } else {
                let sessionID = await currentClerkSessionID()
                scheduleRefreshRetry(expectedSessionID: sessionID)
            }
            throw error
        }
    }

    private func currentAuthSession(skipCache: Bool = false) async throws -> ClerkAuthSession {
        guard let session = await MainActor.run(body: { Clerk.shared.session }) else {
            throw ClerkAuthProviderError.noSession
        }

        let options = Session.GetTokenOptions(
            template: "convex",
            expirationBuffer: 30,
            skipCache: skipCache
        )
        guard let token = try await session.getToken(options), !token.isEmpty else {
            throw ClerkAuthProviderError.missingConvexToken
        }
        guard await MainActor.run(body: { Clerk.shared.session?.id }) == session.id else {
            throw ClerkAuthProviderError.sessionChanged
        }

        return ClerkAuthSession(
            idToken: token,
            sessionID: session.id,
            email: session.user?.primaryEmailAddress?.emailAddress
        )
    }

    private func startEventBridgeIfNeeded() {
        guard eventTask == nil else { return }

        eventTask = Task { [weak self] in
            let events = await MainActor.run { Clerk.shared.auth.events }
            for await event in events {
                guard !Task.isCancelled else { break }
                await self?.handle(event)
            }
        }
    }

    private func handle(_ event: AuthEvent) async {
        switch event {
        case .signedOut, .accountDeleted:
            cancelRefreshRetry(resetAttempts: true)
            connectedSessionID = nil
            onIdToken?(nil)

        case .sessionChanged(let oldValue, let newValue):
            let action = ClerkSessionChangePolicy.action(
                oldSessionID: oldValue?.id,
                newSessionID: newValue?.id,
                connectedSessionID: connectedSessionID
            )
            guard action != .signedOut else {
                cancelRefreshRetry(resetAttempts: true)
                connectedSessionID = nil
                onIdToken?(nil)
                return
            }

            if action == .replaceIdentity {
                // Stop retry work bound to A before fetching for B. The app
                // model performs the corresponding data/subscription teardown.
                cancelRefreshRetry(resetAttempts: true)
                connectedSessionID = nil
            }
            await pushFreshToken(skipCache: true)

        case .signInCompleted, .signUpCompleted:
            await pushFreshToken(skipCache: true)

        case .tokenRefreshed:
            // Clerk emits this event for *every* template fetch, including the
            // forced `convex` fetch above. Forcing another fetch here creates an
            // event/fetch loop. A cached lookup still renews the template once it
            // enters its expiration buffer and safely returns the fresh token.
            await pushFreshToken(skipCache: false)

        case .signInNeedsContinuation, .signUpNeedsContinuation:
            break
        }
    }

    private func pushFreshToken(skipCache: Bool) async {
        do {
            let session = try await currentAuthSession(skipCache: skipCache)
            cancelRefreshRetry(resetAttempts: true)
            connectedSessionID = session.sessionID
            onIdToken?(session.idToken)
        } catch let providerError as ClerkAuthProviderError
            where providerError == .noSession {
            cancelRefreshRetry(resetAttempts: true)
            connectedSessionID = nil
            onIdToken?(nil)
        } catch {
            // A network failure while renewing must not actively log Convex out;
            // its current JWT may still be valid. Retry with bounded backoff and
            // let explicit Clerk sign-out/session events clear the identity.
            let sessionID = await currentClerkSessionID()
            scheduleRefreshRetry(expectedSessionID: sessionID)
        }
    }

    private func scheduleRefreshRetry(expectedSessionID: String?) {
        guard retryTask == nil,
              onIdToken != nil,
              let expectedSessionID
        else { return }

        let nextAttempt = retryAttempt + 1
        guard ClerkRetryPolicy.permits(attempt: nextAttempt) else { return }
        retryAttempt = nextAttempt
        let delay = ClerkRetryPolicy.delaySeconds(forAttempt: nextAttempt)
        retryTask = Task { [weak self] in
            do {
                try await Task.sleep(for: .seconds(delay))
            } catch {
                return
            }
            guard !Task.isCancelled, let self else { return }
            await self.performScheduledRefresh(expectedSessionID: expectedSessionID)
        }
    }

    private func performScheduledRefresh(expectedSessionID: String) async {
        guard !Task.isCancelled,
              onIdToken != nil,
              await currentClerkSessionID() == expectedSessionID
        else {
            retryTask = nil
            return
        }

        retryTask = nil
        await pushFreshToken(skipCache: true)
    }

    private func cancelRefreshRetry(resetAttempts: Bool) {
        retryTask?.cancel()
        retryTask = nil
        if resetAttempts { retryAttempt = 0 }
    }

    private func currentClerkSessionID() async -> String? {
        await MainActor.run { Clerk.shared.session?.id }
    }
}
