import { auth } from "@clerk/nextjs/server";
import { UTApi } from "uploadthing/server";

import {
  handleNativeImageUpload,
  type NativeUploadedImage,
} from "./contract";
import {
  configuredAdminClerkUserId,
  isConfiguredAdminClerkUser,
} from "@/lib/adminAuthorization";

/** UTApi is a server SDK and this handler must never be moved to Edge. */
export const runtime = "nodejs";

const clerkConfigured = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
);

const uploadthingToken = process.env.UPLOADTHING_TOKEN;
const uploadApi = uploadthingToken
  ? new UTApi({ token: uploadthingToken })
  : null;

async function authenticate(): Promise<string | null> {
  const { userId } = await auth();
  return userId;
}

async function upload(file: File): Promise<NativeUploadedImage> {
  if (!uploadApi) {
    // The contract checks this before calling `upload`; retaining the guard
    // keeps the adapter total if it is ever reused independently.
    throw new Error("UploadThing is not configured.");
  }

  const result = await uploadApi.uploadFiles(file);

  if (result.error) {
    console.error("Native UploadThing upload failed.", {
      code: result.error.code,
      message: result.error.message,
    });
    throw new Error("UploadThing rejected the image.");
  }

  return {
    url: result.data.ufsUrl,
    storageKey: result.data.key,
    name: result.data.name,
    size: result.data.size,
    contentType: result.data.type,
  };
}

/**
 * Native iOS image upload.
 *
 * The client sends its default Clerk session JWT as a bearer token and one
 * image in multipart field `file`. The Convex JWT template is intentionally
 * not accepted here: its audience is the Convex deployment, not this origin.
 */
export async function POST(request: Request): Promise<Response> {
  return handleNativeImageUpload(request, {
    clerkConfigured,
    adminConfigured: configuredAdminClerkUserId() !== null,
    uploadthingConfigured: Boolean(uploadApi),
    authenticate,
    authorize: isConfiguredAdminClerkUser,
    upload,
  });
}
