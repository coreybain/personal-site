//
//  HomeAppModel.swift
//  Home
//
//  The single observable boundary between SwiftUI and the site's Convex API.
//  Every feature reads live subscriptions and sends named mutations through
//  this model; views never construct network clients or touch Clerk directly.
//

import ClerkKit
import Combine
@preconcurrency import ConvexMobile
import Foundation
import Observation

@MainActor
@Observable
final class HomeAppModel {
    enum SessionState: Equatable {
        case configurationMissing
        case loading
        case signedOut
        case signedIn(email: String?)
    }

    enum ConnectionState: String, Equatable {
        case unavailable
        case connecting
        case connected
    }

    private(set) var sessionState: SessionState
    private(set) var connectionState: ConnectionState = .unavailable
    private(set) var isBusy = false
    private(set) var subscriptionsAreStale = false
    var lastErrorMessage: String?

    private(set) var projects: [ProjectRecord] = []
    private(set) var labs: [LabRecord] = []
    private(set) var posts: [PostRecord] = []
    private(set) var funEntries: [FunEntryRecord] = []
    private(set) var experienceEntries: [ExperienceRecord] = []
    private(set) var resumeDocument: ResumeRecord?
    private(set) var siteSettings: SiteSettingsRecord?
    private(set) var hasLoadedProfile = false
    private(set) var contactMessages: [ContactMessage] = []
    private(set) var ingestTokens: [IngestToken] = []

    private let client: ConvexClientWithAuth<ClerkAuthSession>?
    private let isPreview: Bool
    private var hasStarted = false
    private var connectionRequests = ClerkConnectionCoalescer()
    private var connectionCancellables: Set<AnyCancellable> = []
    private var dataCancellables: [String: AnyCancellable] = [:]
    private var subscriptionRetryTasks: [String: Task<Void, Never>] = [:]
    private var subscriptionRetryAttempts: [String: Int] = [:]
    private var staleSubscriptionKeys: Set<String> = []
    private var authEventsTask: Task<Void, Never>?
    private var authenticationRetryTask: Task<Void, Never>?
    private var authenticationRetryAttempt = 0
    private var authenticationNeedsRetry = false
    private var currentSessionID: String?
    private var loadedExperience = false
    private var loadedResume = false
    private var loadedSiteSettings = false
    private var busyOperationCount = 0

    init(preview: Bool = false) {
        isPreview = preview

        if preview {
            sessionState = .signedIn(email: "preview@coreybaines.com")
            client = nil
            installPreviewData()
            return
        }

        guard case .ready = Config.status,
              let deploymentURL = Config.convexDeploymentURL
        else {
            sessionState = .configurationMissing
            client = nil
            return
        }

        sessionState = .loading
        client = ConvexClientWithAuth(
            deploymentUrl: deploymentURL.absoluteString,
            authProvider: ClerkAuthProvider()
        )
    }

    static var preview: HomeAppModel {
        HomeAppModel(preview: true)
    }

    var businessCardIdentity: BusinessCardIdentity {
        siteSettings?.identity.businessCardIdentity ?? SiteIdentity().businessCardIdentity
    }

    var hasLoadedSiteSettings: Bool { loadedSiteSettings }

    var newMessageCount: Int {
        contactMessages.count { $0.status == .new }
    }

    // MARK: - Lifecycle and authentication

    func start() async {
        guard !hasStarted, !isPreview else { return }
        hasStarted = true

        guard let client else {
            sessionState = .configurationMissing
            return
        }

        observe(client: client)
        observeClerkEvents()

        // Clerk.configure synchronously hydrates its cached client identity
        // (`CacheManager.loadCachedData`) before it returns. Its network refresh
        // continues asynchronously and is covered by the event observer above.
        if Clerk.shared.session == nil {
            sessionState = .signedOut
        } else {
            await connect(useCache: true)
        }
    }

    @discardableResult
    func signOut() async -> Bool {
        guard let client else {
            report(HomeAppModelError.backendUnavailable)
            return false
        }
        beginBusyOperation()
        lastErrorMessage = nil
        defer { endBusyOperation() }

        // ConvexMobile's public logout currently consumes AuthProvider errors.
        // Verify Clerk's authoritative session after it returns before
        // discarding any identity-scoped subscriptions or data.
        await client.logout()
        guard ClerkSignOutPolicy.completed(
            currentSessionID: Clerk.shared.session?.id
        ) else {
            lastErrorMessage = ClerkAuthProviderError.signOutIncomplete.localizedDescription
            return false
        }

        transitionToSignedOut()
        return true
    }

