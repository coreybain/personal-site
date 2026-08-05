//
//  Models.swift
//  Home
//
//  Codable mirrors of the Convex documents the pocket admin can read and edit.
//  Convex owns `_id` and `_creationTime`; editable drafts use a separate UUID so
//  list and form identity never depends on an array index.
//

import Foundation
import ConvexMobile

// MARK: - Shared values

nonisolated enum MediaKind: String, Codable, CaseIterable, Hashable, Sendable {
    case image
    case video
}

nonisolated struct MediaAsset: Codable, Hashable, Identifiable, Sendable {
    var id: UUID
    var kind: MediaKind
    var url: String
    var alt: String
    var width: Double?
    var height: Double?
    var caption: String?
    var storageKey: String?
    var sanitised: Bool?

    init(
        id: UUID = UUID(),
        kind: MediaKind = .image,
        url: String = "",
        alt: String = "",
        width: Double? = nil,
        height: Double? = nil,
        caption: String? = nil,
        storageKey: String? = nil,
        sanitised: Bool? = nil
    ) {
        self.id = id
        self.kind = kind
        self.url = url
        self.alt = alt
        self.width = width
        self.height = height
        self.caption = caption
        self.storageKey = storageKey
        self.sanitised = sanitised
    }

    private enum CodingKeys: String, CodingKey {
        case kind, url, alt, width, height, caption, storageKey, sanitised
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = UUID()
        kind = try values.decode(MediaKind.self, forKey: .kind)
        url = try values.decode(String.self, forKey: .url)
        alt = try values.decode(String.self, forKey: .alt)
        width = try values.decodeIfPresent(Double.self, forKey: .width)
        height = try values.decodeIfPresent(Double.self, forKey: .height)
        caption = try values.decodeIfPresent(String.self, forKey: .caption)
        storageKey = try values.decodeIfPresent(String.self, forKey: .storageKey)
        sanitised = try values.decodeIfPresent(Bool.self, forKey: .sanitised)
    }

    /// `id` exists only to keep SwiftUI editors stable. It is deliberately not
    /// part of the persisted value contract, so two independent decodes of the
    /// same backend media must still compare equal for conflict detection.
    static func == (lhs: MediaAsset, rhs: MediaAsset) -> Bool {
        lhs.kind == rhs.kind
            && lhs.url == rhs.url
            && lhs.alt == rhs.alt
            && lhs.width == rhs.width
            && lhs.height == rhs.height
            && lhs.caption == rhs.caption
            && lhs.storageKey == rhs.storageKey
            && lhs.sanitised == rhs.sanitised
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(kind)
        hasher.combine(url)
        hasher.combine(alt)
        hasher.combine(width)
        hasher.combine(height)
        hasher.combine(caption)
        hasher.combine(storageKey)
        hasher.combine(sanitised)
    }
}

nonisolated enum PublicationStatus: String, Hashable, Sendable {
    case draft
    case published
}

nonisolated struct ProjectLinks: Codable, Hashable, Sendable {
    var live: String?
    var press: String?

    init(live: String? = nil, press: String? = nil) {
        self.live = live
        self.press = press
    }
}

nonisolated struct AiBuildStats: Codable, Hashable, Sendable {
    var sessions: Double
    var hours: Double

    init(sessions: Double = 0, hours: Double = 0) {
        self.sessions = sessions
        self.hours = hours
    }
}

// MARK: - Projects

nonisolated struct ProjectRecord: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let creationTime: Double
    var revision: Double?
    var published: Bool
    var featured: Bool
    var sortOrder: Double
    var slug: String
    var title: String
    var client: String
    var attribution: String
    var role: String
    var period: String?
    var summary: String
    var problem: String?
    var approach: String?
    var outcomes: [String]?
    var body: String?
    var stack: [String]
    var media: [MediaAsset]
    var links: ProjectLinks
    var accent: String
    var accentHue: Double
    var aiBuildStats: AiBuildStats?

    var status: PublicationStatus { published ? .published : .draft }

    private enum CodingKeys: String, CodingKey {
        case id = "_id"
        case creationTime = "_creationTime"
        case revision, published, featured, sortOrder, slug, title, client, attribution
        case role, period, summary, problem, approach, outcomes, body, stack
        case media, links, accent, accentHue, aiBuildStats
    }
}

