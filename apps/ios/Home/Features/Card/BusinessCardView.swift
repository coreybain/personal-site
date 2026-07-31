//
//  BusinessCardView.swift
//  Home — shareable business card
//

import CoreImage
import CoreImage.CIFilterBuiltins
import Foundation
import SwiftUI
import UIKit

/// A pocket version of the site's public profile card, with one-tap sharing.
struct BusinessCardView: View {
    let identity: BusinessCardIdentity
    var onDone: (() -> Void)?

    init(identity: BusinessCardIdentity, onDone: (() -> Void)? = nil) {
        self.identity = identity
        self.onDone = onDone
    }

    @ScaledMetric(relativeTo: .title) private var portraitSize = 112.0

    private static let qrCode = QRCodeRenderer.make(
        from: BusinessCardIdentity.siteURL.absoluteString
    )
    private static let portraitJPEG = UIImage(named: "BusinessCardPortrait")?
        .jpegData(compressionQuality: 0.86)

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: HorizonStyle.flow) {
                    identityCard
                    shareActions
                    qrCodePanel
                }
                .frame(maxWidth: 560)
                .padding(.horizontal, HorizonStyle.flow)
                .padding(.vertical, HorizonStyle.stack)
                .frame(maxWidth: .infinity)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Business card")
            .toolbar {
                if let onDone {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done", action: onDone)
                    }
                }
            }
        }
    }

    private var identityCard: some View {
        VStack(spacing: HorizonStyle.stack) {
            Image("BusinessCardPortrait")
                .resizable()
                .scaledToFill()
                .frame(
                    width: min(portraitSize, 180),
                    height: min(portraitSize, 180)
                )
                .clipShape(Circle())
                .overlay {
                    Circle().stroke(HorizonStyle.accent, lineWidth: 2)
                }
                .accessibilityLabel("Portrait of \(identity.name)")

            VStack(spacing: HorizonStyle.snug) {
                Text(identity.name)
                    .font(.title.bold())
                    .multilineTextAlignment(.center)

                Text("\(identity.role) · \(identity.company)")
                    .font(.headline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)

                Label(identity.location, systemImage: "location")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                Label(identity.availability, systemImage: "circle.fill")
                    .font(.callout.weight(.medium))
                    .foregroundStyle(HorizonStyle.accent)
                    .multilineTextAlignment(.center)
                    .accessibilityElement(children: .combine)
            }
            .accessibilityElement(children: .combine)

            socialLinks
        }
        .padding(HorizonStyle.flow)
        .frame(maxWidth: .infinity)
        .background(Color(.secondarySystemGroupedBackground))
        .overlay {
            RoundedRectangle(cornerRadius: 24)
                .stroke(.quaternary, lineWidth: 1)
        }
        .compositingGroup()
        .clipShape(.rect(cornerRadius: 24))
    }

    private var socialLinks: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: HorizonStyle.snug) {
                socialLinkItems
            }

            VStack(spacing: HorizonStyle.snug) {
                socialLinkItems
            }
        }
        .font(.subheadline)
    }

    @ViewBuilder
    private var socialLinkItems: some View {
        Link(destination: identity.githubURL) {
            Label("GitHub", systemImage: "chevron.left.forwardslash.chevron.right")
        }
        .frame(minHeight: 44)

        Link(destination: identity.linkedin) {
            Label("LinkedIn", systemImage: "briefcase")
        }
        .frame(minHeight: 44)

        if let x = identity.x {
            Link(destination: x) {
                Label("X", systemImage: "at")
            }
            .frame(minHeight: 44)
        }

        if let emailURL = identity.emailURL {
            Link(destination: emailURL) {
                Label("Email", systemImage: "envelope")
            }
            .frame(minHeight: 44)
        }
    }

    private var shareActions: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: HorizonStyle.stack) {
                shareContactButton
                shareSiteButton
            }

            VStack(spacing: HorizonStyle.stack) {
                shareContactButton
                shareSiteButton
            }
        }
    }

    private var shareContactButton: some View {
        ShareLink(
            item: BusinessCardVCard(
                identity: identity,
                portraitJPEG: Self.portraitJPEG
            ),
            preview: SharePreview(
                "\(identity.name) contact card",
                image: Image("BusinessCardPortrait")
            )
        ) {
            Label("Share contact", systemImage: "person.crop.circle.badge.plus")
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .accessibilityHint("Shares a vCard that can be saved to Contacts")
    }

    private var shareSiteButton: some View {
        ShareLink(
            item: BusinessCardIdentity.siteURL,
            subject: Text(identity.name),
            message: Text(
                "\(identity.name) — \(identity.role) at \(identity.company)"
            ),
            preview: SharePreview(
                "\(identity.name) · coreybaines.com",
                image: Image("BusinessCardPortrait")
            )
        ) {
            Label("Share website", systemImage: "link")
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        .controlSize(.large)
        .accessibilityHint("Shares a link to coreybaines.com")
    }

    private var qrCodePanel: some View {
        VStack(spacing: HorizonStyle.stack) {
            VStack(spacing: HorizonStyle.snug) {
                Text("Scan to connect")
                    .font(.headline)
                Text("Opens coreybaines.com")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)

            if let qrCode = Self.qrCode {
                Image(qrCode, scale: 1, label: Text("QR code for coreybaines.com"))
                    .interpolation(.none)
                    .resizable()
                    .scaledToFit()
                    .padding(HorizonStyle.stack)
                    .background(.white)
                    .compositingGroup()
                    .clipShape(.rect(cornerRadius: 16))
                    .frame(maxWidth: 240)
                    .accessibilityHint("Scan with a camera to open the website")
            } else {
                ContentUnavailableView(
                    "QR code unavailable",
                    systemImage: "qrcode",
                    description: Text(BusinessCardIdentity.siteURL.absoluteString)
                )
            }

            Link(destination: BusinessCardIdentity.siteURL) {
                Text("coreybaines.com")
                    .font(HorizonStyle.mono(.body))
            }
        }
        .padding(HorizonStyle.flow)
        .frame(maxWidth: .infinity)
        .background(Color(.secondarySystemGroupedBackground))
        .overlay {
            RoundedRectangle(cornerRadius: 24)
                .stroke(.quaternary, lineWidth: 1)
        }
        .compositingGroup()
        .clipShape(.rect(cornerRadius: 24))
    }
}

private nonisolated enum QRCodeRenderer {
    static func make(from value: String) -> CGImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(value.utf8)
        filter.correctionLevel = "M"

        guard let outputImage = filter.outputImage else { return nil }
        let scaledImage = outputImage.transformed(
            by: CGAffineTransform(scaleX: 12, y: 12)
        )
        return CIContext(options: [.useSoftwareRenderer: false]).createCGImage(
            scaledImage,
            from: scaledImage.extent
        )
    }
}

private let businessCardPreviewIdentity = BusinessCardIdentity(
    name: "Corey Baines",
    role: "Principal Engineer",
    company: "Example Company",
    location: "Sydney, Australia",
    availability: "Open to product-minded engineering leadership roles",
    github: "coreybain",
    linkedin: URL(string: "https://www.linkedin.com/in/coreybaines")!,
    x: URL(string: "https://x.com/coreybaines"),
    email: "hello@coreybaines.com"
)

#Preview("Business card") {
    BusinessCardView(identity: businessCardPreviewIdentity)
}

#Preview("Accessibility size") {
    BusinessCardView(identity: businessCardPreviewIdentity)
        .environment(\.dynamicTypeSize, .accessibility3)
}
