import { timingSafeEqual } from "node:crypto";

import { revalidateTag } from "next/cache";

import { POSTS_CACHE_TAG } from "@/lib/data";

/**
 * POST /api/revalidate — Convex tells the site a post changed.
 *
 * Called by `packages/convex/convex/siteCache.ts` whenever a post goes live,
 * comes down or a live post's content changes through MCP, the scheduler or
 * the Convex CLI. (The preview area's own Server Actions call `updateTag`
 * directly and do not need this.) Authorised by a shared secret:
 * `REVALIDATE_SECRET` here, `SITE_REVALIDATE_SECRET` in Convex.
 *
 * `{ expire: 0 }`, not the stale-while-revalidate `"max"` profile: when a post
 * is taken down, the very next visitor must not be served the old copy.
 *
 * Only the tags in `ALLOWED` can be invalidated, so the secret cannot be used
 * to thrash the rest of the site's cache.
 */
const ALLOWED = new Set<string>([POSTS_CACHE_TAG]);

function authorised(header: string | null): boolean {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(request: Request): Promise<Response> {
  if (!authorised(request.headers.get("authorization"))) {
    return Response.json({ ok: false, error: "unauthorised" }, { status: 401 });
  }

  let tags: unknown;
  try {
    tags = ((await request.json()) as { tags?: unknown }).tags;
  } catch {
    return Response.json({ ok: false, error: "invalid-json" }, { status: 400 });
  }
  if (!Array.isArray(tags) || tags.length === 0 || !tags.every((tag) => typeof tag === "string" && ALLOWED.has(tag))) {
    return Response.json({ ok: false, error: "unknown-tag" }, { status: 400 });
  }

  for (const tag of new Set(tags as string[])) revalidateTag(tag, { expire: 0 });
  return Response.json({ ok: true, revalidated: tags });
}