nonisolated struct ProjectDraft: Identifiable, Hashable, Sendable {
    var id = UUID().uuidString
    var recordID: String?
    var baseRevision: Double = 0
    var slug = ""
    var title = ""
    var client = ""
    var attribution = ""
    var role = ""
    var period = ""
    var summary = ""
    var problem = ""
    var approach = ""
    var outcomes: [String] = []
    var body = ""
    var stack: [String] = []
    var media: [MediaAsset] = []
    var links = ProjectLinks()
    var accent = "hsl(256 76% 52%)"
    var accentHue: Double = 256
    var aiBuildStats: AiBuildStats?
    var featured = false
    var sortOrder: Double = 0

    init() {}

    init(record: ProjectRecord) {
        id = record.id
        recordID = record.id
        baseRevision = record.revision ?? 0
        slug = record.slug
        title = record.title
        client = record.client
        attribution = record.attribution
        role = record.role
        period = record.period ?? ""
        summary = record.summary
        problem = record.problem ?? ""
        approach = record.approach ?? ""
        outcomes = record.outcomes ?? []
        body = record.body ?? ""
        stack = record.stack
        media = record.media
        links = record.links
        accent = record.accent
        accentHue = record.accentHue
        aiBuildStats = record.aiBuildStats
        featured = record.featured
        sortOrder = record.sortOrder
    }

    /// Collector-owned AI totals can refresh while an editorial form is open.
    /// They are excluded only for classifying subscription echoes; an explicit
    /// local stats edit is still tracked separately by the editor and submitted.
    func hasSameEditorialContent(as other: ProjectDraft) -> Bool {
        var left = self
        var right = other
        left.aiBuildStats = nil
        right.aiBuildStats = nil
        return left == right
    }
}

// MARK: - Labs

nonisolated struct LabLinks: Codable, Hashable, Sendable {
    var repo: String
    var live: String?
    var docs: String?

    init(repo: String = "", live: String? = nil, docs: String? = nil) {
        self.repo = repo
        self.live = live
        self.docs = docs
    }
}

nonisolated struct LabLiveStats: Codable, Hashable, Sendable {
    var stars: Double
    var forks: Double
    var commitsYear: Double
    var lastPushDaysAgo: Double
    var lastPushedAt: String?
    var syncedAt: String?

    init(
        stars: Double = 0,
        forks: Double = 0,
        commitsYear: Double = 0,
        lastPushDaysAgo: Double = 0,
        lastPushedAt: String? = nil,
        syncedAt: String? = nil
    ) {
        self.stars = stars
        self.forks = forks
        self.commitsYear = commitsYear
        self.lastPushDaysAgo = lastPushDaysAgo
        self.lastPushedAt = lastPushedAt
        self.syncedAt = syncedAt
    }
}

nonisolated struct LabRecord: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let creationTime: Double
    var revision: Double?
    var published: Bool
    var featured: Bool
    var sortOrder: Double
    var slug: String
    var title: String
    var summary: String
    var repoFullName: String
    var language: String
    var coverImage: MediaAsset
    var links: LabLinks
    var liveStats: LabLiveStats

    var status: PublicationStatus { published ? .published : .draft }

    private enum CodingKeys: String, CodingKey {
        case id = "_id"
        case creationTime = "_creationTime"
        case revision, published, featured, sortOrder, slug, title, summary, repoFullName
        case language, coverImage, links, liveStats
    }
}

