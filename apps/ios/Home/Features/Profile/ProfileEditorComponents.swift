//
//  ProfileEditorComponents.swift
//  Home — profile editing helpers
//

import Foundation
import SwiftUI

struct ProfileInlineError: View {
    let message: String

    var body: some View {
        Label(message, systemImage: "exclamationmark.triangle")
            .font(.footnote)
            .foregroundStyle(.secondary)
            .accessibilityElement(children: .combine)
    }
}

struct ProfileDestinationRow: View {
    let title: String
    let subtitle: String
    let systemImage: String
    var count: Int?

    var body: some View {
        HStack(spacing: HorizonStyle.stack) {
            Image(systemName: systemImage)
                .font(.title3)
                .frame(width: 28)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: HorizonStyle.snug) {
                Text(title)
                    .font(.headline)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            if let count {
                Text(count, format: .number)
                    .font(HorizonStyle.mono(.headline))
                    .horizonNumerals()
            }
        }
        .padding(.vertical, HorizonStyle.snug)
        .contentShape(.rect)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilitySummary)
    }

    private var accessibilitySummary: String {
        if let count {
            return "\(title), \(subtitle), \(count) items"
        }
        return "\(title), \(subtitle)"
    }
}

/// A multiline editing surface that preserves the user's trailing newline while
/// continuously keeping the bound value in the backend's `[String]` shape.
struct ProfileLinesEditor: View {
    let label: String
    let hint: String?
    let monospaced: Bool

    @Binding private var values: [String]
    @State private var text: String

    init(
        _ label: String,
        values: Binding<[String]>,
        hint: String? = nil,
        monospaced: Bool = false
    ) {
        self.label = label
        self.hint = hint
        self.monospaced = monospaced
        _values = values
        _text = State(initialValue: ProfileLineCodec.encode(values.wrappedValue))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: HorizonStyle.snug) {
            Text(label)
                .font(.subheadline.weight(.medium))

            TextEditor(text: $text)
                .font(monospaced ? HorizonStyle.mono(.body) : .body)
                .frame(minHeight: 112)
                .scrollContentBackground(.hidden)
                .padding(HorizonStyle.snug)
                .background(Color(.tertiarySystemGroupedBackground))
                .overlay {
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(.quaternary, lineWidth: 1)
                }
                .compositingGroup()
                .clipShape(.rect(cornerRadius: 8))
                .accessibilityLabel(label)

            if let hint {
                Text(hint)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .onChange(of: text) { _, newValue in
            values = ProfileLineCodec.decode(newValue)
        }
        .onChange(of: values) { _, newValues in
            let reconciled = ProfileLineCodec.reconcile(text, with: newValues)
            if reconciled != text {
                text = reconciled
            }
        }
    }
}

nonisolated enum ProfileLineCodec {
    static func encode(_ values: [String]) -> String {
        values.joined(separator: "\n")
    }

    static func decode(_ text: String) -> [String] {
        text
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    /// Preserve harmless in-progress formatting such as a trailing newline,
    /// but replace the editor text when its bound server value really changed.
    static func reconcile(_ currentText: String, with values: [String]) -> String {
        decode(currentText) == values ? currentText : encode(values)
    }
}

nonisolated enum ProfileDateValidation {
    static func isCalendarDate(_ value: String) -> Bool {
        guard value.count == 10 else { return false }

        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.isLenient = false

        guard let date = formatter.date(from: value) else { return false }
        return formatter.string(from: date) == value
    }
}

extension String {
    var profileTrimmed: String {
        trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var profileIsBlank: Bool {
        profileTrimmed.isEmpty
    }
}

extension Binding where Value == String? {
    var profileOrEmpty: Binding<String> {
        Binding<String>(
            get: { wrappedValue ?? "" },
            set: { wrappedValue = $0.profileIsBlank ? nil : $0 }
        )
    }
}