    func clearError() {
        lastErrorMessage = nil
    }

    func refreshSubscriptions() async {
        guard sessionState.isSignedIn else { return }
        subscribeToData()
        await Task.yield()
    }

    /// Call from the app's active `scenePhase` to immediately resume a
    /// previously exhausted or sleeping authentication retry. This never signs
    /// the user out for a network failure and starts a fresh bounded retry
    /// budget for the current Clerk session.
    func retryAuthenticationOnForeground() async {
        guard !isPreview, client != nil else { return }
        guard let clerkSessionID = Clerk.shared.session?.id else {
            transitionToSignedOut()
            return
        }

        let identityChanged = currentSessionID.map { $0 != clerkSessionID } ?? false
        guard authenticationNeedsRetry
                || authenticationRetryTask != nil
                || !sessionState.isSignedIn
                || identityChanged
        else { return }

        cancelAuthenticationRetry(resetAttempts: true)
        authenticationNeedsRetry = false
        if identityChanged {
            stopDataSubscriptions()
            clearSessionData()
            connectionState = .connecting
        }
        await connect(useCache: !identityChanged)
    }

    private func observe(client: ConvexClientWithAuth<ClerkAuthSession>) {
        client.authState
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in
                guard let self else { return }
                switch state {
                case .loading:
                    // A refresh of an existing session should not replace the
                    // usable authenticated snapshot with a full-screen loader.
                    if !self.sessionState.isSignedIn {
                        self.sessionState = .loading
                    }
                    self.connectionState = .connecting
                case .unauthenticated:
                    // Convex emits this for *every* failed login attempt and
                    // does not preserve the underlying error. The connect call
                    // below is the authoritative place that distinguishes an
                    // explicit Clerk no-session result from a transient error.
                    if Clerk.shared.session == nil {
                        self.transitionToSignedOut()
                    }
                case .authenticated(let authSession):
                    if let currentSessionID = self.currentSessionID,
                       currentSessionID != authSession.sessionID {
                        self.clearSessionData()
                    }
                    self.currentSessionID = authSession.sessionID
                    self.sessionState = .signedIn(email: authSession.email)
                    self.subscribeToData()
                }
            }
            .store(in: &connectionCancellables)

