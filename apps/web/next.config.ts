import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Deliberately no `outputFileTracingIncludes` for the résumé PDF's fonts.
   *
   * The obvious reading of `@home/pdf` is that it reads five `.woff` files off
   * disk at render time and therefore needs `packages/pdf/assets/fonts` forced
   * into `/api/resume.pdf`'s trace. It does not. Turbopack recognises each
   * `new URL('../assets/fonts/…', import.meta.url)` in that package as an asset
   * reference, copies the file to `.next/server/assets/<name>.<hash>.woff`, and
   * rewrites the expression to point there — verified by reading the compiled
   * route and its `.nft.json`. Tracing the originals would ship 170 KB the
   * function never opens.
   *
   * It would also not be a fix for the failure it looks like it prevents: a
   * build that *didn't* rewrite the URL would resolve `../assets/fonts/`
   * relative to a chunk inside `.next`, where a traced copy of the source tree
   * is not. What actually keeps this working is that every specifier in
   * `packages/pdf/src/fonts.ts` is a string literal, which is documented at
   * length there, next to the bug that taught us.
   */
};

export default nextConfig;
