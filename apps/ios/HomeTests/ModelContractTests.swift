import Foundation
import Testing
import ConvexMobile
@testable import Home

struct ModelContractTests {
    @Test func backendDateParsesJavaScriptMillisecondsAndWholeSeconds() throws {
        let milliseconds = try #require(BackendDate.parse("2026-07-31T10:00:00.000Z"))
        let wholeSeconds = try #require(BackendDate.parse("2026-07-31T10:00:00Z"))

        #expect(milliseconds == wholeSeconds)
    }

    @Test func transportTimestampsAlwaysIncludeUtcMilliseconds() {
        let value = BackendTimestamp.string(from: Date(timeIntervalSince1970: 0.123_456))

        #expect(value == "1970-01-01T00:00:00.123Z")
        #expect(value.count == 24)
    }

    @Test func malformedFunTimestampDoesNotBecomeTheUnixEpoch() throws {
        let json = #"""
        {
          "_id":"fun_1",
          "_creationTime":1,
          "type":"coffee",
          "title":"Coffee",
          "photo":{"kind":"image","url":"https://cdn.example/coffee.jpg","alt":"Coffee"},
          "occurredAt":"not-an-instant"
        }
        """#.data(using: .utf8)!
        #expect(throws: DecodingError.self) {
            _ = try JSONDecoder().decode(FunEntryRecord.self, from: json)
        }
    }

    @Test func convexErrorsExposeTheirStructuredMessage() {
        let structured = ClientError.ConvexError(
            data: #"{"code":"conflict","field":"revision","message":"This draft is stale."}"#
        )
        let legacy = ClientError.ConvexError(data: #""Legacy failure""#)

        #expect(BackendErrorMessage.message(for: structured) == "This draft is stale.")
        #expect(BackendErrorMessage.message(for: legacy) == "Legacy failure")
        #expect(
            BackendErrorMessage.message(for: ClientError.ServerError(msg: "Service unavailable"))
                == "Service unavailable"
        )
    }

    @Test func mutationReceiptsPreserveRevisionAndNoOpTruth() throws {
        let alreadyDeleted = try JSONDecoder().decode(
            MutationReceipt.self,
            from: #"{"deleted":false,"revision":7}"#.data(using: .utf8)!
        )
        let missingResume = try JSONDecoder().decode(
            MutationReceipt.self,
            from: #"{"synced":false,"revision":3}"#.data(using: .utf8)!
        )
        let singletonDelete = try JSONDecoder().decode(
            MutationReceipt.self,
            from: #"{"deleted":2,"revision":8}"#.data(using: .utf8)!
        )
        let nestedProjection = try JSONDecoder().decode(
            MutationReceipt.self,
            from: #"{"changed":true,"revision":9,"resume":{"synced":false,"roles":0}}"#
                .data(using: .utf8)!
        )

        #expect(alreadyDeleted.outcome.effect == .alreadySatisfied)
        #expect(alreadyDeleted.outcome.revision == 7)
        #expect(missingResume.outcome.effect == .projectionUnavailable)
        #expect(singletonDelete.outcome.effect == .applied)
        #expect(nestedProjection.outcome.effect == .applied)
        #expect(nestedProjection.outcome.resumeSynced == false)
        #expect(nestedProjection.outcome.revision == 9)
    }

    @Test func concurrentMutationResultsKeepTheirOwnRevisionsAndErrors() async {
        let first = MutationResult.success(
            MutationOutcome(
                effect: .applied,
                revision: 11,
                firstRevision: nil,
                secondRevision: nil,
                resumeSynced: nil
            )
        )
        let second = MutationResult.success(
            MutationOutcome(
                effect: .alreadySatisfied,
                revision: 42,
                firstRevision: nil,
                secondRevision: nil,
                resumeSynced: nil
            )
        )
        let failure = MutationResult.failure("A different operation failed.")

        async let delayedFirst = Self.echo(first, yields: 8)
        async let immediateSecond = Self.echo(second, yields: 0)
        async let delayedFailure = Self.echo(failure, yields: 3)
        let values = await (delayedFirst, immediateSecond, delayedFailure)

        #expect(values.0.outcome?.revision == 11)
        #expect(values.1.outcome?.revision == 42)
        #expect(values.2.errorMessage == "A different operation failed.")
        #expect(values.0.succeeded && values.1.succeeded)
        #expect(!values.2.succeeded)
    }

    @Test func subscriptionRetryUsesBoundedExponentialBackoff() {
        #expect(SubscriptionRetryPolicy.delaySeconds(forAttempt: 1) == 1)
        #expect(SubscriptionRetryPolicy.delaySeconds(forAttempt: 4) == 8)
        #expect(SubscriptionRetryPolicy.delaySeconds(forAttempt: 20) == 30)
    }

    @Test func clerkConnectionIntentPreservesAConcurrentForcedRefresh() {
        #expect(!ClerkConnectionMode.cached.skipCache)
        #expect(ClerkConnectionMode.forced.skipCache)

        var requests = ClerkConnectionCoalescer()
        let beganCached = requests.begin(.cached)
        let beganConcurrentForced = requests.begin(.forced)
        #expect(beganCached)
        #expect(!beganConcurrentForced)
        #expect(requests.finishAndTakeNext() == .forced)

        // Once the stronger request is running, cached/equal work is redundant.
        let beganWeaker = requests.begin(.cached)
        let beganDuplicate = requests.begin(.forced)
        #expect(!beganWeaker)
        #expect(!beganDuplicate)
        #expect(requests.finishAndTakeNext() == nil)
    }

    @Test func clerkRetryPolicyIsBounded() {
        #expect(ClerkRetryPolicy.permits(attempt: 1))
        #expect(ClerkRetryPolicy.permits(attempt: 5))
        #expect(!ClerkRetryPolicy.permits(attempt: 6))
        #expect(ClerkRetryPolicy.delaySeconds(forAttempt: 1) == 1)
        #expect(ClerkRetryPolicy.delaySeconds(forAttempt: 5) == 16)
        #expect(ClerkRetryPolicy.delaySeconds(forAttempt: 50) == 16)
    }

    @Test func onlyAnExplicitMissingClerkSessionSignsOut() {
        #expect(
            ClerkConnectionFailurePolicy.shouldSignOut(
                for: ClerkAuthProviderError.noSession
            )
        )
        #expect(
            !ClerkConnectionFailurePolicy.shouldSignOut(
                for: ClerkAuthProviderError.missingConvexToken
            )
        )
        #expect(
            !ClerkConnectionFailurePolicy.shouldSignOut(
                for: URLError(.notConnectedToInternet)
            )
        )
    }

    @Test func clerkSessionSwitchesReplaceThePriorIdentity() {
        #expect(
            ClerkSessionChangePolicy.action(
                oldSessionID: "session-a",
                newSessionID: "session-b",
                connectedSessionID: "session-a"
            ) == .replaceIdentity
        )
        #expect(
            ClerkSessionChangePolicy.action(
                oldSessionID: "session-a",
                newSessionID: "session-a",
                connectedSessionID: "session-a"
            ) == .refresh
        )
        #expect(
            ClerkSessionChangePolicy.action(
                oldSessionID: nil,
                newSessionID: "session-a",
                connectedSessionID: nil
            ) == .connect
        )
        #expect(
            ClerkSessionChangePolicy.action(
                oldSessionID: "session-a",
                newSessionID: nil,
                connectedSessionID: "session-a"
            ) == .signedOut
        )
    }

    @Test func signOutOnlyCompletesAfterClerkDropsItsSession() {
        #expect(!ClerkSignOutPolicy.completed(currentSessionID: "session-a"))
        #expect(ClerkSignOutPolicy.completed(currentSessionID: nil))
        #expect(
            ClerkAuthProviderError.signOutIncomplete.localizedDescription
                == "Clerk could not end the current session. Your signed-in data is still available."
        )
    }

    @Test func physicalUploadsRequireHttpsWhileSimulatorLoopbackMayUseHttp() throws {
        let https = try #require(URL(string: "https://coreybaines.com/api/native/upload"))
        let loopback = try #require(URL(string: "http://localhost:3000/api/native/upload"))
        let cleartextRemote = try #require(URL(string: "http://192.168.1.5:3000/api/native/upload"))

        #expect(NativeUploadService.endpointIsSecure(https, allowsLoopbackHTTP: false))
        #expect(!NativeUploadService.endpointIsSecure(loopback, allowsLoopbackHTTP: false))
        #expect(NativeUploadService.endpointIsSecure(loopback, allowsLoopbackHTTP: true))
        #expect(!NativeUploadService.endpointIsSecure(cleartextRemote, allowsLoopbackHTTP: true))
    }

    @Test func healthDayUsesTheUsersCalendarBucket() throws {
        let instant = try #require(BackendDate.parse("2026-07-31T15:30:00.000Z"))
        let sydney = try #require(TimeZone(identifier: "Australia/Sydney"))

        #expect(HealthCalendarDay.string(from: instant, timeZone: sydney) == "2026-08-01")
    }

    @Test func fractionalHealthKitStepsBecomeAnIntegerCount() {
        #expect(HealthMetricNormalizer.steps(12_345.6) == 12_346)
        #expect(HealthMetricNormalizer.steps(12_345.4) == 12_345)
    }

    @Test func collectorStatsDoNotMasqueradeAsEditorialChanges() {
        var project = ProjectDraft()
        project.title = "Project"
        project.aiBuildStats = AiBuildStats(sessions: 2, hours: 1)
        var refreshedProject = project
        refreshedProject.aiBuildStats = AiBuildStats(sessions: 3, hours: 2)
        #expect(refreshedProject.hasSameEditorialContent(as: project))
        refreshedProject.title = "Changed elsewhere"
        #expect(!refreshedProject.hasSameEditorialContent(as: project))

        var lab = LabDraft()
        lab.title = "Lab"
        lab.liveStats = LabLiveStats(stars: 2, forks: 1)
        var refreshedLab = lab
        refreshedLab.liveStats = LabLiveStats(stars: 3, forks: 1)
        #expect(refreshedLab.hasSameEditorialContent(as: lab))
        refreshedLab.title = "Changed elsewhere"
        #expect(!refreshedLab.hasSameEditorialContent(as: lab))
    }

    @Test func projectDocumentDecodesConvexSystemFields() throws {
        let json = #"""
        {
          "_id":"project_123",
          "_creationTime":1722384000000,
          "published":false,
          "featured":true,
          "sortOrder":2,
          "slug":"home-ios",
          "title":"Home iOS",
          "client":"Corey Baines",
          "attribution":"Independent",
          "role":"Principal Engineer",
          "summary":"Pocket administration.",
          "stack":["SwiftUI","Convex"],
          "media":[],
          "links":{},
          "accent":"hsl(256 76% 52%)",
          "accentHue":256
        }
        """#.data(using: .utf8)!

        let record = try JSONDecoder().decode(ProjectRecord.self, from: json)

        #expect(record.id == "project_123")
        #expect(record.creationTime == 1_722_384_000_000)
        #expect(record.status == .draft)
        #expect(record.stack == ["SwiftUI", "Convex"])
    }

    @Test func mediaEncodingNeverLeaksEditorIdentity() throws {
        let asset = MediaAsset(
            kind: .image,
            url: "https://cdn.example/image.jpg",
            alt: "A product screen",
            width: 1200,
            height: 800,
            storageKey: "asset-key",
            sanitised: true
        )

        let object = try #require(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(asset)) as? [String: Any]
        )

        #expect(object["id"] == nil)
        #expect(object["storageKey"] as? String == "asset-key")
        #expect(object["sanitised"] as? Bool == true)
    }

    @Test func equivalentDecodedMediaIgnoresEditorIdentity() throws {
        let json = #"{"kind":"image","url":"https://cdn.example/image.jpg","alt":"A product screen","width":1200,"height":800,"storageKey":"asset-key","sanitised":true}"#
            .data(using: .utf8)!
        let first = try JSONDecoder().decode(MediaAsset.self, from: json)
        let second = try JSONDecoder().decode(MediaAsset.self, from: json)

        #expect(first.id != second.id)
        #expect(first == second)
        #expect(Set([first, second]).count == 1)
    }

    @Test func recordBackedDraftsHaveStableIdentityAndEquality() throws {
        let project = try decode(
            ProjectRecord.self,
            #"{"_id":"project_1","_creationTime":1,"revision":2,"published":false,"featured":false,"sortOrder":1,"slug":"project","title":"Project","client":"Client","attribution":"Independent","role":"Lead","summary":"Summary","stack":[],"media":[{"kind":"image","url":"https://cdn.example/project.jpg","alt":"Project"}],"links":{},"accent":"violet","accentHue":256}"#
        )
        let lab = try decode(
            LabRecord.self,
            #"{"_id":"lab_1","_creationTime":1,"revision":2,"published":false,"featured":false,"sortOrder":1,"slug":"lab","title":"Lab","summary":"Summary","repoFullName":"owner/lab","language":"Swift","coverImage":{"kind":"image","url":"https://cdn.example/lab.jpg","alt":"Lab"},"links":{"repo":"https://github.com/owner/lab"},"liveStats":{"stars":1,"forks":2,"commitsYear":3,"lastPushDaysAgo":4}}"#
        )
        let post = try decode(
            PostRecord.self,
            #"{"_id":"post_1","_creationTime":1,"revision":2,"slug":"post","title":"Post","excerpt":"Excerpt","body":"Body","coverImage":{"kind":"image","url":"https://cdn.example/post.jpg","alt":"Post"},"tags":["Swift"],"published":false}"#
        )
        let funEntry = try decode(
            FunEntryRecord.self,
            #"{"_id":"fun_1","_creationTime":1,"revision":2,"type":"coffee","title":"Coffee","photo":{"kind":"image","url":"https://cdn.example/coffee.jpg","alt":"Coffee"},"occurredAt":"2026-07-31T10:00:00.000Z"}"#
        )
        let experience = try decode(
            ExperienceRecord.self,
            #"{"_id":"experience_1","_creationTime":1,"revision":2,"company":"Company","title":"Principal Engineer","startDate":"2024-01","summary":"Summary","highlights":["Shipped"],"skills":["Swift"],"sortOrder":1}"#
        )

        let projectDrafts = (ProjectDraft(record: project), ProjectDraft(record: project))
        let labDrafts = (LabDraft(record: lab), LabDraft(record: lab))
        let postDrafts = (PostDraft(record: post), PostDraft(record: post))
        let funDrafts = (FunEntryDraft(record: funEntry), FunEntryDraft(record: funEntry))
        let experienceDrafts = (
            ExperienceDraft(record: experience),
            ExperienceDraft(record: experience)
        )

        #expect(projectDrafts.0.id == project.id)
        #expect(projectDrafts.0 == projectDrafts.1)
        #expect(labDrafts.0.id == lab.id)
        #expect(labDrafts.0 == labDrafts.1)
        #expect(postDrafts.0.id == post.id)
        #expect(postDrafts.0 == postDrafts.1)
        #expect(funDrafts.0.id == funEntry.id)
        #expect(funDrafts.0 == funDrafts.1)
        #expect(experienceDrafts.0.id == experience.id)
        #expect(experienceDrafts.0 == experienceDrafts.1)
    }

    @Test func lineEditorReconciliationPreservesStableRowIdentity() {
        let first = EditableLine(text: "First")
        let second = EditableLine(text: "Second")

        let inserted = EditableLine.reconciling(
            [first, second],
            with: ["First", "Inserted", "Second"]
        )
        #expect(inserted[0].id == first.id)
        #expect(inserted[2].id == second.id)
        #expect(inserted[1].id != first.id && inserted[1].id != second.id)

        let edited = EditableLine.reconciling(inserted, with: ["Edited", "Inserted", "Second"])
        #expect(edited[0].id == first.id)
        #expect(edited[1].id == inserted[1].id)
        #expect(edited[2].id == second.id)
    }

    @Test func draftRoundTripKeepsEditableProjectFields() {
        let record = ProjectRecord(
            id: "project_1",
            creationTime: 1,
            revision: nil,
            published: true,
            featured: true,
            sortOrder: 4,
            slug: "quotecloud",
            title: "QuoteCloud",
            client: "Client",
            attribution: "Built at Studio",
            role: "Lead",
            period: "2024",
            summary: "Summary",
            problem: "Problem",
            approach: "Approach",
            outcomes: ["Faster"],
            body: "Body",
            stack: ["Swift"],
            media: [],
            links: ProjectLinks(live: "https://example.com"),
            accent: "violet",
            accentHue: 256,
            aiBuildStats: AiBuildStats(sessions: 3, hours: 12)
        )

        let draft = ProjectDraft(record: record)

        #expect(draft.recordID == record.id)
        #expect(draft.outcomes == ["Faster"])
        #expect(draft.aiBuildStats?.hours == 12)
        #expect(draft.featured)
    }

    @Test func lineCodecDropsBlankRowsButKeepsOrder() {
        let result = ProfileLineCodec.decode("First\n\n Second \nThird\n")
        #expect(result == ["First", "Second", "Third"])
        #expect(ProfileLineCodec.encode(result) == "First\nSecond\nThird")
    }

    @Test func lineCodecReconcilesAnExternalDraftReload() {
        #expect(
            ProfileLineCodec.reconcile("Old\nDraft\n", with: ["Latest", "Server"])
                == "Latest\nServer"
        )
        #expect(
            ProfileLineCodec.reconcile("Latest\nServer\n", with: ["Latest", "Server"])
                == "Latest\nServer\n"
        )
    }

    @Test func equivalentDecodedEducationRowsIgnoreEditorIdentity() throws {
        let json = #"{"institution":"UTS","credential":"BSc","start":"2001","end":"2004"}"#
            .data(using: .utf8)!
        let first = try JSONDecoder().decode(ResumeEducation.self, from: json)
        let second = try JSONDecoder().decode(ResumeEducation.self, from: json)

        #expect(first.id != second.id)
        #expect(first == second)
        #expect(Set([first, second]).count == 1)
    }

    @Test func tokenPresentationMovesDirectlyToOneTimeCredential() {
        var presentation = TokenPresentation.issue
        let token = IssuedToken(
            tokenId: "token_123",
            name: "HealthKit",
            scopes: [.healthWrite],
            token: "plaintext-once"
        )

        presentation = .issued(token)

        #expect(presentation.id == "issued-token_123")
    }

    @Test @MainActor func clearingSessionDropsIdentityScopedData() {
        let model = HomeAppModel.preview
        #expect(model.siteSettings != nil)
        #expect(model.hasLoadedProfile)

        model.clearSessionData()

        #expect(model.projects.isEmpty)
        #expect(model.contactMessages.isEmpty)
        #expect(model.ingestTokens.isEmpty)
        #expect(model.siteSettings == nil)
        #expect(model.resumeDocument == nil)
        #expect(!model.hasLoadedProfile)
    }

    private func decode<Value: Decodable>(_ type: Value.Type, _ json: String) throws -> Value {
        try JSONDecoder().decode(Value.self, from: Data(json.utf8))
    }

    private static func echo<Value: Sendable>(_ value: Value, yields: Int) async -> Value {
        for _ in 0..<yields {
            await Task.yield()
        }
        return value
    }

    @Test func healthIngestResponsesMatchTheConvexHTTPEnvelope() throws {
        let success = try JSONDecoder().decode(
            HealthIngestSuccess.self,
            from: #"{"ok":true,"token":"iPhone","daysCreated":1,"daysUpdated":0,"latestDay":"2026-07-31"}"#
                .data(using: .utf8)!
        )
        let failure = try JSONDecoder().decode(
            HealthIngestFailure.self,
            from: #"{"ok":false,"error":{"code":"forbidden","message":"Missing health:write scope."}}"#
                .data(using: .utf8)!
        )

        #expect(success.ok)
        #expect(success.latestDay == "2026-07-31")
        #expect(!failure.ok)
        #expect(failure.error.code == "forbidden")
        #expect(failure.error.message == "Missing health:write scope.")
    }
}
