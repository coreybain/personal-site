# ADR 0010 — UploadThing for image storage

- **Date:** 2026-07-30
- **Status:** Accepted

## Context

Images are load-bearing for this site (ADR 0003, ADR 0009), and they arrive from two very
different places. Sanitised case-study screenshots are uploaded from a Mac through the browser
admin; Fun Entry photos are captured on the phone by the iOS app and uploaded directly from it.
Both paths need durable storage, a CDN in front of it so the performance budget survives, and —
for the native client — a way to upload without shipping storage credentials into the app.

## Decision

Use **UploadThing** for image storage. It handles upload, CDN delivery, and presigned URLs,
which is exactly the shape the iOS client needs: request a presigned URL from the server, PUT
the bytes directly, store the resulting URL in Convex.

## Consequences

- The iOS app never holds storage credentials — it holds a short-lived presigned URL, obtained
  through an authenticated call.
- CDN delivery is included, so image weight does not immediately threaten the LCP budget the way
  origin-served assets would.
- Convex stores URLs, not blobs, keeping documents small and the Snapshot read cheap.
- Another third-party dependency in the media path. Images are referenced by URL, so a migration
  later means a rewrite pass over stored URLs rather than a schema change.