nonisolated struct LabDraft: Identifiable, Hashable, Sendable {
    var id = UUID().uuidString
    var recordID: String?
    var baseRevision: Double = 0
    var slug = ""
    var title = ""
    var summary = ""
    var repoFullName = ""
    var language = ""
    var coverImage = MediaAsset()
    var links = LabLinks()
    var liveStats = LabLiveStats()
    var featured = false
    var sortOrder: Double = 0

    init() {}

    init(record: LabRecord) {
        id = record.id
        recordID = record.id
        baseRevision = record.revision ?? 0
        slug = record.slug
        title = record.title
        summary = record.summary
        repoFullName = record.repoFullName
        language = record.language
        coverImage = record.coverImage
        links = record.links
        liveStats = record.liveStats
        featured = record.featured
        sortOrder = record.sortOrder
    }

    /// GitHub owns live stats, so a collector refresh is not an external edit
    /// to the human-authored draft and must not block Save.
    func hasSameEditorialContent(as other: LabDraft) -> Bool {
        var left = self
        var right = other
        left.liveStats = LabLiveStats()
        right.liveStats = LabLiveStats()
        return left == right
    }
}

// MARK: - Posts

nonisolated struct PostRecord: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let creationTime: Double
    var revision: Double?
    var slug: String
    var title: String
    var excerpt: String
    var body: String
    var coverImage: MediaAsset
    var tags: [String]
    var publishedAt: String?
    var published: Bool

    var status: PublicationStatus { published ? .published : .draft }

    private enum CodingKeys: String, CodingKey {
        case id = "_id"
        case creationTime = "_creationTime"
        case revision, slug, title, excerpt, body, coverImage, tags, publishedAt, published
    }
}

nonisolated struct PostDraft: Identifiable, Hashable, Sendable {
    var id = UUID().uuidString
    var recordID: String?
    var baseRevision: Double = 0
    var slug = ""
    var title = ""
    var excerpt = ""
    var body = ""
    var coverImage = MediaAsset()
    var tags: [String] = []

    init() {}

    init(record: PostRecord) {
        id = record.id
        recordID = record.id
        baseRevision = record.revision ?? 0
        slug = record.slug
        title = record.title
        excerpt = record.excerpt
        body = record.body
        coverImage = record.coverImage
        tags = record.tags
    }
}

// MARK: - Fun entries

nonisolated enum FunKind: String, Codable, CaseIterable, Hashable, Sendable, Identifiable {
    case beer
    case coffee
    case walk
    case pub

    var id: String { rawValue }
    var label: String { rawValue.capitalized }

    var symbol: String {
        switch self {
        case .beer: "mug"
        case .coffee: "cup.and.saucer"
        case .walk: "figure.walk"
        case .pub: "wineglass"
        }
    }
}

nonisolated struct FunLocation: Codable, Hashable, Sendable {
    var name: String
    var suburb: String?
    var latitude: Double?
    var longitude: Double?

    init(
        name: String = "",
        suburb: String? = nil,
        latitude: Double? = nil,
        longitude: Double? = nil
    ) {
        self.name = name
        self.suburb = suburb
        self.latitude = latitude
        self.longitude = longitude
    }
}

nonisolated struct FunEntryRecord: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let creationTime: Double
    var revision: Double?
    var type: FunKind
    var title: String
    var photo: MediaAsset
    var note: String?
    var rating: Double?
    var location: FunLocation?
    var steps: Double?
    var km: Double?
    var occurredAt: String

    private enum CodingKeys: String, CodingKey {
        case id = "_id"
        case creationTime = "_creationTime"
        case revision, type, title, photo, note, rating, location, steps, km, occurredAt
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        creationTime = try values.decode(Double.self, forKey: .creationTime)
        revision = try values.decodeIfPresent(Double.self, forKey: .revision)
        type = try values.decode(FunKind.self, forKey: .type)
        title = try values.decode(String.self, forKey: .title)
        photo = try values.decode(MediaAsset.self, forKey: .photo)
        note = try values.decodeIfPresent(String.self, forKey: .note)
        rating = try values.decodeIfPresent(Double.self, forKey: .rating)
        location = try values.decodeIfPresent(FunLocation.self, forKey: .location)
        steps = try values.decodeIfPresent(Double.self, forKey: .steps)
        km = try values.decodeIfPresent(Double.self, forKey: .km)
        occurredAt = try values.decode(String.self, forKey: .occurredAt)
        guard BackendDate.parse(occurredAt) != nil else {
            throw DecodingError.dataCorruptedError(
                forKey: .occurredAt,
                in: values,
                debugDescription: "Expected an RFC 3339 instant with optional milliseconds."
            )
        }
    }
}

