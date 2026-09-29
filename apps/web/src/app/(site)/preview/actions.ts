"use server";

/**
 * Server Actions for the preview area (docs/plans/preview-area.md).
 *
 * Every action reads the session from the httpOnly cookie and hands it to
 * Convex, which re-checks it — the browser never holds or sends it itself.
 * Next checks the Origin of every Server Action request against the host, so a
 * page on another site cannot trigger these.
 *
 * Actions that change what the public site shows call `updateTag("posts")`, so
 * the next public request waits for fresh data instead of serving the old
 * copy. Convex also revalidates through /api/revalidate; the two overlap on
 * purpose.
 */
import { ConvexError } from "convex/values";
import { cookies } from "next/headers";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";

import { api } from "@home/convex/api";
import type { Id } from "@home/convex/dataModel";

import { POSTS_CACHE_TAG } from "@/lib/data";
import { PREVIEW_COOKIE, SESSION_MAX_AGE, previewClient, readSessionCookie } from "@/lib/preview";
import { sydneyToUtc } from "@/lib/sydneyTime";

export type ActionState = { ok: boolean; message: string } | null;

function messageOf(error: unknown): string {
  if (error instanceof ConvexError && error.data && typeof error.data === "object") {
    const message = (error.data as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Something went wrong. Reload and try again.";
}

async function requireSession(): Promise<string> {
  const session = await readSessionCookie();
  if (!session) redirect("/preview");
  // Roll the browser's cookie forward with the Convex-side session.
  (await cookies()).set(PREVIEW_COOKIE, session, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE,
  });
  return session;
}

/* ------------------------------------------------------------------ *
 * Signing in and out
 * ------------------------------------------------------------------ */

export async function redeemCode(_state: ActionState, form: FormData): Promise<ActionState> {
  const code = String(form.get("code") ?? "").slice(0, 32);
  if (!code.trim()) return { ok: false, message: "Enter the code." };
  let result;
  try {
    result = await previewClient().mutation(api.previewAccess.redeem, { code });
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
  if (!result.ok) return { ok: false, message: result.message };
  (await cookies()).set(PREVIEW_COOKIE, result.session, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE,
  });
  redirect("/preview");
}

export async function signOut(): Promise<void> {
  const session = await readSessionCookie();
  if (session) {
    await previewClient().mutation(api.previewAccess.signOut, { session }).catch(() => null);
  }
  (await cookies()).delete(PREVIEW_COOKIE);
  redirect("/preview");
}

/* ------------------------------------------------------------------ *
 * Post actions
 * ------------------------------------------------------------------ */

type PostAction = "publish" | "schedule" | "unschedule" | "unpublish" | "discard";

export async function postAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  const action = String(form.get("action")) as PostAction;
  const postId = String(form.get("postId")) as Id<"posts">;
  const expectedKey = String(form.get("expectedKey"));
  const client = previewClient();

  try {
    switch (action) {
      case "publish": {
        await client.mutation(api.preview.publishNow, { session, postId, expectedKey });
        updateTag(POSTS_CACHE_TAG);
        return { ok: true, message: "Published. It's live now." };
      }
      case "schedule": {
        const scheduledFor = sydneyToUtc(String(form.get("date")), String(form.get("time")));
        if (!scheduledFor) return { ok: false, message: "Pick a date and a time." };
        await client.mutation(api.preview.schedule, { session, postId, expectedKey, scheduledFor });
        return { ok: true, message: "Scheduled." };
      }
      case "unschedule": {
        await client.mutation(api.preview.unschedule, { session, postId });
        return { ok: true, message: "Schedule cancelled." };
      }
      case "unpublish": {
        await client.mutation(api.preview.unpublish, { session, postId, expectedKey });
        updateTag(POSTS_CACHE_TAG);
        return { ok: true, message: "Moved back to draft. It's no longer public." };
      }
      case "discard": {
        await client.mutation(api.preview.discardChanges, { session, postId, expectedKey });
        return { ok: true, message: "Pending changes discarded." };
      }
      default:
        return { ok: false, message: "Unknown action." };
    }
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

/* ------------------------------------------------------------------ *
 * Feedback (called from the client with plain arguments)
 * ------------------------------------------------------------------ */

type Reaction = "love" | "unclear" | "dislike" | null;
type Anchor =
  | { kind: "text"; quote: string; prefix: string; suffix: string }
  | { kind: "image"; src: string; alt: string };

async function feedbackCall(run: (session: string) => Promise<unknown>): Promise<ActionState> {
  const session = await requireSession();
  try {
    await run(session);
    return { ok: true, message: "" };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export async function addFeedback(postId: string, anchor: Anchor, reaction: Reaction, note: string | null): Promise<ActionState> {
  return feedbackCall((session) => previewClient().mutation(api.preview.addFeedback, {
    session, postId: postId as Id<"posts">, anchor, reaction, note,
  }));
}

export async function updateFeedback(feedbackId: string, change: { reaction?: Reaction; note?: string | null }): Promise<ActionState> {
  return feedbackCall((session) => previewClient().mutation(api.preview.updateFeedback, {
    session, feedbackId: feedbackId as Id<"postFeedback">, ...change,
  }));
}

export async function reopenFeedback(feedbackId: string): Promise<ActionState> {
  return feedbackCall((session) => previewClient().mutation(api.preview.reopenFeedback, {
    session, feedbackId: feedbackId as Id<"postFeedback">,
  }));
}

export async function removeFeedback(feedbackId: string): Promise<ActionState> {
  return feedbackCall((session) => previewClient().mutation(api.preview.removeFeedback, {
    session, feedbackId: feedbackId as Id<"postFeedback">,
  }));
}
