import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  handleNativeImageUpload,
  MAX_IMAGE_BYTES,
  type NativeImageUploadDependencies,
} from "./contract";

const uploadedFile = {
  url: "https://example.ufs.sh/f/native-image",
  storageKey: "native-image",
  name: "photo.jpg",
  size: 3,
  contentType: "image/jpeg",
};

function dependencies(
  overrides: Partial<NativeImageUploadDependencies> = {},
): NativeImageUploadDependencies {
  return {
    clerkConfigured: true,
    adminConfigured: true,
    uploadthingConfigured: true,
    authenticate: async () => "user_123",
    authorize: (userId) => userId === "user_123",
    upload: async () => uploadedFile,
    ...overrides,
  };
}

function multipartRequest(files: Array<[string, File]>): Request {
  const formData = new FormData();

  for (const [field, file] of files) {
    formData.append(field, file);
  }

  return new Request("https://coreybaines.com/api/native/upload", {
    method: "POST",
    headers: { authorization: "Bearer clerk-session-token" },
    body: formData,
  });
}

function jpegFile(name = "photo.jpg"): File {
  return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xdb])], name, {
    type: "image/jpeg",
  });
}

describe("native image upload contract", () => {
  it("rejects an unauthenticated request before parsing its body", async () => {
    let uploadCalled = false;
    const response = await handleNativeImageUpload(
      new Request("https://coreybaines.com/api/native/upload", {
        method: "POST",
        headers: { authorization: "Bearer expired-token" },
        body: "not multipart",
      }),
      dependencies({
        authenticate: async () => null,
        upload: async () => {
          uploadCalled = true;
          return uploadedFile;
        },
      }),
    );

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: "unauthorized",
      message: "A valid Clerk session token is required.",
    });
    assert.equal(uploadCalled, false);
  });

  it("requires the native bearer-token transport", async () => {
    let authenticateCalled = false;
    const formData = new FormData();
    formData.append("file", jpegFile());
    const response = await handleNativeImageUpload(
      new Request("https://coreybaines.com/api/native/upload", {
        method: "POST",
        body: formData,
      }),
      dependencies({
        authenticate: async () => {
          authenticateCalled = true;
          return "user_123";
        },
      }),
    );

    assert.equal(response.status, 401);
    assert.equal(authenticateCalled, false);
  });

  it("returns a stable 503 when UploadThing is not configured", async () => {
    const response = await handleNativeImageUpload(
      multipartRequest([
        ["file", new File(["jpg"], "photo.jpg", { type: "image/jpeg" })],
      ]),
      dependencies({ uploadthingConfigured: false }),
    );

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "uploads-not-configured",
      message: "UploadThing is not configured on this deployment.",
    });
  });

  it("fails closed when the administrator allowlist is not configured", async () => {
    const response = await handleNativeImageUpload(
      multipartRequest([["file", jpegFile()]]),
      dependencies({ adminConfigured: false }),
    );

    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "authorization-not-configured");
  });

  it("rejects an authenticated Clerk user who is not the administrator", async () => {
    let uploadCalled = false;
    const response = await handleNativeImageUpload(
      multipartRequest([["file", jpegFile()]]),
      dependencies({
        authenticate: async () => "user_public_signup",
        upload: async () => {
          uploadCalled = true;
          return uploadedFile;
        },
      }),
    );

    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "forbidden");
    assert.equal(uploadCalled, false);
  });

  it("turns Clerk verification failures into the stable unauthorized response", async () => {
    const response = await handleNativeImageUpload(
      multipartRequest([["file", jpegFile()]]),
      dependencies({
        authenticate: async () => {
          throw new Error("Clerk infrastructure detail");
        },
      }),
    );

    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, "unauthorized");
  });

  it("requires multipart/form-data", async () => {
    const response = await handleNativeImageUpload(
      new Request("https://coreybaines.com/api/native/upload", {
        method: "POST",
        headers: {
          authorization: "Bearer clerk-session-token",
          "content-type": "application/json",
        },
        body: "{}",
      }),
      dependencies(),
    );

    assert.equal(response.status, 415);
    assert.equal((await response.json()).error, "invalid-content-type");
  });

  it("requires exactly one file in the field named file", async () => {
    const image = () =>
      jpegFile();

    for (const request of [
      multipartRequest([]),
      multipartRequest([["image", image()]]),
      multipartRequest([
        ["file", image()],
        ["file", image()],
      ]),
    ]) {
      const response = await handleNativeImageUpload(request, dependencies());

      assert.equal(response.status, 400);
      assert.equal((await response.json()).error, "invalid-file-count");
    }
  });

  it("rejects unexpected multipart fields", async () => {
    const formData = new FormData();
    formData.append("file", jpegFile());
    formData.append("metadata", "unexpected");
    const response = await handleNativeImageUpload(
      new Request("https://coreybaines.com/api/native/upload", {
        method: "POST",
        headers: { authorization: "Bearer clerk-session-token" },
        body: formData,
      }),
      dependencies(),
    );

    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "invalid-file-count");
  });

  it("rejects empty, oversized, and non-image files", async () => {
    const cases = [
      {
        file: new File([], "empty.jpg", { type: "image/jpeg" }),
        status: 400,
        error: "empty-file",
      },
      {
        file: new File(
          [new Uint8Array(MAX_IMAGE_BYTES + 1)],
          "oversized.jpg",
          { type: "image/jpeg" },
        ),
        status: 413,
        error: "file-too-large",
      },
      {
        file: new File(["text"], "notes.txt", { type: "text/plain" }),
        status: 415,
        error: "unsupported-file-type",
      },
    ] as const;

    for (const testCase of cases) {
      const response = await handleNativeImageUpload(
        multipartRequest([["file", testCase.file]]),
        dependencies(),
      );

      assert.equal(response.status, testCase.status);
      assert.equal((await response.json()).error, testCase.error);
    }
  });

  it("rejects spoofed image MIME types", async () => {
    const response = await handleNativeImageUpload(
      multipartRequest([
        ["file", new File(["<script>"], "photo.jpg", { type: "image/jpeg" })],
      ]),
      dependencies(),
    );

    assert.equal(response.status, 415);
    assert.equal((await response.json()).error, "invalid-image-data");
  });

  it("uploads one valid image and returns the schema-native file fields", async () => {
    let receivedFile: File | undefined;
    const response = await handleNativeImageUpload(
      multipartRequest([
        ["file", jpegFile()],
      ]),
      dependencies({
        upload: async (file) => {
          receivedFile = file;
          return uploadedFile;
        },
      }),
    );

    assert.equal(response.status, 200);
    assert.equal(receivedFile?.name, "photo.jpg");
    assert.deepEqual(await response.json(), { file: uploadedFile });
  });

  it("hides provider failures behind a stable 502 response", async () => {
    const response = await handleNativeImageUpload(
      multipartRequest([
        ["file", jpegFile()],
      ]),
      dependencies({
        upload: async () => {
          throw new Error("provider details must not reach the client");
        },
      }),
    );

    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      error: "upload-failed",
      message: "UploadThing could not store the image.",
    });
  });
});