nonisolated struct FunEntryDraft: Identifiable, Hashable, Sendable {
    var id = UUID().uuidString
    var recordID: String?
    var baseRevision: Double = 0
    var type: FunKind = .coffee
    var title = ""
    var photo = MediaAsset()
    var note = ""
    var rating: Double?
    var location = FunLocation()
    var steps: Double?
    var km: Double?
    var occurredAt = Date()

    init() {}

    init(record: FunEntryRecord) {
        guard let parsedOccurredAt = BackendDate.parse(record.occurredAt) else {
            preconditionFailure("FunEntryRecord guarantees a valid occurredAt value while decoding.")
        }
        id = record.id
        recordID = record.id
        baseRevision = record.revision ?? 0
        type = record.type
        title = record.title
        photo = record.photo
        note = record.note ?? ""
        rating = record.rating
        location = record.location ?? FunLocation()
        steps = record.steps
        km = record.km
        occurredAt = parsedOccurredAt
    }
}

// MARK: - Resume and experience

nonisolated struct ResumeRole: Codable, Hashable, Identifiable, Sendable {
    var company: String
    var title: String
    var start: String
    var end: String
    var summary: String
    var highlights: [String]
    var skills: [String]?

    var id: String { "\(company)|\(title)|\(start)" }
}

nonisolated struct ResumeEducation: Codable, Hashable, Identifiable, Sendable {
    var id = UUID()
    var institution: String
    var credential: String
    var start: String
    var end: String

    init(
        id: UUID = UUID(),
        institution: String = "",
        credential: String = "",
        start: String = "",
        end: String = ""
    ) {
        self.id = id
        self.institution = institution
        self.credential = credential
        self.start = start
        self.end = end
    }

    private enum CodingKeys: String, CodingKey {
        case institution, credential, start, end
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = UUID()
        institution = try values.decode(String.self, forKey: .institution)
        credential = try values.decode(String.self, forKey: .credential)
        start = try values.decode(String.self, forKey: .start)
        end = try values.decode(String.self, forKey: .end)
    }

    static func == (lhs: ResumeEducation, rhs: ResumeEducation) -> Bool {
        lhs.institution == rhs.institution
            && lhs.credential == rhs.credential
            && lhs.start == rhs.start
            && lhs.end == rhs.end
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(institution)
        hasher.combine(credential)
        hasher.combine(start)
        hasher.combine(end)
    }
}

nonisolated struct ResumeRecord: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let creationTime: Double
    var revision: Double?
    var summary: String
    var experience: [ResumeRole]
    var capabilities: [String]
    var education: [ResumeEducation]
    var embedGitStats: Bool

    private enum CodingKeys: String, CodingKey {
        case id = "_id"
        case creationTime = "_creationTime"
        case revision, summary, experience, capabilities, education, embedGitStats
    }
}

nonisolated struct ResumeDraft: Hashable, Sendable {
    var baseRevision: Double = 0
    var summary = ""
    var capabilities: [String] = []
    var education: [ResumeEducation] = []
    var embedGitStats = true

    init() {}

    init(record: ResumeRecord) {
        baseRevision = record.revision ?? 0
        summary = record.summary
        capabilities = record.capabilities
        education = record.education
        embedGitStats = record.embedGitStats
    }
}

