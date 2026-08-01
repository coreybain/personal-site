//
//  BusinessCardIdentity.swift
//  Home — shareable business card
//

import Foundation

/// The public identity fields needed to render and share the business card.
///
/// This deliberately mirrors the `identity` block in `siteSettings` without
/// depending on a generated Convex document type. The app shell can map the
/// live settings row into this small value and the card remains previewable and
/// testable without a backend.
nonisolated struct BusinessCardIdentity: Hashable, Sendable {
    let name: String
    let role: String
    let company: String
    let location: String
    let availability: String
    let availabilityVisible: Bool
    let github: String
    let linkedin: URL
    let x: URL?
    let email: String

    init(
        name: String,
        role: String,
        company: String,
        location: String,
        availability: String,
        availabilityVisible: Bool = true,
        github: String,
        linkedin: URL,
        x: URL? = nil,
        email: String
    ) {
        self.name = name
        self.role = role
        self.company = company
        self.location = location
        self.availability = availability
        self.availabilityVisible = availabilityVisible
        self.github = github
        self.linkedin = linkedin
        self.x = x
        self.email = email
    }

    /// ADR 0017's canonical public origin. The QR code and vCard always point
    /// here, even when the admin app itself is connected to a preview backend.
    static let siteURL = URL(string: "https://coreybaines.com")!

    var githubURL: URL {
        URL(string: "https://github.com")!.appendingPathComponent(github)
    }

    var emailURL: URL? {
        var components = URLComponents()
        components.scheme = "mailto"
        components.path = email
        return components.url
    }
}
