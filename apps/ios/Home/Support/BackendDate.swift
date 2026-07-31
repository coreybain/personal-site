//
//  BackendDate.swift
//  Home
//
//  Tolerant parsing for the ISO-8601 instants emitted by JavaScript/Convex.
//

import Foundation

nonisolated enum BackendDate {
    /// JavaScript's `toISOString()` always includes milliseconds, while a few
    /// imported rows may contain whole-second values. Accept both without ever
    /// silently substituting the current date for stored content.
    static func parse(_ value: String) -> Date? {
        if let date = try? Date(
            value,
            strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true)
        ) {
            return date
        }

        return try? Date(
            value,
            strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: false)
        )
    }

    static func abbreviatedDateTime(_ value: String) -> String {
        guard let date = parse(value) else { return value }
        return date.formatted(date: .abbreviated, time: .shortened)
    }

    static func abbreviatedDate(_ value: String) -> String {
        guard let date = parse(value) else { return value }
        return date.formatted(date: .abbreviated, time: .omitted)
    }
}
