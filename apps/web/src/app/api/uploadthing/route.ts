import type { NextRequest } from "next/server";
import { createRouteHandler } from "uploadthing/next";

import { adminFileRouter } from "./core";

/**
 * The UploadThing route handler (ADR 010).
 *
 * `/api/uploadthing` is the path UploadThing's clients default to — the
 * generated helpers in `src/components/admin/uploadthing.ts` resolve
 * `window.location.origin + "/api/uploadthing"` unless told otherwise. The iOS
 * client uses the separate `/api/native/upload` contract because UploadThing's
 * browser protocol is not a native-client API.
 *
 * Two handlers, and both halves matter:
 *
 *   GET   the browser asks for the route config (accepted MIME types, size and
 *         count limits) so the uploader can validate before spending bandwidth.
 *   POST  presigned-URL requests from the browser *and* the upload-complete
 *         callback from UploadThing's own servers.
 *
 * That second POST caller is why `src/proxy.ts` matches this path but does not
 * `protect()` it: the callback arrives with no browser session, and a blanket
 * `auth.protect()` would 404 it and leave every upload stuck at "finishing".
 * The gate is `.middleware()` in `./core.ts`, which runs before a presigned URL
 * is ever issued. The callback is authenticated by UploadThing's own signature,
 * not by us.
 */

/**
 * Is UploadThing configured?
 *
 * One variable, read from the process at cold start: `UPLOADTHING_TOKEN` is a
 * base64 blob that carries the app id, region and API key together, so there is
 * nothing else to check and nothing to put behind `NEXT_PUBLIC_`. It is a
 * secret — it authorises writes to the CDN — and must never gain that prefix.
 *
 * No account exists yet, so the unconfigured path is the one that runs today.
 */
const uploadthingConfigured = Boolean(process.env.UPLOADTHING_TOKEN);

/**
 * Built once at module scope, or not at all.
 *
 * `createRouteHandler` resolves its config lazily, so constructing it without a
 * token would not throw here — it would throw on the first request, as a 500
 * with an UploadThing stack trace. Gating the construction turns that into the
 * honest answer below instead, and keeps the zero-env build (which imports this
 * module while collecting page data) from evaluating anything that wants a key.
 */
const handlers = uploadthingConfigured
  ? createRouteHandler({ router: adminFileRouter })
  : null;

/**
 * 503, not 404 and not 500.
 *
 * The route exists and the code is fine; the deployment is missing a credential.
 * 503 is the status that says "try again once someone configures this", and it
 * keeps the failure legible in a log without pretending the endpoint is absent.
 * `Retry-After` is deliberately omitted: nobody knows when, and a wrong number
 * is worse than none.
 */
function notConfigured(): Response {
  return Response.json(
    {
      error: "uploads-not-configured",
      message:
        "UPLOADTHING_TOKEN is not set on this deployment, so uploads are disabled. See apps/web/.env.example.",
    },
    { status: 503 },
  );
}

export async function GET(request: NextRequest): Promise<Response> {
  return handlers ? handlers.GET(request) : notConfigured();
}

export async function POST(request: NextRequest): Promise<Response> {
  return handlers ? handlers.POST(request) : notConfigured();
}
