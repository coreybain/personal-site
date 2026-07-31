//
//  HealthSyncService.swift
//  Home
//
//  Read-only HealthKit aggregation and scoped bearer-token ingest. Only daily
//  steps and walking/running distance leave the device.
//

import Foundation
import HealthKit
import Observation
import Security

nonisolated enum HealthTokenStore {
    private static let service = "com.coreybaines.home.health-ingest"
    private static let account = "health:write"

    private struct StoredCredential: Codable, Sendable {
        let token: String
        let tokenID: String?
    }

    static func read() -> String? {
        readCredential()?.token
    }

    static func tokenID() -> String? {
        readCredential()?.tokenID
    }

    private static func readCredential() -> StoredCredential? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data
        else { return nil }

        if let credential = try? JSONDecoder().decode(StoredCredential.self, from: data),
           !credential.token.isEmpty
        {
            return credential
        }

        // Versions before token rotation stored only the plaintext. Preserve
        // those installs and migrate to the structured value on the next save.
        guard let legacyToken = String(data: data, encoding: .utf8),
              !legacyToken.isEmpty
        else { return nil }
        return StoredCredential(token: legacyToken, tokenID: nil)
    }

    static func save(_ token: String, tokenID: String? = nil) throws {
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw HealthSyncError.missingToken }
        let data = try JSONEncoder().encode(
            StoredCredential(token: trimmed, tokenID: tokenID)
        )
        let identity: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]

        let status = SecItemUpdate(identity as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var item = identity
            attributes.forEach { item[$0.key] = $0.value }
            let addStatus = SecItemAdd(item as CFDictionary, nil)
            guard addStatus == errSecSuccess else {
                throw HealthSyncError.keychain(addStatus)
            }
        } else if status != errSecSuccess {
            throw HealthSyncError.keychain(status)
        }
    }

    static func remove() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw HealthSyncError.keychain(status)
        }
    }
}

nonisolated struct HealthDayPayload: Codable, Hashable, Sendable {
    let day: String
    let steps: Double
    let distanceKm: Double
}

nonisolated enum HealthMetricNormalizer {
    /// HealthKit represents quantities as floating point values even when the
    /// server contract is a count. Third-party writers can therefore produce a
    /// fractional total; normalise at the device edge before the ingest route's
    /// integer validator sees it.
    static func steps(_ value: Double) -> Double {
        value.rounded()
    }
}

/// HealthKit's daily totals are meaningful in the user's calendar day, not in
/// an arbitrary UTC bucket. The transport stores this timezone-free label; a
/// sync captures one timezone so travel cannot change it halfway through a
/// multi-day query.
nonisolated enum HealthCalendarDay {
    static func calendar(timeZone: TimeZone = .autoupdatingCurrent) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = Locale(identifier: "en_US_POSIX")
        calendar.timeZone = timeZone
        return calendar
    }

    static func string(from date: Date, timeZone: TimeZone = .autoupdatingCurrent) -> String {
        formatter(timeZone: timeZone).string(from: date)
    }

    static func date(from value: String, timeZone: TimeZone = .autoupdatingCurrent) -> Date? {
        formatter(timeZone: timeZone).date(from: value)
    }

    private static func formatter(timeZone: TimeZone) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.calendar = calendar(timeZone: timeZone)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }
}

nonisolated struct HealthIngestSuccess: Decodable, Sendable {
    let ok: Bool
    let latestDay: String
}

nonisolated struct HealthIngestFailure: Decodable, Sendable {
    struct Detail: Decodable, Sendable {
        let code: String
        let message: String
    }

    let ok: Bool
    let error: Detail
}

nonisolated enum HealthSyncError: LocalizedError, Sendable {
    case unavailable
    case missingType
    case missingToken
    case missingEndpoint
    case keychain(OSStatus)
    case invalidResponse
    case rejected(Int, String)

    var errorDescription: String? {
        switch self {
        case .unavailable:
            "Health data is not available on this device."
        case .missingType:
            "The required HealthKit quantity types are unavailable."
        case .missingToken:
            "Create or paste a health:write token before syncing."
        case .missingEndpoint:
            "The Convex HTTP endpoint is not configured."
        case .keychain(let status):
            "The health token could not be stored in Keychain (\(status))."
        case .invalidResponse:
            "The Health ingest endpoint returned an unreadable response."
        case .rejected(let status, let message):
            "Health sync was rejected (HTTP \(status)): \(message)"
        }
    }
}

@MainActor
@Observable
final class HealthSyncService {
    static let shared = HealthSyncService()

    private static let accessRequestedKey = "healthkit.access-requested"
    private static let lastSuccessfulDayKey = "healthkit.last-successful-day"
    private static let maximumBackfillDays = 31

