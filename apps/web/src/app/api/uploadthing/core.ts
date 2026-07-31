import { auth } from "@clerk/nextjs/server";
import { createUploadthing, type FileRouter } from "uploadthing/next";
import { UploadThingError } from "uploadthing/server";

import {
  configuredAdminClerkUserId,
  isConfiguredAdminClerkUser,
} from "@/lib/adminAuthorization";

/**
 * The UploadThing file router (ADR 010).
 *
 * ── Why UploadThing at all ─────────────────────────────────────────────────
 *
 * Convex stores URLs, not blobs. Screenshots for the case studies are uploaded
 * from a Mac through this admin; Fun Entry photos are captured on a phone and
 * sent through the authenticated native upload route. Both paths need durable
 * storage plus a CDN in front of it, and the native client must never hold
 * storage credentials. That is exactly UploadThing's shape (ADR 010).
 *
 * ── Server file, permanently ───────────────────────────────────────────────
 *
 * Nothing in `src/components` may import this module. It reaches for
 * `@clerk/nextjs/server`, which is server-only, and the route config it exports
 * is consumed by `./route.ts` alone. The browser learns the endpoint's name from
 * the *type* import in `src/components/admin/uploadthing.ts` — types are erased,
 * so that import ships no bytes.
 *
 * ── Endpoint shape ─────────────────────────────────────────────────────────
 *
 * One endpoint, `adminImage`, images only, one file per call. Deliberately
 * narrow:
 *
 *   - Every media shape the admin writes (`projects.media[]`, `labs.coverImage`,
 *     `posts.coverImage`, `funEntries.photo`) is a still image today. The schema
 *     allows `kind: 'video'`, but nothing produces one yet, and an endpoint that
 *     accepts video would be an untested surface with a 100× size ceiling.
 *   - One file at a time keeps the client contract trivial: exactly one uploaded
 *     file maps to exactly one `MediaAsset`, so `ImageUpload` never has to
 *     reconcile a partial batch. Adding three screenshots to a case study is
 *     three uploads, which is also how the alt text gets written — one caption
 *     per image, at the moment it is chosen.
 *
 * If a video or a batch is ever needed, add a *second* endpoint rather than
 * widening this one: the file-size ceiling and the accepted MIME set are the
 * only things standing between "admin misclick" and "8 GB in the CDN bill".
 */
const f = createUploadthing();

/**
 * Is Clerk actually set up? Mirrors `src/proxy.ts` exactly, and for the same
 * reason: `auth()` throws when `clerkMiddleware` never ran, and with no keys the
 * proxy is a pass-through, so it never runs.
 *
 * The publishable key is inlined at build; the secret key is read from the
 * process at cold start. A deployment missing either is not configured.
 */
const clerkConfigured = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
);

/**
 * 8 MB. A full-page 2× screenshot of a dense admin UI lands around 1–3 MB as
 * PNG; 8 MB leaves headroom for a retina hero without leaving room for someone
 * to upload a video renamed `.png`.
 */
const MAX_IMAGE_SIZE = "8MB" as const;

export const adminFileRouter = {
  /**
   * The single upload endpoint the admin uses.
   *
   * `.middleware()` runs on *our* server before UploadThing issues a presigned
   * URL, which makes it the only place an upload can be refused. This is a
   * single-user admin (ADR 006), but identity and authorization remain separate:
   * Clerk proves the session and `ADMIN_CLERK_USER_ID` names the one account
   * allowed to write. The same rule is enforced again by every Convex mutation.
   *
   * Throwing `UploadThingError` is not decoration: UploadThing serialises it
   * into the client's `onUploadError` with the message intact, where a plain
   * `Error` becomes an opaque 500.
   */
  adminImage: f({
    image: {
      maxFileSize: MAX_IMAGE_SIZE,
      maxFileCount: 1,
    },
  })
    .middleware(async () => {
      if (!clerkConfigured) {
        // Uploads configured but auth not: refuse rather than accept
        // anonymous writes into the CDN. Half-configured is unconfigured,
        // which is the same rule ConvexClientProvider applies.
        throw new UploadThingError(
          "Uploads are unavailable: Clerk is not configured on this deployment.",
        );
      }

      if (configuredAdminClerkUserId() === null) {
        throw new UploadThingError(
          "Uploads are unavailable: the administrator allowlist is not configured.",
        );
      }

      const { userId } = await auth();

      if (!userId) {
        throw new UploadThingError("Sign in to upload.");
      }

      if (!isConfiguredAdminClerkUser(userId)) {
        throw new UploadThingError("This account is not authorized to upload.");
      }

      // Whatever is returned here is handed to `onUploadComplete` as
      // `metadata`, and *only* to it. It never reaches the browser unless
      // `onUploadComplete` passes it on, which is why the user id is recorded
      // rather than returned below.
      return { userId };
    })
    .onUploadComplete(async ({ file }) => {
      /**
       * Runs on our server after the bytes land, called by UploadThing rather
       * than by the browser. Two things worth knowing:
       *
       *   1. The return value is what the browser receives as `serverData`.
       *      It is deliberately thin — the browser already has `ufsUrl`, `key`,
       *      `name`, `size` and `type` from the upload result itself, so
       *      repeating them here would just create two sources of truth for the
       *      same URL.
       *
       *   2. **Nothing is written to Convex from here.** It would be tempting:
       *      the file is final, the identity is known. But an uploaded file is
       *      not yet a `MediaAsset` — it has no alt text, no `sanitised` flag,
       *      and no owning document. Writing a row here would create media the
       *      admin never described, and ADR 009's publish gate exists precisely
       *      because undescribed, unsanitised media must not accumulate. The
       *      admin form owns the write; this callback owns nothing.
       *
       * Orphans are the accepted cost of that: cancel a form after uploading and
       * the file stays in the CDN, referenced by nothing. It leaks no data (the
       * URL was never stored) and costs storage only. A phase-6 sweep can
       * reconcile UploadThing's file list against `storageKey` values in Convex.
       */
      return { key: file.key };
    }),
} satisfies FileRouter;

/** The router's type, for `generateUploadDropzone<AdminFileRouter>()`. */
export type AdminFileRouter = typeof adminFileRouter;