nonisolated struct ExperienceRecord: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let creationTime: Double
    var revision: Double?
    var company: String
    var title: String
    var startDate: String
    var endDate: String?
    var summary: String
    var highlights: [String]
    var skills: [String]
    var sortOrder: Double
    var projectSlugs: [String]?

    private enum CodingKeys: String, CodingKey {
        case id = "_id"
        case creationTime = "_creationTime"
        case revision, company, title, startDate, endDate, summary, highlights, skills
        case sortOrder, projectSlugs
    }
}

nonisolated struct ExperienceDraft: Identifiable, Hashable, Sendable {
    var id = UUID().uuidString
    var recordID: String?
    var baseRevision: Double = 0
    var company = ""
    var title = ""
    var startDate = ""
    var endDate = ""
    var summary = ""
    var highlights: [String] = []
    var skills: [String] = []
    var sortOrder: Double = 0
    var projectSlugs: [String] = []

    init() {}

    init(record: ExperienceRecord) {
        id = record.id
        recordID = record.id
        baseRevision = record.revision ?? 0
        company = record.company
        title = record.title
        startDate = record.startDate
        endDate = record.endDate ?? ""
        summary = record.summary
        highlights = record.highlights
        skills = record.skills
        sortOrder = record.sortOrder
        projectSlugs = record.projectSlugs ?? []
    }
}

// MARK: - Site settings

nonisolated struct SiteIdentity: Codable, Hashable, Sendable {
    var name: String
    var role: String
    var company: String
    var location: String
    var availability: String
    var github: String
    var linkedin: String
    var x: String?
    var email: String

    init(
        name: String = "Corey Baines",
        role: String = "Principal Engineer",
        company: String = "Corporate Interactive",
        location: String = "Sydney, Australia",
        availability: String = "Open to Principal Engineer roles",
        github: String = "coreybain",
        linkedin: String = "https://www.linkedin.com/in/coreybaines/",
        x: String? = "https://x.com/coreybaines",
        email: String = "corey@spiritdevs.com"
    ) {
        self.name = name
        self.role = role
        self.company = company
        self.location = location
        self.availability = availability
        self.github = github
        self.linkedin = linkedin
        self.x = x
        self.email = email
    }

    var businessCardIdentity: BusinessCardIdentity {
        businessCardIdentity(availabilityVisible: true)
    }

    func businessCardIdentity(availabilityVisible: Bool) -> BusinessCardIdentity {
        BusinessCardIdentity(
            name: name,
            role: role,
            company: company,
            location: location,
            availability: availability,
            availabilityVisible: availabilityVisible,
            github: github,
            linkedin: URL(string: linkedin) ?? BusinessCardIdentity.siteURL,
            x: x.flatMap(URL.init(string:)),
            email: email
        )
    }
}

nonisolated struct FeaturedSelections: Codable, Hashable, Sendable {
    var projectSlugs: [String]
    var labSlugs: [String]
    var postSlugs: [String]

    init(
        projectSlugs: [String] = [],
        labSlugs: [String] = [],
        postSlugs: [String] = []
    ) {
        self.projectSlugs = projectSlugs
        self.labSlugs = labSlugs
        self.postSlugs = postSlugs
    }
}

nonisolated struct NavVisibility: Codable, Hashable, Sendable {
    var work: Bool
    var labs: Bool
    var blog: Bool
    var fun: Bool
    var resume: Bool
    var ask: Bool
    var contact: Bool

    init(
        work: Bool = true,
        labs: Bool = true,
        blog: Bool = false,
        fun: Bool = true,
        resume: Bool = true,
        ask: Bool = true,
        contact: Bool = true
    ) {
        self.work = work
        self.labs = labs
        self.blog = blog
        self.fun = fun
        self.resume = resume
        self.ask = ask
        self.contact = contact
    }
}

