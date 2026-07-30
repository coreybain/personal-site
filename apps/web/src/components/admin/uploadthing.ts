"use client";

import { generateReactHelpers } from "@uploadthing/react";

import type { AdminFileRouter } from "@/app/api/uploadthing/core";

/**
 * The typed UploadThing client, generated once for the whole admin.
 *
 * ── The `import type` is load-bearing ──────────────────────────────────────
 *
 * `@/app/api/uploadthing/core` imports `@clerk/nextjs/server` and reads
 * `CLERK_SECRET_KEY`. Importing it normally from a `"use client"` module would be
 * a build error at best and a leaked secret at worst. `import type` is erased
 * entirely by the compiler — no module is fetched, no bytes ship — so the browser
 * learns the endpoint names and their input types with no runtime coupling to the
 * server file at all. This is the whole reason the router's *type* is exported
 * separately from the router.
 *
 * ── Why the hook and not `<UploadButton>` ──────────────────────────────────
 *
 * `generateReactHelpers` also produces `uploadFiles` and `createUpload`, and
 * `@uploadthing/react` ships ready-made `<UploadButton>` / `<UploadDropzone>`
 * components. Those are not used here, for two reasons:
 *
 *   1. **Styling.** Their default markup is styled with Tailwind class names
 *      baked into the package. Tailwind v4 scans source files, not
 *      `node_modules`, so those classes generate no CSS in this app and the
 *      components render structurally unstyled. Restoring them means either the
 *      `withUt` Tailwind plugin (which wants a `tailwind.config` this app does
 *      not have) or importing their prebuilt stylesheet globally. Both are more
 *      moving parts than the markup is worth.
 *   2. **The component is not the interesting part.** An upload in this admin is
 *      never finished when the bytes land — a `MediaAsset` needs alt text and,
 *      for case studies, a sanitisation flag (ADR 009), and those belong in the
 *      same visual unit as the thumbnail. `ImageUpload` is that unit;
 *      `useUploadThing` is the only piece of UploadThing it needs.
 *
 * No `url` option is passed: the helpers default to
 * `window.location.origin + "/api/uploadthing"`, which is exactly where
 * `src/app/api/uploadthing/route.ts` lives. Moving that route means passing the
 * new path here.
 *
 * The `NextSSRPlugin` from `@uploadthing/react/next-ssr-plugin` is deliberately
 * not mounted. It exists to pre-hydrate the route config so an uploader has no
 * loading state; it would have to live in the admin layout, on every admin page,
 * to save one small request on the few pages that upload. `ImageUpload` does not
 * read `routeConfig`, so there is nothing to wait for.
 */
export const { useUploadThing } = generateReactHelpers<AdminFileRouter>();
