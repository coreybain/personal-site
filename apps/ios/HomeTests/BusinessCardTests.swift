import Foundation
import Testing
@testable import Home

struct BusinessCardTests {
    private let identity = BusinessCardIdentity(
        name: "Corey Baines",
        role: "Principal Engineer",
        company: "Independent",
        location: "Sydney, Australia",
        availability: "Open to product roles",
        github: "coreybain",
        linkedin: URL(string: "https://linkedin.com/in/coreybaines")!,
        x: URL(string: "https://x.com/coreybaines"),
        email: "hello@coreybaines.com"
    )

    @Test func vCardContainsCanonicalContactDetails() throws {
        let text = try #require(String(data: BusinessCardVCard(identity: identity).data, encoding: .utf8))

        #expect(text.hasPrefix("BEGIN:VCARD\r\nVERSION:4.0\r\n"))
        #expect(text.hasSuffix("END:VCARD\r\n"))
        #expect(text.contains("FN:Corey Baines"))
        #expect(text.contains("N:Baines;Corey;;;"))
        #expect(text.contains("ADR;TYPE=work:;;;Sydney;;;Australia"))
        #expect(text.contains("EMAIL;TYPE=work:hello@coreybaines.com"))
        #expect(text.contains("URL:https://coreybaines.com"))
    }

    @Test func vCardPhysicalLinesRespectByteLimit() throws {
        let longIdentity = BusinessCardIdentity(
            name: identity.name,
            role: String(repeating: "Engineering ", count: 15),
            company: identity.company,
            location: identity.location,
            availability: String(repeating: "Available, soon; ", count: 12),
            github: identity.github,
            linkedin: identity.linkedin,
            email: identity.email
        )
        let text = try #require(
            String(data: BusinessCardVCard(identity: longIdentity).data, encoding: .utf8)
        )

        for line in text.components(separatedBy: "\r\n") where !line.isEmpty {
            #expect(line.utf8.count <= 75)
        }
    }

    @Test func vCardCanEmbedTheSharePortrait() throws {
        let photo = Data([0xff, 0xd8, 0xff, 0xd9])
        let text = try #require(
            String(
                data: BusinessCardVCard(identity: identity, portraitJPEG: photo).data,
                encoding: .utf8
            )
        )

        #expect(text.contains("PHOTO:data:image/jpeg;base64,/9j/2Q=="))
    }

    @Test func liveIdentityMapsIntoBusinessCard() {
        let siteIdentity = SiteIdentity(
            name: "Corey",
            role: "Engineer",
            company: "Home",
            location: "Sydney",
            availability: "Available",
            github: "coreybain",
            linkedin: "https://linkedin.com/in/coreybaines",
            email: "corey@example.com"
        )

        let card = siteIdentity.businessCardIdentity

        #expect(card.name == "Corey")
        #expect(card.githubURL.absoluteString == "https://github.com/coreybain")
        #expect(card.email == "corey@example.com")
    }

    @Test func mononymUsesTheGivenNameComponent() throws {
        let mononym = BusinessCardIdentity(
            name: "Corey",
            role: identity.role,
            company: identity.company,
            location: "Sydney",
            availability: identity.availability,
            github: identity.github,
            linkedin: identity.linkedin,
            email: identity.email
        )
        let text = try #require(
            String(data: BusinessCardVCard(identity: mononym).data, encoding: .utf8)
        )

        #expect(text.contains("N:;Corey;;;"))
        #expect(text.contains("ADR;TYPE=work:;;;Sydney;;;"))
    }
}