nonisolated struct SiteSettingsRecord: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let creationTime: Double
    var revision: Double?
    var headline: String
    var availability: String
    var availabilityVisible: Bool?
    var identity: SiteIdentity
    var featured: FeaturedSelections
    var favoriteLabSlug: String?
    var nav: NavVisibility
    var updatedAt: String

    private enum CodingKeys: String, CodingKey {
        case id = "_id"
        case creationTime = "_creationTime"
        case revision, headline, availability, availabilityVisible, identity, featured
        case favoriteLabSlug, nav, updatedAt
    }
}

nonisolated struct SiteSettingsDraft: Hashable, Sendable {
    var baseRevision: Double = 0
    var headline = ""
    var availabilityVisible = true
    var identity = SiteIdentity()
    var featured = FeaturedSelections()
    var favoriteLabSlug: String?
    var nav = NavVisibility()

    init() {}

    init(record: SiteSettingsRecord) {
        baseRevision = record.revision ?? 0
        headline = record.headline
        availabilityVisible = record.availabilityVisible ?? true
        identity = record.identity
        featured = record.featured
        favoriteLabSlug = record.favoriteLabSlug
        nav = record.nav
    }
}

// MARK: - Inbox and machine tokens

nonisolated enum ContactStatus: String, Codable, CaseIterable, Hashable, Sendable, Identifiable {
    case new
    case read
    case replied
    case archived
    case spam

    var id: String { rawValue }
    var label: String { rawValue.capitalized }
}

nonisolated struct ContactMessage: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let creationTime: Double
    var name: String
    var email: String
    var company: String?
    var message: String
    var status: ContactStatus
    var createdAt: String

    private enum CodingKeys: String, CodingKey {
        case id = "_id"
        case creationTime = "_creationTime"
        case name, email, company, message, status, createdAt
    }
}

nonisolated enum IngestScope: String, Codable, CaseIterable, Hashable, Sendable, Identifiable {
    case aiUsageWrite = "ai-usage:write"
    case healthWrite = "health:write"
    case gitWrite = "git:write"

    var id: String { rawValue }
    var label: String {
        switch self {
        case .aiUsageWrite: "AI usage"
        case .healthWrite: "Health"
        case .gitWrite: "Git"
        }
    }
}

nonisolated struct IngestToken: Codable, Hashable, Identifiable, Sendable {
    let id: String
    var name: String
    var scopes: [IngestScope]
    var issuedAt: String
    var lastUsedAt: String?
    var revokedAt: String?

    private enum CodingKeys: String, CodingKey {
        case id = "_id"
        case name, scopes, issuedAt, lastUsedAt, revokedAt
    }
}

nonisolated struct IssuedToken: Codable, Hashable, Sendable {
    let tokenId: String
    let name: String
    let scopes: [IngestScope]
    let token: String
}

// MARK: - Small transport values

/// Encodes any ordinary Codable value using Convex's JSON argument format.
nonisolated struct ConvexJSON<Value: Encodable & Sendable>: ConvexMobile.ConvexEncodable, Sendable {
    let value: Value

    init(_ value: Value) {
        self.value = value
    }

    func convexEncode() throws -> String {
        String(decoding: try JSONEncoder().encode(value), as: UTF8.self)
    }
}

// MARK: - Transport results and diagnostics

/// Convex and the TypeScript contract use JavaScript's fixed-width
/// `Date.toISOString()` representation. Keeping the three millisecond digits is
/// important because the backend sorts these strings lexicographically.
nonisolated enum BackendTimestamp {
    static func string(from date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter.string(from: date)
    }
}

/// The truth returned by one successful mutation. A no-op is not an error (all
/// delete/publish contracts are idempotent), but it must not be flattened into
/// an indistinguishable `true`. Callers that need to rebase a draft use this
/// operation's authoritative backend revision directly.
nonisolated struct MutationOutcome: Equatable, Sendable {
    enum Effect: Equatable, Sendable {
        case applied
        case alreadySatisfied
        case projectionUnavailable
    }

    let effect: Effect
    let revision: Double?
    let firstRevision: Double?
    let secondRevision: Double?
    let resumeSynced: Bool?
}