        client.watchWebSocketState()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in
                switch state {
                case .connected:
                    self?.connectionState = .connected
                case .connecting:
                    self?.connectionState = .connecting
                }
            }
            .store(in: &connectionCancellables)
    }

    private func observeClerkEvents() {
        guard authEventsTask == nil else { return }

        authEventsTask = Task { @MainActor [weak self] in
            for await event in Clerk.shared.auth.events {
                guard let self, !Task.isCancelled else { break }
                switch event {
                case .signInCompleted, .signUpCompleted:
                    await self.connect(useCache: false)
                case .sessionChanged(let oldSession, let newSession):
                    let action = ClerkSessionChangePolicy.action(
                        oldSessionID: oldSession?.id,
                        newSessionID: newSession?.id,
                        connectedSessionID: self.currentSessionID
                    )
                    switch action {
                    case .signedOut:
                        self.transitionToSignedOut()
                    case .replaceIdentity:
                        self.cancelAuthenticationRetry(resetAttempts: true)
                        self.authenticationNeedsRetry = false
                        self.stopDataSubscriptions()
                        self.clearSessionData()
                        self.sessionState = .loading
                        self.connectionState = .connecting
                        await self.connect(useCache: false)
                    case .connect:
                        await self.connect(useCache: false)
                    case .refresh:
                        break
                    }
                case .signedOut, .accountDeleted:
                    self.transitionToSignedOut()
                case .signInNeedsContinuation, .signUpNeedsContinuation, .tokenRefreshed:
                    break
                }
            }
        }
    }

    private func connect(useCache: Bool) async {
        guard let client else { return }
        var mode: ClerkConnectionMode = useCache ? .cached : .forced
        guard connectionRequests.begin(mode) else { return }
        var retryRequest: (mode: ClerkConnectionMode, sessionID: String)?

        while true {
            if !sessionState.isSignedIn {
                sessionState = .loading
            }
            connectionState = .connecting
            let result = mode == .cached
                ? await client.loginFromCache()
                : await client.login()
            switch result {
            case .success:
                cancelAuthenticationRetry(resetAttempts: true)
                authenticationNeedsRetry = false
                retryRequest = nil
            case .failure(let error):
                if ClerkConnectionFailurePolicy.shouldSignOut(for: error) {
                    transitionToSignedOut()
                    retryRequest = nil
                } else {
                    // Preserve data and the signed-in state. A failed token
                    // refresh is recoverable and Convex may still have a valid
                    // cached JWT for the current identity.
                    authenticationNeedsRetry = true
                    report(error)
                    if let sessionID = Clerk.shared.session?.id {
                        retryRequest = (mode, sessionID)
                    }
                }
            }

            guard let nextMode = connectionRequests.finishAndTakeNext() else {
                if let retryRequest {
                    scheduleAuthenticationRetry(
                        mode: retryRequest.mode,
                        expectedSessionID: retryRequest.sessionID
                    )
                }
                return
            }
            mode = nextMode
        }
    }

    private func scheduleAuthenticationRetry(
        mode: ClerkConnectionMode,
        expectedSessionID: String
    ) {
        guard authenticationRetryTask == nil, authenticationNeedsRetry else { return }
        let nextAttempt = authenticationRetryAttempt + 1
        guard ClerkRetryPolicy.permits(attempt: nextAttempt) else { return }
        authenticationRetryAttempt = nextAttempt
        let delay = ClerkRetryPolicy.delaySeconds(forAttempt: nextAttempt)

        authenticationRetryTask = Task { @MainActor [weak self] in
            do {
                try await Task.sleep(for: .seconds(delay))
            } catch {
                return
            }
            guard !Task.isCancelled,
                  let self,
                  self.authenticationNeedsRetry,
                  Clerk.shared.session?.id == expectedSessionID
            else { return }

            self.authenticationRetryTask = nil
            await self.connect(useCache: mode == .cached)
        }
    }

    private func cancelAuthenticationRetry(resetAttempts: Bool) {
        authenticationRetryTask?.cancel()
        authenticationRetryTask = nil
        if resetAttempts { authenticationRetryAttempt = 0 }
    }

    private func transitionToSignedOut() {
        cancelAuthenticationRetry(resetAttempts: true)
        authenticationNeedsRetry = false
        stopDataSubscriptions()
        clearSessionData()
        sessionState = .signedOut
        connectionState = .unavailable
    }

    // MARK: - Live data

    private func subscribeToData() {
        guard let client else { return }
        stopDataSubscriptions()

        subscribe(
            key: "projects",
            makePublisher: {
                client.subscribe(
                    to: "projects:listAdmin",
                    yielding: [ProjectRecord].self
                )
            },
            assign: { $0.projects = $1 }
        )

        subscribe(
            key: "labs",
            makePublisher: {
                client.subscribe(
                    to: "labs:listAdmin",
                    yielding: [LabRecord].self
                )
            },
            assign: { $0.labs = $1 }
        )

        subscribe(
            key: "posts",
            makePublisher: {
                client.subscribe(to: "posts:listAdmin", yielding: [PostRecord].self)
            },
            assign: { $0.posts = $1 }
        )

        subscribe(
            key: "funEntries",
            makePublisher: {
                client.subscribe(to: "funEntries:listAdmin", yielding: [FunEntryRecord].self)
            },
            assign: { $0.funEntries = $1 }
        )

        subscribe(
            key: "experience",
            makePublisher: {
                client.subscribe(to: "experienceEntries:list", yielding: [ExperienceRecord].self)
            },
            assign: {
                $0.experienceEntries = $1
                $0.loadedExperience = true
                $0.updateProfileHydration()
            }
        )

        subscribe(
            key: "resume",
            makePublisher: {
                client.subscribe(to: "resume:get", yielding: ResumeRecord?.self)
            },
            assign: {
                $0.resumeDocument = $1
                $0.loadedResume = true
                $0.updateProfileHydration()
            }
        )

        subscribe(
            key: "siteSettings",
            makePublisher: {
                client.subscribe(to: "siteSettings:get", yielding: SiteSettingsRecord?.self)
            },
            assign: {
                $0.siteSettings = $1
                $0.loadedSiteSettings = true
                $0.updateProfileHydration()
            }
        )

        subscribe(
            key: "contactMessages",
            makePublisher: {
                client.subscribe(to: "contactMessages:listAdmin", yielding: [ContactMessage].self)
            },
            assign: { $0.contactMessages = $1 }
        )

        subscribe(
            key: "ingestTokens",
            makePublisher: {
                client.subscribe(to: "ingestTokens:list", yielding: [IngestToken].self)
            },
            assign: { $0.ingestTokens = $1 }
        )
    }

    private func subscribe<Value: Decodable>(
        key: String,
        makePublisher: @escaping () -> AnyPublisher<Value, ClientError>,
        assign: @MainActor @escaping (HomeAppModel, Value) -> Void
    ) {
        dataCancellables[key] = makePublisher()
            .receive(on: DispatchQueue.main)
            .sink(
                receiveCompletion: { [weak self] completion in
                    guard let self, case .failure(let error) = completion else { return }
                    self.report(error)
                    self.staleSubscriptionKeys.insert(key)
                    self.subscriptionsAreStale = true
                    self.connectionState = .connecting
                    self.scheduleSubscriptionRetry(
                        key: key,
                        makePublisher: makePublisher,
                        assign: assign
                    )
                },
                receiveValue: { [weak self] value in
                    guard let self else { return }
                    assign(self, value)
                    self.subscriptionRetryAttempts[key] = 0
                    self.staleSubscriptionKeys.remove(key)
                    self.subscriptionsAreStale = !self.staleSubscriptionKeys.isEmpty
                    if !self.subscriptionsAreStale {
                        self.connectionState = .connected
                    }
                }
            )
    }

    private func scheduleSubscriptionRetry<Value: Decodable>(
        key: String,
        makePublisher: @escaping () -> AnyPublisher<Value, ClientError>,
        assign: @MainActor @escaping (HomeAppModel, Value) -> Void
    ) {
        subscriptionRetryTasks[key]?.cancel()
        let attempt = (subscriptionRetryAttempts[key] ?? 0) + 1
        subscriptionRetryAttempts[key] = attempt
        let delay = SubscriptionRetryPolicy.delaySeconds(forAttempt: attempt)

        subscriptionRetryTasks[key] = Task { @MainActor [weak self] in
            do {
                try await Task.sleep(for: .seconds(delay))
            } catch {
                return
            }
            guard let self, self.sessionState.isSignedIn else { return }
            self.subscriptionRetryTasks[key] = nil
            self.subscribe(key: key, makePublisher: makePublisher, assign: assign)
        }
    }

    private func stopDataSubscriptions() {
        dataCancellables.removeAll()
        subscriptionRetryTasks.values.forEach { $0.cancel() }
        subscriptionRetryTasks.removeAll()
        subscriptionRetryAttempts.removeAll()
    }

    // MARK: - Projects

    func saveProject(
        _ draft: ProjectDraft,
        includeBuildStats: Bool = false
    ) async -> MutationResult {
        await mutate {
            if let projectID = draft.recordID {
                var args: [String: ConvexEncodable?] = [
                    "projectId": projectID,
                    "expectedRevision": draft.baseRevision,
                    "slug": draft.slug,
                    "title": draft.title,
                    "client": draft.client,
                    "attribution": draft.attribution,
                    "role": draft.role,
                    "period": Self.nullableString(draft.period),
                    "summary": draft.summary,
                    "problem": Self.nullableString(draft.problem),
                    "approach": Self.nullableString(draft.approach),
                    "outcomes": draft.outcomes.isEmpty ? nil : ConvexJSON(draft.outcomes),
                    "body": Self.nullableString(draft.body),
                    "stack": ConvexJSON(draft.stack),
                    "media": ConvexJSON(draft.media),
                    "links": ConvexJSON(draft.links),
                    "accent": draft.accent,
                    "accentHue": draft.accentHue,
                    "featured": draft.featured,
                    "sortOrder": draft.sortOrder,
                ]
                // The hourly collector owns this derived block. Omit an
                // untouched snapshot so an editor left open cannot overwrite
                // fresh metrics; an explicit edit remains a supported override,
                // including clearing the block with null.
                if includeBuildStats {
                    let encoded: ConvexEncodable? = draft.aiBuildStats.map {
                        ConvexJSON($0)
                    }
                    args.updateValue(encoded, forKey: "aiBuildStats")
                }
                return try await self.call("projects:update", args: args)
            } else {
                var args: [String: ConvexEncodable?] = [
                    "slug": draft.slug,
                    "title": draft.title,
                    "client": draft.client,
                    "attribution": draft.attribution,
                    "role": draft.role,
                    "summary": draft.summary,
                    "stack": ConvexJSON(draft.stack),
                    "media": ConvexJSON(draft.media),
                    "links": ConvexJSON(draft.links),
                    "accent": draft.accent,
                    "accentHue": draft.accentHue,
                    "featured": draft.featured,
                    "sortOrder": draft.sortOrder,
                ]
                Self.addNonEmpty(draft.period, key: "period", to: &args)
                Self.addNonEmpty(draft.problem, key: "problem", to: &args)
                Self.addNonEmpty(draft.approach, key: "approach", to: &args)
                Self.addNonEmpty(draft.body, key: "body", to: &args)
                if !draft.outcomes.isEmpty { args["outcomes"] = ConvexJSON(draft.outcomes) }
                if let stats = draft.aiBuildStats {
                    args["aiBuildStats"] = ConvexJSON(stats)
                }
                return try await self.call("projects:create", args: args)
            }
        }
    }

    func publishProject(
        id: String,
        expectedRevision: Double? = nil
    ) async -> MutationResult {
        await mutate {
            var args: [String: ConvexEncodable?] = ["projectId": id]
            if let revision = expectedRevision
                ?? self.projects.first(where: { $0.id == id })?.revision {
                args["expectedRevision"] = revision
            }
            return try await self.call("projects:publish", args: args)
        }
    }

    func unpublishProject(
        id: String,
        expectedRevision: Double? = nil
    ) async -> MutationResult {
        await mutate {
            var args: [String: ConvexEncodable?] = ["projectId": id]
            if let revision = expectedRevision
                ?? self.projects.first(where: { $0.id == id })?.revision {
                args["expectedRevision"] = revision
            }
            return try await self.call("projects:unpublish", args: args)
        }
    }

    func deleteProject(id: String, expectedRevision: Double? = nil) async -> Bool {
        await mutateSucceeded {
            var args: [String: ConvexEncodable?] = ["projectId": id]
            if let revision = expectedRevision
                ?? self.projects.first(where: { $0.id == id })?.revision {
                args["expectedRevision"] = revision
            }
            return try await self.call("projects:remove", args: args)
        }
    }

    // MARK: - Labs

    func saveLab(_ draft: LabDraft) async -> MutationResult {
        await mutate {
            let fields: [String: ConvexEncodable?] = [
                "slug": draft.slug,
                "title": draft.title,
                "summary": draft.summary,
                "repoFullName": draft.repoFullName,
                "language": draft.language,
                "coverImage": ConvexJSON(draft.coverImage),
                "links": ConvexJSON(draft.links),
                "featured": draft.featured,
                "sortOrder": draft.sortOrder,
            ]

            if let labID = draft.recordID {
                var args = fields
                args["labId"] = labID
                args["expectedRevision"] = draft.baseRevision
                return try await self.call("labs:update", args: args)
            } else {
                return try await self.call("labs:create", args: fields)
            }
        }
    }

    func publishLab(
        id: String,
        expectedRevision: Double? = nil
    ) async -> MutationResult {
        await mutate {
            var args: [String: ConvexEncodable?] = ["labId": id]
            if let revision = expectedRevision
                ?? self.labs.first(where: { $0.id == id })?.revision {
                args["expectedRevision"] = revision
            }
            return try await self.call("labs:publish", args: args)
        }
    }

    func unpublishLab(
        id: String,
        expectedRevision: Double? = nil
    ) async -> MutationResult {
        await mutate {
            var args: [String: ConvexEncodable?] = ["labId": id]
            if let revision = expectedRevision
                ?? self.labs.first(where: { $0.id == id })?.revision {
                args["expectedRevision"] = revision
            }
            return try await self.call("labs:unpublish", args: args)
        }
    }

    func deleteLab(id: String, expectedRevision: Double? = nil) async -> Bool {
        await mutateSucceeded {
            var args: [String: ConvexEncodable?] = ["labId": id]
            if let revision = expectedRevision
                ?? self.labs.first(where: { $0.id == id })?.revision {
                args["expectedRevision"] = revision
            }
            return try await self.call("labs:remove", args: args)
        }
    }

    // MARK: - Posts

    func savePost(_ draft: PostDraft) async -> MutationResult {
        await mutate {
            let fields: [String: ConvexEncodable?] = [
                "slug": draft.slug,
                "title": draft.title,
                "excerpt": draft.excerpt,
                "body": draft.body,
                "coverImage": ConvexJSON(draft.coverImage),
                "tags": ConvexJSON(draft.tags),
            ]

            if let postID = draft.recordID {
                var args = fields
                args["postId"] = postID
                args["expectedRevision"] = draft.baseRevision
                return try await self.call("posts:update", args: args)
            } else {
                return try await self.call("posts:create", args: fields)
            }
        }
    }

    func publishPost(
        id: String,
        expectedRevision: Double? = nil
    ) async -> MutationResult {
        await mutate {
            var args: [String: ConvexEncodable?] = ["postId": id]
            if let revision = expectedRevision
                ?? self.posts.first(where: { $0.id == id })?.revision {
                args["expectedRevision"] = revision
            }
            return try await self.call("posts:publish", args: args)
        }
    }

    func unpublishPost(
        id: String,
        expectedRevision: Double? = nil
    ) async -> MutationResult {
        await mutate {
            var args: [String: ConvexEncodable?] = ["postId": id]
            if let revision = expectedRevision
                ?? self.posts.first(where: { $0.id == id })?.revision {
                args["expectedRevision"] = revision
            }
            return try await self.call("posts:unpublish", args: args)
        }
    }

    func deletePost(id: String, expectedRevision: Double? = nil) async -> Bool {
        await mutateSucceeded {
            var args: [String: ConvexEncodable?] = ["postId": id]
            if let revision = expectedRevision
                ?? self.posts.first(where: { $0.id == id })?.revision {
                args["expectedRevision"] = revision
            }
            return try await self.call("posts:remove", args: args)
        }
    }

    // MARK: - Fun entries

    func saveFunEntry(_ draft: FunEntryDraft) async -> MutationResult {
        await mutate {
            let occurredAt = BackendTimestamp.string(from: draft.occurredAt)
            var fields: [String: ConvexEncodable?] = [
                "type": draft.type.rawValue,
                "title": draft.title,
                "photo": ConvexJSON(draft.photo),
                "occurredAt": occurredAt,
                "note": Self.nullableString(draft.note),
                // Walks do not carry a rating. Sending an explicit null on
                // update also clears a stale value left after changing type.
                "rating": draft.type == .walk ? nil : draft.rating,
                "steps": draft.type == .walk ? draft.steps : nil,
                "km": draft.type == .walk ? draft.km : nil,
                "location": draft.location.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    ? nil
                    : ConvexJSON(draft.location),
            ]

            if let entryID = draft.recordID {
                fields["entryId"] = entryID
                fields["expectedRevision"] = draft.baseRevision
                return try await self.call("funEntries:update", args: fields)
            } else {
                // Create validators use optional fields rather than nullable
                // ones, so remove the explicit nulls used by update clearing.
                fields = fields.filter { $0.value != nil }
                return try await self.call("funEntries:create", args: fields)
            }
        }
    }

    func deleteFunEntry(_ id: String, expectedRevision: Double? = nil) async -> Bool {
        await mutateSucceeded {
            var args: [String: ConvexEncodable?] = ["entryId": id]
            if let revision = expectedRevision
                ?? self.funEntries.first(where: { $0.id == id })?.revision {
                args["expectedRevision"] = revision
            }
            return try await self.call("funEntries:remove", args: args)
        }
    }

    // MARK: - Experience and resume

    func saveExperience(_ draft: ExperienceDraft) async -> MutationResult {
        await mutate {
            var fields: [String: ConvexEncodable?] = [
                "company": draft.company,
                "title": draft.title,
                "startDate": draft.startDate,
                "endDate": Self.nullableString(draft.endDate),
                "summary": draft.summary,
                "highlights": ConvexJSON(draft.highlights),
                "skills": ConvexJSON(draft.skills),
                "projectSlugs": ConvexJSON(draft.projectSlugs),
            ]

            if let entryID = draft.recordID {
                fields["entryId"] = entryID
                fields["expectedRevision"] = draft.baseRevision
                return try await self.call("experienceEntries:update", args: fields)
            } else {
                fields["sortOrder"] = draft.sortOrder
                return try await self.call("experienceEntries:create", args: fields)
            }
        }
    }

    func deleteExperience(_ id: String, expectedRevision: Double? = nil) async -> Bool {
        await mutateSucceeded {
            var args: [String: ConvexEncodable?] = ["entryId": id]
            if let revision = expectedRevision
                ?? self.experienceEntries.first(where: { $0.id == id })?.revision {
                args["expectedRevision"] = revision
            }
            return try await self.call("experienceEntries:remove", args: args)
        }
    }

    func moveExperience(
        _ id: String,
        to sortOrder: Double,
        expectedRevision: Double? = nil
    ) async -> MutationResult {
        await mutate {
            var args: [String: ConvexEncodable?] = [
                "entryId": id,
                "sortOrder": sortOrder,
            ]
            if let revision = expectedRevision
                ?? self.experienceEntries.first(where: { $0.id == id })?.revision {
                args["expectedRevision"] = revision
            }
            return try await self.call(
                "experienceEntries:setSortOrder",
                args: args
            )
        }
    }

    func swapExperience(
        _ firstID: String,
        _ secondID: String,
        firstExpectedRevision: Double? = nil,
        secondExpectedRevision: Double? = nil
    ) async -> MutationResult {
        await mutate {
            var args: [String: ConvexEncodable?] = [
                "firstEntryId": firstID,
                "secondEntryId": secondID,
            ]
            if let revision = firstExpectedRevision
                ?? self.experienceEntries.first(where: { $0.id == firstID })?.revision {
                args["firstExpectedRevision"] = revision
            }
            if let revision = secondExpectedRevision
                ?? self.experienceEntries.first(where: { $0.id == secondID })?.revision {
                args["secondExpectedRevision"] = revision
            }
            return try await self.call("experienceEntries:swapSortOrder", args: args)
        }
    }

    func saveResume(_ draft: ResumeDraft) async -> MutationResult {
        await mutate {
            return try await self.call("resume:upsert", args: [
                "expectedRevision": draft.baseRevision,
                "summary": draft.summary,
                "capabilities": ConvexJSON(draft.capabilities),
                "education": ConvexJSON(draft.education),
                "embedGitStats": draft.embedGitStats,
            ])
        }
    }

    func syncResume(expectedRevision: Double? = nil) async -> MutationResult {
        await mutate(requireTopLevelSync: true) {
            var args: [String: ConvexEncodable?] = [:]
            if let revision = expectedRevision ?? self.resumeDocument?.revision {
                args["expectedRevision"] = revision
            }
            return try await self.call("resume:syncFromEntries", args: args)
        }
    }

    func deleteResume(expectedRevision: Double? = nil) async -> Bool {
        await mutateSucceeded {
            var args: [String: ConvexEncodable?] = [:]
            if let revision = expectedRevision ?? self.resumeDocument?.revision {
                args["expectedRevision"] = revision
            }
            return try await self.call("resume:remove", args: args)
        }
    }

    // MARK: - Site settings

    func saveSiteSettings(_ draft: SiteSettingsDraft) async -> MutationResult {
        await mutate {
            return try await self.call("siteSettings:upsert", args: [
                "expectedRevision": draft.baseRevision,
                "headline": draft.headline,
                "identity": ConvexJSON(draft.identity),
                "featured": ConvexJSON(draft.featured),
                "nav": ConvexJSON(draft.nav),
            ])
        }
    }

    func setAvailability(
        _ availability: String,
        expectedRevision: Double
    ) async -> MutationResult {
        await mutate {
            return try await self.call(
                "siteSettings:setAvailability",
                args: [
                    "availability": availability,
                    "expectedRevision": expectedRevision,
                ]
            )
        }
    }

    func deleteSiteSettings(expectedRevision: Double? = nil) async -> Bool {
        await mutateSucceeded {
            var args: [String: ConvexEncodable?] = [:]
            if let revision = expectedRevision ?? self.siteSettings?.revision {
                args["expectedRevision"] = revision
            }
            return try await self.call("siteSettings:remove", args: args)
        }
    }

    // MARK: - Inbox

    func setContactStatus(_ messageID: String, status: ContactStatus) async -> Bool {
        await mutateSucceeded {
            return try await self.call("contactMessages:setStatus", args: [
                "messageId": messageID,
                "status": status.rawValue,
            ])
        }
    }

    func deleteContactMessage(_ messageID: String) async -> Bool {
        await mutateSucceeded {
            return try await self.call(
                "contactMessages:remove",
                args: ["messageId": messageID]
            )
        }
    }

    // MARK: - Ingest tokens

    func issueToken(name: String, scopes: [IngestScope]) async -> IssuedToken? {
        guard let client else {
            report(HomeAppModelError.backendUnavailable)
            return nil
        }

        beginBusyOperation()
        lastErrorMessage = nil
        defer { endBusyOperation() }

        do {
            let issued: IssuedToken = try await client.mutation("ingestTokens:issue", with: [
                "name": name,
                "scopes": ConvexJSON(scopes),
            ])
            return issued
        } catch {
            report(error)
            return nil
        }
    }

    func revokeToken(_ tokenID: String) async -> Bool {
        await mutateSucceeded {
            return try await self.call("ingestTokens:revoke", args: ["tokenId": tokenID])
        }
    }

    // MARK: - Media uploads

    func uploadImage(
        data: Data,
        fileName: String,
        contentType: String,
        alt: String
    ) async -> MediaAsset? {
        beginBusyOperation()
        lastErrorMessage = nil
        defer { endBusyOperation() }

        do {
            let upload = try await NativeUploadService.upload(
                data: data,
                fileName: fileName,
                contentType: contentType
            )
            return MediaAsset(
                kind: .image,
                url: upload.url,
                alt: alt,
                width: upload.width,
                height: upload.height,
                storageKey: upload.storageKey
            )
        } catch {
            report(error)
            return nil
        }
    }

    // MARK: - Mutation plumbing

    private func call(
        _ name: String,
        args: sending [String: ConvexEncodable?]
    ) async throws -> MutationReceipt {
        guard let client else { throw HomeAppModelError.backendUnavailable }
        return try await client.mutation(name, with: args)
    }

    private func mutate(
        requireTopLevelSync: Bool = false,
        _ operation: () async throws -> MutationReceipt
    ) async -> MutationResult {
        beginBusyOperation()
        lastErrorMessage = nil
        defer { endBusyOperation() }

        do {
            let receipt = try await operation()
            if requireTopLevelSync, receipt.synced == false {
                let message = "Save the résumé document before rebuilding its work history."
                lastErrorMessage = message
                return .failure(message)
            }
            return .success(receipt.outcome)
        } catch {
            let message = BackendErrorMessage.message(for: error)
            lastErrorMessage = message
            return .failure(message)
        }
    }

    private func mutateSucceeded(
        requireTopLevelSync: Bool = false,
        _ operation: () async throws -> MutationReceipt
    ) async -> Bool {
        let result = await mutate(
            requireTopLevelSync: requireTopLevelSync,
            operation
        )
        return result.succeeded
    }

    private func beginBusyOperation() {
        busyOperationCount += 1
        isBusy = true
    }

    private func endBusyOperation() {
        busyOperationCount = max(0, busyOperationCount - 1)
        isBusy = busyOperationCount > 0
    }

    private func report(_ error: Error) {
        lastErrorMessage = BackendErrorMessage.message(for: error)
    }

    private func updateProfileHydration() {
        hasLoadedProfile = loadedExperience && loadedResume && loadedSiteSettings
    }

    private func resetProfileHydration() {
        loadedExperience = false
        loadedResume = false
        loadedSiteSettings = false
        hasLoadedProfile = false
    }

    /// Drop every value obtained under the previous Clerk identity before any
    /// new account's subscriptions are allowed to render.
    func clearSessionData() {
        projects = []
        labs = []
        posts = []
        funEntries = []
        experienceEntries = []
        resumeDocument = nil
        siteSettings = nil
        contactMessages = []
        ingestTokens = []
        currentSessionID = nil
        lastErrorMessage = nil
        staleSubscriptionKeys.removeAll()
        subscriptionsAreStale = false
        resetProfileHydration()
    }

    private static func nullableString(_ value: String) -> ConvexEncodable? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func addNonEmpty(
        _ value: String,
        key: String,
        to args: inout [String: ConvexEncodable?]
    ) {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { args[key] = trimmed }
    }

    // MARK: - Preview fixtures

    private func installPreviewData() {
        siteSettings = SiteSettingsRecord(
            id: "preview-settings",
            creationTime: 0,
            revision: nil,
            headline: "I build products, platforms and the teams behind them.",
            availability: "Open to product-minded engineering leadership roles",
            identity: SiteIdentity(
                company: "Independent",
                availability: "Open to product-minded engineering leadership roles"
            ),
            featured: FeaturedSelections(),
            nav: NavVisibility(),
            updatedAt: "2026-07-31T00:00:00Z"
        )
        loadedExperience = true
        loadedResume = true
        loadedSiteSettings = true
        hasLoadedProfile = true
    }
}

private nonisolated extension HomeAppModel.SessionState {
    var isSignedIn: Bool {
        if case .signedIn = self { return true }
        return false
    }
}

nonisolated enum HomeAppModelError: LocalizedError, Sendable {
    case backendUnavailable

    var errorDescription: String? {
        "The app is not connected to a configured Convex deployment."
    }
}
