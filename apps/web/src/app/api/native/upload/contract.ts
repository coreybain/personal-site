/**
 * Stable request/response contract for the native image-upload endpoint.
 *
 * This module deliberately has no Clerk or UploadThing imports. Keeping the
 * protocol and validation in a small Web-API-only function lets the route be
 * tested without credentials, a network call, or framework module mocks.
 */

/** Leaves room below the hosting function's request ceiling for multipart framing. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_REQUEST_BYTES = MAX_IMAGE_BYTES + 64 * 1024;

export type NativeUploadedImage = {
  url: string;
  storageKey: string;
  name: string;
  size: number;
  contentType: string;
};

export type NativeImageUploadDependencies = {
  clerkConfigured: boolean;
  adminConfigured: boolean;
  uploadthingConfigured: boolean;
  authenticate: () => Promise<string | null>;
  authorize: (userId: string) => boolean;
  upload: (file: File) => Promise<NativeUploadedImage>;
};

function errorResponse(
  error: string,
  message: string,
  status: number,
): Response {
  return Response.json({ error, message }, { status });
}

function isFile(value: FormDataEntryValue): value is File {
  // `FormDataEntryValue` is `string | File`; avoiding `instanceof File` also
  // avoids cross-realm failures when Next's Web API implementation created it.
  return typeof value !== "string";
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

async function hasMatchingImageSignature(file: File): Promise<boolean> {
  const bytes = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const mime = file.type.toLowerCase();

  if (mime === "image/jpeg" || mime === "image/jpg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mime === "image/png") {
    return (
      bytes[0] === 0x89 &&
      ascii(bytes, 1, 3) === "PNG" &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  if (mime === "image/gif") {
    const header = ascii(bytes, 0, 6);
    return header === "GIF87a" || header === "GIF89a";
  }
  if (mime === "image/webp") {
    return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP";
  }
  if (["image/heic", "image/heif", "image/avif"].includes(mime)) {
    if (ascii(bytes, 4, 4) !== "ftyp") return false;
    const acceptedBrands = new Set([
      "avif",
      "avis",
      "heic",
      "heix",
      "hevc",
      "hevx",
      "mif1",
      "msf1",
    ]);
    for (let offset = 8; offset + 4 <= bytes.length; offset += 4) {
      if (acceptedBrands.has(ascii(bytes, offset, 4))) return true;
    }
  }

  return false;
}

/**
 * Authenticate, validate, upload, and serialize one native image request.
 *
 * Authentication happens before the multipart body is parsed. Proxy still has
 * to match this route so Clerk can derive the auth context from the native
 * client's bearer token, but this resource-level check is the actual gate.
 */
export async function handleNativeImageUpload(
  request: Request,
  dependencies: NativeImageUploadDependencies,
): Promise<Response> {
  if (!dependencies.clerkConfigured) {
    return errorResponse(
      "auth-not-configured",
      "Clerk is not configured on this deployment.",
      503,
    );
  }

  if (!dependencies.adminConfigured) {
    return errorResponse(
      "authorization-not-configured",
      "The administrator allowlist is not configured on this deployment.",
      503,
    );
  }

  const authorization = request.headers.get("authorization");
  if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) {
    return errorResponse(
      "unauthorized",
      "A Clerk bearer token is required in the Authorization header.",
      401,
    );
  }

  let userId: string | null;

  try {
    userId = await dependencies.authenticate();
  } catch {
    return errorResponse(
      "unauthorized",
      "A valid Clerk session token is required.",
      401,
    );
  }

  if (!userId) {
    return errorResponse(
      "unauthorized",
      "A valid Clerk session token is required.",
      401,
    );
  }

  if (!dependencies.authorize(userId)) {
    return errorResponse(
      "forbidden",
      "This Clerk account is not authorized to administer the site.",
      403,
    );
  }

  if (!dependencies.uploadthingConfigured) {
    return errorResponse(
      "uploads-not-configured",
      "UploadThing is not configured on this deployment.",
      503,
    );
  }

  const contentType = request.headers.get("content-type")?.toLowerCase();

  if (!contentType?.startsWith("multipart/form-data;")) {
    return errorResponse(
      "invalid-content-type",
      "Expected a multipart/form-data request with one 'file' field.",
      415,
    );
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return errorResponse(
      "request-too-large",
      "The multipart request is too large.",
      413,
    );
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return errorResponse(
      "invalid-multipart-body",
      "The multipart request body could not be parsed.",
      400,
    );
  }

  const entries = Array.from(formData.entries());
  const fileFieldValues = formData.getAll("file");
  const allFiles = Array.from(formData.values()).filter(isFile);
  const file = fileFieldValues[0];

  if (
    entries.length !== 1 ||
    entries[0]?.[0] !== "file" ||
    fileFieldValues.length !== 1 ||
    allFiles.length !== 1 ||
    !file ||
    !isFile(file)
  ) {
    return errorResponse(
      "invalid-file-count",
      "Provide exactly one image in the multipart field named 'file'.",
      400,
    );
  }

  if (file.size === 0) {
    return errorResponse("empty-file", "The uploaded image is empty.", 400);
  }

  if (file.size > MAX_IMAGE_BYTES) {
    return errorResponse(
      "file-too-large",
      `The uploaded image exceeds the ${MAX_IMAGE_BYTES}-byte limit.`,
      413,
    );
  }

  if (!file.type.toLowerCase().startsWith("image/")) {
    return errorResponse(
      "unsupported-file-type",
      "Only image files are accepted.",
      415,
    );
  }

  if (!(await hasMatchingImageSignature(file))) {
    return errorResponse(
      "invalid-image-data",
      "The file contents do not match a supported raster image format.",
      415,
    );
  }

  try {
    const uploaded = await dependencies.upload(file);
    return Response.json({ file: uploaded });
  } catch {
    return errorResponse(
      "upload-failed",
      "UploadThing could not store the image.",
      502,
    );
  }
}
