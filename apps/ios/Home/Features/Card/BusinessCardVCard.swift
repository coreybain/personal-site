//
//  BusinessCardVCard.swift
//  Home — shareable business card
//

import CoreTransferable
import Foundation
import UniformTypeIdentifiers

/// A standards-compliant vCard 4.0 payload exported by `ShareLink` as a `.vcf`.
nonisolated struct BusinessCardVCard: Transferable {
    let identity: BusinessCardIdentity
    var portraitJPEG: Data? = nil

    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(exportedContentType: .vCard) { card in
            card.data
        }
        .suggestedFileName { card in
            card.suggestedFileName
        }
    }

    var data: Data {
        Data(text.utf8)
    }

    private var text: String {
        let name = structuredName(identity.name)
        let address = structuredAddress(identity.location)
        var lines = [
            "BEGIN:VCARD",
            "VERSION:4.0",
            "PRODID:-//coreybaines.com//Home iOS//EN",
            "KIND:individual",
            "UID:https://coreybaines.com/#person",
            "FN:\(Self.escape(identity.name))",
            "N:\(Self.escape(name.family));\(Self.escape(name.given));;;",
            "TITLE:\(Self.escape(identity.role))",
            "ORG:\(Self.escape(identity.company))",
            "ADR;TYPE=work:;;;\(Self.escape(address.locality));;;\(Self.escape(address.country))",
            "EMAIL;TYPE=work:\(Self.escape(identity.email))",
            "URL:\(BusinessCardIdentity.siteURL.absoluteString)",
            "X-SOCIALPROFILE;TYPE=github:\(identity.githubURL.absoluteString)",
            "X-SOCIALPROFILE;TYPE=linkedin:\(identity.linkedin.absoluteString)",
        ]

        if let x = identity.x {
            lines.append("X-SOCIALPROFILE;TYPE=x:\(x.absoluteString)")
        }

        if let portraitJPEG, !portraitJPEG.isEmpty {
            lines.append("PHOTO:data:image/jpeg;base64,\(portraitJPEG.base64EncodedString())")
        }

        lines.append("NOTE:\(Self.escape(identity.availability))")
        lines.append("END:VCARD")

        // RFC 6350 uses CRLF and folds content lines after 75 UTF-8 octets.
        return lines.map(Self.fold).joined(separator: "\r\n") + "\r\n"
    }

    private var suggestedFileName: String {
        let words = identity.name.split { character in
            !character.isLetter && !character.isNumber
        }
        let stem = words.isEmpty ? "contact" : words.joined(separator: "-")
        return "\(stem).vcf"
    }

    private func structuredName(_ fullName: String) -> (family: String, given: String) {
        let parts = fullName.split(whereSeparator: \Character.isWhitespace)
        guard let family = parts.last else { return ("", "") }
        if parts.count == 1 {
            return (family: "", given: String(family))
        }
        return (
            family: String(family),
            given: parts.dropLast().joined(separator: " ")
        )
    }

    private func structuredAddress(_ location: String) -> (locality: String, country: String) {
        let parts = location
            .split(separator: ",", omittingEmptySubsequences: true)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        guard parts.count > 1, let country = parts.last else {
            return (location.trimmingCharacters(in: .whitespacesAndNewlines), "")
        }
        return (parts.dropLast().joined(separator: ", "), country)
    }

    private static func escape(_ value: String) -> String {
        value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\r\n", with: "\\n")
            .replacingOccurrences(of: "\r", with: "\\n")
            .replacingOccurrences(of: "\n", with: "\\n")
            .replacingOccurrences(of: ";", with: "\\;")
            .replacingOccurrences(of: ",", with: "\\,")
    }

    /// Fold without splitting a UTF-8 scalar across lines. A continuation
    /// begins with one space, which counts toward the 75-octet cap.
    private static func fold(_ line: String) -> String {
        var physicalLines: [String] = []
        var current = ""

        for scalar in line.unicodeScalars {
            let fragment = String(scalar)
            if !current.isEmpty, current.utf8.count + fragment.utf8.count > 75 {
                physicalLines.append(current)
                current = " " + fragment
            } else {
                current.append(contentsOf: fragment)
            }
        }

        physicalLines.append(current)
        return physicalLines.joined(separator: "\r\n")
    }
}
