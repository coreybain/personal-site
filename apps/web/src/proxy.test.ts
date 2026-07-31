import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";

import { config } from "./proxy";

describe("proxy matcher", () => {
  it("provides Clerk context to the native upload route", () => {
    assert.equal(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: "/api/native/upload",
      }),
      true,
    );
  });

  it("does not widen Clerk proxying to unrelated public API routes", () => {
    for (const url of ["/api/ask", "/api/resume.pdf", "/api/native"]) {
      assert.equal(
        unstable_doesMiddlewareMatch({ config, nextConfig: {}, url }),
        false,
      );
    }
  });
});
