"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";

import { postAction, type ActionState } from "@/app/(site)/preview/actions";

type Status = "draft" | "scheduled" | "failed" | "published" | "published_with_changes" | "changes_scheduled" | "changes_failed";

/**
 * The action bar at the top of a post preview. What it offers depends on the
 * post's state (docs/plans/preview-area.md, decision 5). Publish, unpublish and
 * discard ask for confirmation with a second click; scheduling asks only when
 * the time is less than an hour away. Times are Sydney wall-clock times.
 */
export function PreviewBar({
  postId,
  expectedKey,
  status,
  publicSlug,
  scheduleLabel,
  failure,
  defaultDate,
  defaultTime,
  timeZoneLabel,
}: {
  postId: string;
  expectedKey: string;
  status: Status;
  publicSlug: string;
  scheduleLabel: string | null;
  failure: string | null;
  defaultDate: string;
  defaultTime: string;
  timeZoneLabel: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(async (previous, form) => {
    const result = await postAction(previous, form);
    if (result?.ok) {
      setConfirming(null);
      setScheduling(false);
      router.refresh();
    }
    return result;
  }, null);

  const live = status === "published" || status === "published_with_changes" || status === "changes_scheduled" || status === "changes_failed";
  const pendingChanges = status === "published_with_changes" || status === "changes_scheduled" || status === "changes_failed";
  const scheduled = status === "scheduled" || status === "failed" || status === "changes_scheduled" || status === "changes_failed";
  const canPublish = status !== "published";

  const hidden = (
    <>
      <input type="hidden" name="postId" value={postId} />
      <input type="hidden" name="expectedKey" value={expectedKey} />
    </>
  );

  /** A submit button that needs a second click to confirm. */
  const confirmButton = (name: string, label: string, confirmLabel: string, tone: "primary" | "ghost" | "danger" = "ghost") => (
    confirming === name ? (
      <span className="pv-confirm">
        <button type="submit" name="action" value={name} className={`hor-btn ${tone === "danger" ? "pv-btn-danger" : ""}`} disabled={pending}>
          {pending ? "Working…" : confirmLabel}
        </button>
        <button type="button" className="pv-link" onClick={() => setConfirming(null)}>Cancel</button>
      </span>
    ) : (
      <button type="button" className={`hor-btn ${tone === "primary" ? "" : "hor-btn-ghost"}`} onClick={() => setConfirming(name)} disabled={pending}>
        {label}
      </button>
    )
  );

  return (
    <div className="pv-bar" role="region" aria-label="Preview actions">
      <form action={action} className="pv-bar-inner">
        {hidden}
        <div className="pv-bar-status">
          {scheduleLabel ? <span>{pendingChanges ? "Changes scheduled for" : "Scheduled for"} <strong>{scheduleLabel}</strong></span> : null}
          {failure ? <span className="pv-error">Couldn&apos;t publish: {failure}</span> : null}
          {status === "draft" ? <span>Draft — not public</span> : null}
          {status === "published" ? <span>Live — no pending changes</span> : null}
          {status === "published_with_changes" ? <span>Live — these changes aren&apos;t public yet</span> : null}
          {live ? <a className="pv-link" href={`/blog/${publicSlug}`} target="_blank" rel="noreferrer">View live post ↗</a> : null}
        </div>

        <div className="pv-bar-actions">
          {canPublish ? confirmButton("publish", pendingChanges ? "Publish changes" : "Publish now", pendingChanges ? "Confirm: publish changes" : "Confirm: publish now", "primary") : null}
          {canPublish ? (
            <button type="button" className="hor-btn hor-btn-ghost" onClick={() => setScheduling((value) => !value)}>
              {scheduled ? "Change time" : pendingChanges ? "Schedule changes" : "Schedule"}
            </button>
          ) : null}
          {scheduled ? (
            <button type="submit" name="action" value="unschedule" className="hor-btn hor-btn-ghost" disabled={pending}>Cancel schedule</button>
          ) : null}
          {pendingChanges ? confirmButton("discard", "Discard changes", "Confirm: discard changes", "danger") : null}
          {live ? confirmButton("unpublish", "Move back to draft", "Confirm: take it down", "danger") : null}
        </div>
      </form>

      {scheduling ? (
        <form action={action} className="pv-schedule" onSubmit={(event) => {
          const form = new FormData(event.currentTarget);
          const at = Date.parse(`${form.get("date")}T${form.get("time")}:00`);
          // Rough, browser-local check only to decide whether to ask; the server converts exactly from Sydney time.
          if (Number.isFinite(at) && at - Date.now() < 60 * 60 * 1000 && !window.confirm("That's less than an hour away. Schedule it?")) {
            event.preventDefault();
          }
        }}>
          {hidden}
          <input type="hidden" name="action" value="schedule" />
          <label className="pv-field">
            <span className="hor-eyebrow">Date</span>
            <input type="date" name="date" defaultValue={defaultDate} className="pv-input" required />
          </label>
          <label className="pv-field">
            <span className="hor-eyebrow">Time ({timeZoneLabel})</span>
            <input type="time" name="time" defaultValue={defaultTime} className="pv-input" step={60} required />
          </label>
          <button type="submit" className="hor-btn" disabled={pending}>{pending ? "Saving…" : "Save schedule"}</button>
        </form>
      ) : null}

      {state ? <p className={state.ok ? "pv-ok" : "pv-error"} role="status">{state.message}</p> : null}
    </div>
  );
}
