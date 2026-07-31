# `Home/Backend/` — Convex client and Clerk auth

**Owner: the auth agent.** Nothing else in the app should construct a Convex
client or touch `Clerk.shared` directly; every other directory consumes whatever
this one injects into the SwiftUI environment.

This directory is empty at foundation time on purpose. Stubbing a type whose
shape nobody has read the SDK for yet produces a merge conflict with extra
steps.

## What lands here

| File (suggested) | Job |
|---|---|
| `ClerkAuthProvider.swift` | The ADR 007 adapter: `ConvexMobile.AuthProvider` implemented against ClerkKit. **The first task of this phase, not the last.** |
| `ConvexBackend.swift` | Owns the `ConvexClientWithAuth`, exposes it via `@Observable` + `.environment(…)`. |
| `SessionStore.swift` | Signed-in / signed-out state that `RootView` can branch on. |

## The API surface, read from the pinned tags on 2026-07-31

Both were read out of the actual source, not from documentation. Verify again if
you bump a version — the plan's notes on both were five weeks stale and one was
already wrong (Clerk's product name).

### `convex-swift` 0.8.1 — `Sources/ConvexMobile/ConvexMobile.swift`

```swift
public protocol AuthProvider<T> {
  associatedtype T
  func login(onIdToken: @Sendable @escaping (String?) -> Void) async throws -> T
  func logout() async throws
  func loginFromCache(onIdToken: @Sendable @escaping (String?) -> Void) async throws -> T
  func extractIdToken(from authResult: T) -> String
}

public class ConvexClientWithAuth<T>: ConvexClient {
  public let authState: AnyPublisher<AuthState<T>, Never>
  public init(deploymentUrl: String, authProvider: any AuthProvider<T>)
  public func login() async -> Result<T, Error>
  public func loginFromCache() async -> Result<T, Error>
  public func logout() async
}

public enum AuthState<T> { /* … */ }
```

⚠️ **The `onIdToken:` parameter is the part that has changed** since most
tutorials were written. `login` and `loginFromCache` no longer just return a
token — they are handed a callback that the provider must **store** and re-invoke
on every refresh, and invoke with `nil` when the session dies. Clerk refreshes
session tokens on its own schedule, so the adapter's real job is bridging
Clerk's refresh notifications into that callback. An adapter that calls it once
and forgets will work for about sixty seconds.

Inherited from `ConvexClient`:

```swift
public func subscribe<T: Decodable>(to name: String, with args: …, yielding: T.Type)
public func mutation<T: Decodable>(_ name: String, with args: [String: ConvexEncodable?]?) async throws -> T
public func action<T: Decodable>(_ name: String, with args: [String: ConvexEncodable?]?) async throws -> T
public func watchWebSocketState() -> AnyPublisher<WebSocketState, Never>
```

`ConvexClient` is a plain `public class` and is **not `Sendable`**. That is why
the project sets `SWIFT_APPROACHABLE_CONCURRENCY = YES` and
`SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor` — `await client.mutation(…)` then
stays on the caller's actor and nothing crosses an isolation boundary. Do not
"fix" a concurrency error by marking anything `@unchecked Sendable`; check the
isolation first.

### `clerk-ios` 1.3.6 — products `ClerkKit` (data) and `ClerkKitUI` (screens)

```swift
@MainActor @discardableResult
public static func configure(publishableKey: String, options: Clerk.Options = .init()) -> Clerk

public var session: Session?                       // Clerk.shared.session
public func getToken(_ options: Session.GetTokenOptions = .init()) async throws -> String?
public struct GetTokenOptions: Sendable { public var template: String?; … }
```

**`template` is not optional in practice.** `packages/convex/convex/auth.config.ts`
sets `applicationID: 'convex'`, which Convex checks against the JWT's `aud`
claim, so the adapter must call `getToken(.init(template: "convex"))`. A default
session token has the wrong audience and Convex reads it as *not signed in* —
with no error. That silent failure is the single most likely way this phase goes
wrong.

`configure` warns and no-ops if called twice. Call it once, from whatever type
here owns startup, using `Config.clerkPublishableKey`.

`ClerkKitUI` is linked and vends the prebuilt sign-in surface. Use it. ADR 006
chose Clerk specifically to avoid hand-writing auth UI and Keychain plumbing for
a one-user admin; rebuilding a sign-in form here would spend the thing that was
bought.

## The fallback, if this proves unstable

ADR 007 records it: drop to the Convex `http.ts` endpoints plus `URLSession`.
That loses live queries and nothing else — CRUD and ingest still work. Decide it
early and loudly rather than late; the whole reason this directory is sequenced
first is so a failure surfaces while there is still room to change course.