    private(set) var latestDay: HealthDayPayload?
    private(set) var lastSyncedAt: Date?
    private(set) var isSyncing = false
    private(set) var errorMessage: String?
    private(set) var hasToken = HealthTokenStore.read() != nil
    private(set) var managedTokenID = HealthTokenStore.tokenID()
    private(set) var monitoringEnabled = false

    private let store = HKHealthStore()
    private var observerQueries: [HKObserverQuery] = []
    private var isStartingMonitoring = false
    private var syncRequestedWhileRunning = false
    private var syncWaiters: [CheckedContinuation<Void, Never>] = []

    private var stepType: HKQuantityType? {
        HKObjectType.quantityType(forIdentifier: .stepCount)
    }

    private var distanceType: HKQuantityType? {
        HKObjectType.quantityType(forIdentifier: .distanceWalkingRunning)
    }

    func requestAccessAndSync() async {
        guard HKHealthStore.isHealthDataAvailable() else {
            report(HealthSyncError.unavailable)
            return
        }
        guard let stepType, let distanceType else {
            report(HealthSyncError.missingType)
            return
        }

        do {
            try await store.requestAuthorization(toShare: [], read: [stepType, distanceType])
            UserDefaults.standard.set(true, forKey: Self.accessRequestedKey)
            await startBackgroundMonitoring()
            await syncToday()
        } catch {
            report(error)
        }
    }

    /// Safe at launch: this does not show the Health permission prompt. If the
    /// user granted access before, it restores observer/background delivery.
    func startBackgroundMonitoring() async {
        guard hasToken,
              UserDefaults.standard.bool(forKey: Self.accessRequestedKey),
              HKHealthStore.isHealthDataAvailable(),
              let stepType,
              let distanceType,
              !monitoringEnabled,
              !isStartingMonitoring
        else { return }

        isStartingMonitoring = true
        defer { isStartingMonitoring = false }

        do {
            try await store.enableBackgroundDelivery(for: stepType, frequency: .daily)
            try await store.enableBackgroundDelivery(for: distanceType, frequency: .daily)
            installObserver(for: stepType)
            installObserver(for: distanceType)
            monitoringEnabled = true
        } catch {
            stopObserverQueries()
            report(error)
        }
    }

    /// Replays any days missed while the app was suspended or offline. The
    /// local flag avoids querying and publishing zeroes before the user has
    /// ever answered the HealthKit permission prompt.
    func syncOnLaunchIfEligible() async {
        guard hasToken,
              UserDefaults.standard.bool(forKey: Self.accessRequestedKey)
        else { return }
        await syncToday()
    }

    func syncToday() async {
        if isSyncing {
            syncRequestedWhileRunning = true
            await withCheckedContinuation { continuation in
                syncWaiters.append(continuation)
            }
            return
        }

        isSyncing = true
        defer {
            isSyncing = false
            let waiters = syncWaiters
            syncWaiters.removeAll()
            waiters.forEach { $0.resume() }
        }

        repeat {
            syncRequestedWhileRunning = false
            errorMessage = nil

            do {
                guard let token = HealthTokenStore.read() else {
                    throw HealthSyncError.missingToken
                }
                let days = try await readPendingDays()
                if !days.isEmpty {
                    try await post(days: days, token: token)
                    latestDay = days.last
                    lastSyncedAt = Date()
                    if let latestDay {
                        UserDefaults.standard.set(
                            latestDay.day,
                            forKey: Self.lastSuccessfulDayKey
                        )
                    }
                }
            } catch {
                report(error)
            }
        } while syncRequestedWhileRunning
    }

    @discardableResult
    func saveToken(_ token: String, tokenID: String? = nil) -> Bool {
        do {
            try HealthTokenStore.save(token, tokenID: tokenID)
            hasToken = true
            managedTokenID = tokenID
            errorMessage = nil
            if UserDefaults.standard.bool(forKey: Self.accessRequestedKey) {
                Task { await startBackgroundMonitoring() }
            }
            return true
        } catch {
            report(error)
            return false
        }
    }

    func removeToken() {
        do {
            try HealthTokenStore.remove()
            hasToken = false
            managedTokenID = nil
            errorMessage = nil
            stopObserverQueries()
            Task {
                if let stepType {
                    try? await store.disableBackgroundDelivery(for: stepType)
                }
                if let distanceType {
                    try? await store.disableBackgroundDelivery(for: distanceType)
                }
            }
        } catch {
            report(error)
        }
    }

