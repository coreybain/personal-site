//
//  Config.swift
//  Home — the pocket admin for coreybaines.com
//
//  The app's three public environment values: Convex, Clerk and the matching
//  web origin used by the authenticated native-upload bridge. They are read once,
//  from `Config.local.plist` — a bundle resource written by
//  `scripts/seed-config.sh` out of the monorepo's root `.env`, so the phone and
//  apps/web cannot end up pointed at different backends.
//
//  ── What is deliberately NOT here ──────────────────────────────────────────
//
//  No secrets. Both values below ship inside the `.ipa` and are extractable by
//  anyone who unzips it, which is fine because both are public by design (the
//  `NEXT_PUBLIC_` prefix on their `.env` names is the same statement). The two
//  credentials that matter live in the Keychain and never touch this type:
//
//    - the Clerk session token, owned and refreshed by ClerkKit (ADR 006);
//    - the phone's own `health:write` ingest bearer token, entered once in
//      Settings and revocable independently of the Mac collector (ADR 006a).
//
//  A feature agent that finds itself wanting to add a third `static let` here
//  for a token has taken a wrong turn.
//
//  ── Why every value is Optional ────────────────────────────────────────────
//
//  `Config.local.plist` is gitignored. A clone where nobody has run the seed
//  script yet has no plist at all, and the project is generated with that
//  resource marked optional precisely so that case still builds. The honest
//  representation of "the file might not be there" is an Optional plus a
//  `status` that can be rendered, not a `!` that turns a setup step into a
//  launch crash with a stack trace pointing at the wrong line.
//

import Foundation

/// Launch-time configuration, read from the bundled `Config.local.plist`.
///
/// `nonisolated` on purpose. The project builds with
/// `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor`, so an unannotated type would be
/// main-actor-bound — and the HealthKit background-delivery handler (pipeline 3)
/// runs off the main actor by definition. Configuration is immutable `let`s of
/// `Sendable` types; there is nothing to protect.
nonisolated enum Config {

    // MARK: - Values

    /// The Convex deployment's *client* origin, e.g.
    /// `https://hip-dragon-50.convex.cloud`.
    ///
    /// This is what `ConvexClient(deploymentUrl:)` wants: queries, mutations
    /// and actions over WebSocket, with live-query subscriptions (ADR 007).
    static let convexDeploymentURL: URL? = Self.url(forKey: "ConvexURL")

    /// The Clerk publishable key, `pk_test_…` or `pk_live_…`.
    ///
    /// Passed to `Clerk.configure(publishableKey:)` exactly once, at launch.
    /// ClerkKit decodes the Frontend API hostname out of the key itself, which
    /// is why there is no separate domain setting to keep in step.
    static let clerkPublishableKey: String? = Self.string(forKey: "ClerkPublishableKey")

    /// The web deployment that shares the configured Clerk environment. Local
    /// development defaults to `http://localhost:3000`; production defaults to
    /// the canonical site, and previews can override NEXT_PUBLIC_SITE_URL.
    static let webOriginURL: URL? = Self.url(forKey: "WebOrigin")

    static let nativeUploadURL: URL? = webOriginURL?.appendingPathComponent(
        "api/native/upload"
    )

    /// The Convex deployment's *HTTP action* origin, e.g.
    /// `https://hip-dragon-50.convex.site`.
    ///
    /// Convex serves `http.ts` routes — including `/ingest/health`, the phone's
    /// bearer-token endpoint (ADR 006a) — from `.convex.site`, while the
    /// reactive client protocol lives on `.convex.cloud`. Same deployment, two
    /// origins.
    ///
    /// Derived rather than stored as a third plist key on purpose: two keys
    /// that must always name the same deployment are two keys that will one day
    /// name different ones. The rule is Convex's own and is stable; if it ever
    /// stops being a suffix swap, this is the single place it breaks.
    static let convexSiteURL: URL? = {
        guard let host = convexDeploymentURL?.host() else { return nil }
        guard host.hasSuffix(".convex.cloud") else {
            // Self-hosted or proxied deployment: no derivation rule applies, so
            // say nothing rather than guess an endpoint that will 404 later.
            return nil
        }
        let siteHost = host.replacingOccurrences(
            of: ".convex.cloud",
            with: ".convex.site"
        )
        return URL(string: "https://\(siteHost)")
    }()

    // MARK: - Status

    /// Whether the app has enough configuration to authenticate and reach
    /// Convex. `WebOrigin` is intentionally not part of this gate: it powers
    /// image uploads only, so a missing upload bridge must not disable every
    /// other CRUD screen or the business card.
    enum Status: Equatable {
        /// Everything needed is present and well-formed.
        case ready

        /// One or more values are absent or still the template placeholder.
        /// The associated names are `.env` variable names, so the message the
        /// user sees names the thing they actually have to go and set.
        case missing([String])
    }

    /// Evaluated once. Read this before configuring Clerk or Convex; render the
    /// `.missing` case rather than force-unwrapping past it.
    static let status: Status = {
        var absent: [String] = []
        if convexDeploymentURL == nil { absent.append("NEXT_PUBLIC_CONVEX_URL") }
        if clerkPublishableKey == nil { absent.append("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY") }
        return absent.isEmpty ? .ready : .missing(absent)
    }()

    /// The one-line remedy shown in the UI when `status` is `.missing`.
    /// Kept next to the check so the instruction cannot drift from the script.
    static let remedy = "Run apps/ios/scripts/seed-config.sh, then rebuild."

    // MARK: - Reading

    /// The seeded plist's contents, or an empty dictionary on a clone where the
    /// seed script has not run.
    ///
    /// Typed `[String: String]` rather than the `[String: Any]` a plist
    /// nominally decodes to, and that is a correctness requirement rather than
    /// a tidiness one: under Swift 6 language mode a `static let` must be of a
    /// `Sendable` type, and `[String: Any]` is not — `Any` could be holding a
    /// reference type with shared mutable state, so the compiler rejects it
    /// outright ("static property 'values' is not concurrency-safe"). Narrowing
    /// the cast makes the dictionary genuinely `Sendable` instead of asserting
    /// it with `@unchecked`.
    ///
    /// The narrowing is free because it matches the data: `Config.local.plist`
    /// is written by `seed-config.sh` as two `plutil -replace … -string` calls
    /// and holds nothing but strings. A future non-string key would fail the
    /// cast and read as absent — which `status` reports as a named missing
    /// variable, not a crash.
    private static let values: [String: String] = {
        guard
            let url = Bundle.main.url(forResource: "Config.local", withExtension: "plist"),
            let data = try? Data(contentsOf: url),
            let plist = try? PropertyListSerialization.propertyList(
                from: data,
                format: nil
            ) as? [String: String]
        else {
            return [:]
        }
        return plist
    }()

    /// A non-empty string for `key`, treating the committed template's
    /// `REPLACE-ME` placeholders as absent.
    ///
    /// That last part matters more than it looks: `seed-config.sh` copies the
    /// example file verbatim when `.env` is missing, so "unconfigured" reaches
    /// the app as a *present but fake* value. Without this check the app would
    /// dial `https://REPLACE-ME.convex.cloud` and fail with a DNS error that
    /// names nothing useful.
    private static func string(forKey key: String) -> String? {
        guard let raw = values[key] else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.contains("REPLACE-ME") else { return nil }
        return trimmed
    }

    private static func url(forKey key: String) -> URL? {
        guard let value = string(forKey: key) else { return nil }
        return URL(string: value)
    }
}