/// The result of one specific mutation invocation. Keeping the receipt and
/// error on this value prevents concurrent editors from reading another
/// operation's revision or failure from shared observable state.
nonisolated struct MutationResult: Equatable, Sendable {
    let outcome: MutationOutcome?
    let errorMessage: String?

    var succeeded: Bool { outcome != nil }

    static func success(_ outcome: MutationOutcome) -> MutationResult {
        MutationResult(outcome: outcome, errorMessage: nil)
    }

    static func failure(_ message: String) -> MutationResult {
        MutationResult(outcome: nil, errorMessage: message)
    }
}

nonisolated enum SubscriptionRetryPolicy {
    static func delaySeconds(forAttempt attempt: Int) -> Double {
        let boundedAttempt = max(1, min(attempt, 6))
        return min(pow(2, Double(boundedAttempt - 1)), 30)
    }
}

/// Some singleton removals return a count while row removals return a boolean.
/// Decode both without weakening every other field in the mutation response.
private nonisolated enum MutationDeletion: Decodable, Sendable {
    case boolean(Bool)
    case count(Int)

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if let boolean = try? value.decode(Bool.self) {
            self = .boolean(boolean)
        } else {
            self = .count(try value.decode(Int.self))
        }
    }

    var removedSomething: Bool {
        switch self {
        case .boolean(let value): value
        case .count(let value): value > 0
        }
    }
}

/// A lossless projection of truth-bearing fields shared by the site's mutation
/// responses. Unknown navigation fields (ids, slugs, timestamps) are ignored by
/// `JSONDecoder`, while no-op/deletion/projection/revision information survives.
nonisolated struct MutationReceipt: Decodable, Sendable {
    private struct ResumeProjection: Decodable, Sendable {
        let synced: Bool
    }

    let revision: Double?
    let firstRevision: Double?
    let secondRevision: Double?
    let changed: Bool?
    private let deleted: MutationDeletion?
    let synced: Bool?
    let alreadyPublished: Bool?
    let alreadyUnpublished: Bool?
    let alreadyRevoked: Bool?
    let firstPublish: Bool?
    private let resume: ResumeProjection?

    private enum CodingKeys: String, CodingKey {
        case revision
        case firstRevision
        case secondRevision
        case changed
        case deleted
        case synced
        case alreadyPublished
        case alreadyUnpublished
        case alreadyRevoked
        case firstPublish
        case resume
    }

    var outcome: MutationOutcome {
        let effect: MutationOutcome.Effect
        if synced == false {
            effect = .projectionUnavailable
        } else if deleted?.removedSomething == false
            || changed == false
            || alreadyPublished == true
            || alreadyUnpublished == true
            || alreadyRevoked == true
        {
            effect = .alreadySatisfied
        } else {
            effect = .applied
        }

        return MutationOutcome(
            effect: effect,
            revision: revision,
            firstRevision: firstRevision,
            secondRevision: secondRevision,
            resumeSynced: resume?.synced
        )
    }
}

/// UniFFI's generated `ClientError.localizedDescription` reflects the enum
/// case, which exposes implementation syntax instead of the server's message.
/// Decode the structured `ConvexError.data` payload used by this backend and
/// fall back carefully for legacy string payloads.
nonisolated enum BackendErrorMessage {
    static func message(for error: Error) -> String {
        guard let clientError = error as? ClientError else {
            return error.localizedDescription
        }

        switch clientError {
        case .InternalError(let message), .ServerError(let message):
            return message
        case .ConvexError(let data):
            return convexMessage(from: data)
        }
    }

    private static func convexMessage(from value: String) -> String {
        guard let data = value.data(using: .utf8) else { return value }
        if let message = try? JSONDecoder().decode(String.self, from: data),
           !message.isEmpty {
            return message
        }

        if let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let message = object["message"] as? String,
           !message.isEmpty
        {
            return message
        }
        return value
    }
}