    private func readPendingDays() async throws -> [HealthDayPayload] {
        guard let stepType, let distanceType else { throw HealthSyncError.missingType }
        let timeZone = TimeZone.autoupdatingCurrent
        let calendar = HealthCalendarDay.calendar(timeZone: timeZone)
        let now = Date()
        let today = calendar.startOfDay(for: now)
        let earliest = calendar.date(
            byAdding: .day,
            value: -(Self.maximumBackfillDays - 1),
            to: today
        ) ?? today
        let firstLaunchFallback = calendar.date(byAdding: .day, value: -6, to: today) ?? today

        let storedStart = UserDefaults.standard
            .string(forKey: Self.lastSuccessfulDayKey)
            .flatMap { HealthCalendarDay.date(from: $0, timeZone: timeZone) }
            .map { calendar.startOfDay(for: $0) }
        // Re-read a rolling week so a Watch sync that revises an older day is
        // eventually reflected even though the latest-day cursor already moved
        // on. A timezone move can map the stored label into the local future;
        // fall back to the same bounded week instead of posting an empty batch.
        let rollingStart = storedStart.flatMap {
            calendar.date(byAdding: .day, value: -6, to: $0)
        }
        var cursor = max(rollingStart ?? firstLaunchFallback, earliest)
        if cursor > today {
            cursor = max(firstLaunchFallback, earliest)
        }
        var days: [HealthDayPayload] = []

        while cursor <= today {
            let dayStart = cursor
            let nextDay = calendar.date(byAdding: .day, value: 1, to: dayStart) ?? now
            let end = dayStart == today ? now : nextDay
            async let steps = cumulativeSum(
                type: stepType,
                unit: .count(),
                start: dayStart,
                end: end
            )
            async let metres = cumulativeSum(
                type: distanceType,
                unit: .meter(),
                start: dayStart,
                end: end
            )
            let (stepTotal, metreTotal) = try await (steps, metres)
            // A denied HealthKit read and a genuinely empty day both produce no
            // statistics. Do not turn that absence into authoritative zeroes
            // that overwrite an already-ingested day.
            guard stepTotal != nil || metreTotal != nil else {
                cursor = nextDay
                continue
            }
            days.append(
                HealthDayPayload(
                    day: HealthCalendarDay.string(from: dayStart, timeZone: timeZone),
                    steps: HealthMetricNormalizer.steps(stepTotal ?? 0),
                    distanceKm: (metreTotal ?? 0) / 1_000
                )
            )
            cursor = nextDay
        }

        return days
    }

    private func cumulativeSum(
        type: HKQuantityType,
        unit: HKUnit,
        start: Date,
        end: Date
    ) async throws -> Double? {
        try await withCheckedThrowingContinuation { continuation in
            let predicate = HKQuery.predicateForSamples(
                withStart: start,
                end: end,
                options: [.strictStartDate]
            )
            let query = HKStatisticsQuery(
                quantityType: type,
                quantitySamplePredicate: predicate,
                options: [.cumulativeSum]
            ) { _, statistics, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(
                        returning: statistics?.sumQuantity()?.doubleValue(for: unit)
                    )
                }
            }
            store.execute(query)
        }
    }

    private func post(days: [HealthDayPayload], token: String) async throws {
        guard let endpoint = Config.convexSiteURL?.appendingPathComponent("ingest/health") else {
            throw HealthSyncError.missingEndpoint
        }

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(
            HealthIngestRequest(
                days: days,
                source: "healthkit",
                postedAt: BackendTimestamp.string(from: Date())
            )
        )

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw HealthSyncError.rejected(0, "No HTTP response.")
        }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONDecoder().decode(HealthIngestFailure.self, from: data)
                .error.message)
                ?? String(data: data, encoding: .utf8)
                ?? "Unknown server response."
            throw HealthSyncError.rejected(http.statusCode, message)
        }
        guard let response = try? JSONDecoder().decode(HealthIngestSuccess.self, from: data),
              response.ok,
              response.latestDay == days.last?.day
        else {
            throw HealthSyncError.invalidResponse
        }
    }

    private func installObserver(for type: HKQuantityType) {
        let query = HKObserverQuery(sampleType: type, predicate: nil) { [weak self] _, completion, error in
            if let error {
                let message = error.localizedDescription
                completion()
                Task { @MainActor in self?.errorMessage = message }
                return
            }

            let completionBridge = HealthObserverCompletion(completion)
            Task { @MainActor in
                await self?.syncToday()
                completionBridge.call()
            }
        }
        observerQueries.append(query)
        store.execute(query)
    }

    private func stopObserverQueries() {
        observerQueries.forEach(store.stop)
        observerQueries.removeAll()
        monitoringEnabled = false
    }

    private func report(_ error: Error) {
        errorMessage = BackendErrorMessage.message(for: error)
    }

    private nonisolated struct HealthIngestRequest: Encodable, Sendable {
        let days: [HealthDayPayload]
        let source: String
        let postedAt: String
    }

}

/// HealthKit's SDK callback predates Swift concurrency and is not annotated
/// Sendable. It is explicitly documented as callable from any queue; this tiny
/// one-shot bridge lets the background task acknowledge the observer only
/// after its async upload finishes.
private nonisolated final class HealthObserverCompletion: @unchecked Sendable {
    private let completion: () -> Void

    init(_ completion: @escaping () -> Void) {
        self.completion = completion
    }

    func call() {
        completion()
    }
}
