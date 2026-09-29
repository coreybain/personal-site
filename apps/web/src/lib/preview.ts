/**
 * preview.ts — the website's side of the private preview area.
 *
 * The session secret lives only in an httpOnly, Secure, SameSite=Lax cookie
 * and is read here, on the server, then passed to Convex (`convex/preview.ts`,
 * `convex/previewAccess.ts`), which checks it on every call. Nothing about the
 * session ever reaches browser JavaScript. See docs/plans/preview-area.md.
 *
 * Every read here is uncached and per-request: the preview must always show
 * the current draft, never a cached copy.
 */
import "server-only";

import { ConvexHttpClient } from "convex/browser";
import { cookies } from "next/headers";

import { api } from "@home/convex/api";

/** `__Host-` pins the cookie to this exact origin: Secure, Path=/, no Domain. */
export const PREVIEW_COOKIE = "__Host-preview";
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

export function previewClient(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is required for the preview area.");
  return new ConvexHttpClient(url, { logger: false });
}

/** The session secret from the cookie, if it is well-formed. Not yet validated. */
export async function readSessionCookie(): Promise<string | null> {
  const value = (await cookies()).get(PREVIEW_COOKIE)?.value ?? null;
  return value && /^pvs_[a-f0-9]{64}$/.test(value) ? value : null;
}

/**
 * A validated session, or null. Rolls the Convex-side expiry forward (at most
 * hourly). Cookie refresh happens in Server Actions, which can set cookies.
 */
export async function currentSession(): Promise<string | null> {
  const session = await readSessionCookie();
  if (!session) return null;
  const { valid } = await previewClient().mutation(api.previewAccess.touch, { session });
  return valid ? session : null;
}

export type PreviewListItem = Awaited<ReturnType<typeof listPreviewPosts>>[number];
export type PreviewPost = NonNullable<Awaited<ReturnType<typeof getPreviewPost>>>;

export async function listPreviewPosts(session: string) {
  return await previewClient().query(api.preview.listPosts, { session });
}

export async function getPreviewPost(session: string, slug: string) {
  return await previewClient().query(api.preview.getPost, { session, slug });
}
