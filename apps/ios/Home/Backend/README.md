# Home iOS backend boundary

SwiftUI features consume `HomeAppModel` from the environment. They do not
construct network clients or read Clerk directly.

- `ClerkAuthProvider.swift` renews Clerk's `convex` JWT template and bridges it
  into `ConvexClientWithAuth`.
- `HomeAppModel.swift` owns live queries, every admin mutation, hydration state,
  image uploads and session diagnostics.
- `Models.swift` mirrors the Convex document and mutation shapes. Convex system
  ids are the identity for server records; editor-only rows use UUIDs.
- `NativeUploadService.swift` sends one Clerk-authenticated image to the
  configured web origin's `/api/native/upload`; storage credentials never ship
  in the app. Simulator development uses localhost. A physical-device build
  must seed an HTTPS `NEXT_PUBLIC_SITE_URL` that the phone can reach.

The default Clerk token is used only for the Next.js upload endpoint. Convex
always receives the dedicated `convex` JWT template because its audience claim
is different.
