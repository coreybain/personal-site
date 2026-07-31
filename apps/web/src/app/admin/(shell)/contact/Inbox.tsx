"use client";

import { api } from "@home/convex/api";
import type { Id } from "@home/convex/dataModel";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useState } from "react";

import {
  ActionButton,
  AdminButtonRow,
  AdminNotice,
  AdminPanel,
  DeleteButton,
  EntityTable,
  RowActions,
  formatInstant,
  usePendingAction,
} from "@/components/admin";

/**
 * The inbox: a filtered list, a detail view, and the five status transitions.
 *
 * ── Master *replaces* detail, rather than sitting beside it ─────────────────
 *
 * Opening a message swaps the table out for the message. Two panes would be the
 * obvious layout and would need a two-column grid the admin stylesheet does not
 * have — and more importantly, a detail panel stacked above or below a
 * hundred-row table is off-screen exactly when the row you clicked was low down.
 * Swapping keeps the read at the top of the viewport at any list length, needs no
 * new CSS, and the "Back to inbox" button is the whole cost.
 *
 * ── There is no `get` by id, on purpose ─────────────────────────────────────
 *
 * `packages/convex/convex/contactMessages.ts` exposes `list`, `counts`,
 * `setStatus` and `remove` — no single-document read. So the detail view is
 * rendered from the row already in the list subscription, which means it is live:
 * a status change pushes a new list and the detail re-renders from it without a
 * second round trip. The consequence to know about is that the selected id must
 * be re-looked-up in the (possibly refiltered) rows on every render, and can
 * legitimately go missing — a message deleted, or filtered out by the status that
 * was just applied to it. `selected === undefined` is handled below as "back to
 * the list", not as an error.
 */

type Message = FunctionReturnType<typeof api.contactMessages.list>[number];
type Status = Message["status"];

/**
 * The five states of `ContactStatusSchema`, in triage order, with the badge tone
 * each one gets.
 *
 * The tones are `data-state` values `admin.css` already styles, chosen for what
 * they mean rather than for the table they came from: `featured` is the sun colour
 * and marks the thing wanting attention, `published` is the accent and marks the
 * thing dealt with well, `revoked` is grey and marks the thing put away. `spam` has
 * its own rule in the stylesheet.
 *
 * A local list rather than the kit's `Badge`, whose `tone` union has no `spam` —
 * the kit deliberately does not enumerate every table's vocabulary, and this is
 * that vocabulary.
 */
const STATUSES = [
  { value: "new", label: "New", tone: "featured" },
  { value: "read", label: "Read", tone: undefined },
  { value: "replied", label: "Replied", tone: "published" },
  { value: "archived", label: "Archived", tone: "revoked" },
  { value: "spam", label: "Spam", tone: "spam" },
] as const satisfies readonly {
  value: Status;
  label: string;
  tone: string | undefined;
}[];

function StatusChip({ status }: { status: Status }) {
  const tone = STATUSES.find((entry) => entry.value === status)?.tone;

  return (
    <span className="adm-badge" data-state={tone}>
      {status}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Screen
 * ------------------------------------------------------------------ */

export function Inbox() {
  /**
   * `null` is "every status", which is a different read from any one status —
   * `contactMessages.list` uses `by_createdAt` for the first and
   * `by_status_createdAt` for the second, because a Convex index is only usable
   * from its leading field.
   */
  const [filter, setFilter] = useState<Status | null>(null);
  const [openId, setOpenId] = useState<Id<"contactMessages"> | null>(null);

  const rows = useQuery(
    api.contactMessages.list,
    filter === null ? {} : { status: filter },
  );
  const counts = useQuery(api.contactMessages.counts, {});

  /**
   * Re-derived every render rather than stored. The row in `rows` is the live
   * one; a copy taken at click time would show a stale status the moment a
   * transition landed.
   */
  const selected = rows?.find((row) => row._id === openId);

  if (openId !== null) {
    return (
      /* `selected` can legitimately be `undefined` — the message was deleted, or
         the status just applied to it moved it out of the active filter. The
         detail handles that itself; see the file header. */
      <MessageDetail message={selected} onClose={() => setOpenId(null)} />
    );
  }

  return (
    <EntityTable
      columns={[
        { key: "from", label: "From" },
        { key: "company", label: "Company" },
        { key: "received", label: "Received" },
        { key: "status", label: "Status" },
        { key: "actions", label: "", align: "right" },
      ]}
      toolbar={
        <StatusFilter value={filter} onChange={setFilter} counts={counts} />
      }
      loading={rows === undefined}
      empty={rows?.length === 0}
      emptyTitle={
        filter === null ? "No messages yet" : `Nothing marked ${filter}`
      }
      emptyBody={
        filter === null
          ? "The public form at /contact writes here. Nothing else does."
          : "Clear the filter to see the rest of the inbox."
      }
    >
      {rows?.map((row) => (
        <tr key={row._id}>
          <td>
            {/* A button rather than a link: opening a message is a state change
                in this component, not a navigation, so there is no URL to give an
                anchor. Styled as the row's title with `.adm-cell-primary`. */}
            <button
              type="button"
              className="adm-cell-primary"
              style={{
                /* No `.adm-*` class turns a button into inline text, and adding
                   one would mean editing the shared stylesheet. Four properties,
                   no colours. */
                background: "none",
                border: 0,
                padding: 0,
                font: "inherit",
                textAlign: "left",
                cursor: "pointer",
              }}
              onClick={() => setOpenId(row._id)}
            >
              {row.name}
            </button>
            <div className="adm-micro adm-mono">{row.email}</div>
          </td>

          <td>{row.company ?? <span className="adm-micro">—</span>}</td>

          <td data-numeric="true">{formatInstant(row.createdAt)}</td>

          <td>
            <StatusChip status={row.status} />
          </td>

          <td data-align="right">
            <RowActions>
              <ActionButton
                size="sm"
                variant="ghost"
                onAction={async () => setOpenId(row._id)}
              >
                Open
              </ActionButton>
            </RowActions>
          </td>
        </tr>
      ))}
    </EntityTable>
  );
}

/* ------------------------------------------------------------------ *
 * Filter
 * ------------------------------------------------------------------ */

/**
 * Status filter as buttons with counts, not a `<select>`.
 *
 * The counts are the reason. `contactMessages.counts` is a separate query
 * precisely so the badge on each state can be rendered without fetching message
 * bodies, and a native `<select>` cannot show five numbers at once — which is the
 * one thing this control is for. Five closed options with a number each is a
 * button group.
 *
 * `aria-pressed` rather than a made-up role: these are toggles over one shared
 * value, and a screen reader gets "New, pressed" for free.
 */
function StatusFilter({
  value,
  onChange,
  counts,
}: {
  value: Status | null;
  onChange: (value: Status | null) => void;
  counts: FunctionReturnType<typeof api.contactMessages.counts> | undefined;
}) {
  const total =
    counts === undefined
      ? undefined
      : counts.new + counts.read + counts.replied + counts.archived;

  return (
    <AdminButtonRow>
      <button
        type="button"
        className="adm-btn"
        data-size="sm"
        data-variant={value === null ? "primary" : "ghost"}
        aria-pressed={value === null}
        onClick={() => onChange(null)}
      >
        {/* Deliberately not `total + counts.spam`: "everything" here means every
            row the list query returns, and it does return spam. The number is the
            correspondence count, which is the useful one, and the Spam button
            below carries its own. */}
        All{total === undefined ? "" : ` · ${total}`}
      </button>

      {STATUSES.map((status) => (
        <button
          key={status.value}
          type="button"
          className="adm-btn"
          data-size="sm"
          data-variant={value === status.value ? "primary" : "ghost"}
          aria-pressed={value === status.value}
          onClick={() => onChange(status.value)}
        >
          {status.label}
          {counts === undefined ? "" : ` · ${counts[status.value]}`}
        </button>
      ))}
    </AdminButtonRow>
  );
}

/* ------------------------------------------------------------------ *
 * Detail
 * ------------------------------------------------------------------ */

function MessageDetail({
  message,
  onClose,
}: {
  message: Message | undefined;
  onClose: () => void;
}) {
  const setStatus = useMutation(api.contactMessages.setStatus);
  const remove = useMutation(api.contactMessages.remove);

  /** Shared by every transition button and the delete, so no two can race. */
  const action = usePendingAction();

  /**
   * Marking read on open, as a side effect of looking at it.
   *
   * `setStatus` is explicitly a no-op-that-succeeds when the message is already in
   * the requested state, which is what makes this safe to fire from an effect that
   * re-runs: the subscription pushes `status: 'read'`, the effect re-runs, the
   * guard is now false, and nothing more is sent.
   *
   * Its own `usePendingAction` rather than the shared one, because a background
   * transition must not disable the buttons the reader is about to press, and
   * `run()` never throws so an offline tab does not surface an error dialog for a
   * transition nobody asked for. The failure is reported quietly below.
   */
  const autoRead = usePendingAction();
  const { run: runAutoRead } = autoRead;
  const messageId = message?._id;
  const isNew = message?.status === "new";

  useEffect(() => {
    if (messageId === undefined || !isNew) {
      return;
    }

    void runAutoRead(() => setStatus({ messageId, status: "read" }));
    /* `runAutoRead` is destructured rather than reached through `autoRead` so the
       dependency list can be complete without re-running on every parent render:
       `usePendingAction` returns a fresh object each render but a `useCallback`d
       `run`, and `useMutation` returns a stable function. */
  }, [messageId, isNew, runAutoRead, setStatus]);

  if (message === undefined) {
    return (
      <>
        <BackToInbox onClose={onClose} />

        <AdminPanel title="That message is gone">
          <AdminNotice tone="warn">
            It was either deleted, or the status you just set moved it out of
            the filter you are looking at. Both are normal.
          </AdminNotice>
        </AdminPanel>
      </>
    );
  }

  /**
   * A prefilled reply, opened in whatever the machine's mail client is.
   *
   * There is no send-from-the-admin path and there should not be: a reply sent by
   * a Convex action would come from a no-reply address and land outside the
   * thread, where the follow-up would be invisible. `mailto:` puts the
   * correspondence in the place correspondence belongs, and the "Replied" button
   * next to it is the record that it happened.
   */
  const mailto = `mailto:${encodeURIComponent(message.email)}?subject=${encodeURIComponent(
    `Re: your note via coreybaines.com`,
  )}`;

  return (
    <>
      <BackToInbox onClose={onClose} />

      <AdminPanel
        title={message.name}
        headerEnd={<StatusChip status={message.status} />}
        footer={
          <AdminButtonRow>
            <a className="adm-btn" data-variant="primary" href={mailto}>
              Reply by email
            </a>

            {/*
              The transitions, tightened into one labelled group.

              They used to be four buttons each reading "Mark archived", in a row
              that also held Back, Reply and Delete — seven controls, four of which
              repeated the same verb, and the row wrapped to two lines on a laptop.
              One "Mark" label in front of them says the verb once and turns four
              buttons into one control with four settings, which is what they are.
              The nested `.adm-btn-row` is what keeps the label attached to its
              buttons when the footer wraps.

              Each button keeps a full accessible name, because the visible text is
              now a bare adjective and "Archived" read out of context is a state
              rather than an action. The name is completed with a `.adm-sr-only`
              span inside the label rather than with `aria-label`: `ActionButton`
              takes `title` but not `aria-label`, and hidden text inside the button
              is the same computed name without a kit change. The group gets no
              `role="group"` — its accessible name would have to duplicate the
              visible "Mark", and four correctly-named buttons was never the part
              that was hard to use.
            */}
            <span className="adm-btn-row">
              <span className="adm-eyebrow">Mark</span>

              {/* Every state except the current one. Rendering the current state as
                  a disabled button would be five controls where four are the
                  answer; omitting it makes the row read as "what can I do next". */}
              {STATUSES.filter((status) => status.value !== message.status).map(
                (status) => (
                  <ActionButton
                    key={status.value}
                    size="sm"
                    variant="ghost"
                    action={action}
                    quiet
                    title={`Mark this message ${status.label.toLowerCase()}`}
                    onAction={() =>
                      setStatus({
                        messageId: message._id,
                        status: status.value,
                      })
                    }
                  >
                    <span className="adm-sr-only">Mark this message </span>
                    {status.label}
                  </ActionButton>
                ),
              )}
            </span>

            <DeleteButton
              action={action}
              name={message.name}
              label="Delete"
              onAction={async () => {
                await remove({ messageId: message._id });
                /* The row is gone, so the detail has nothing to render. Leave
                   before the subscription pushes an absence. */
                onClose();
              }}
            />
          </AdminButtonRow>
        }
      >
        <dl className="adm-status">
          <div>
            <dt>from</dt>
            <dd>
              <a className="adm-link adm-mono" href={mailto}>
                {message.email}
              </a>
            </dd>
          </div>
          {message.company === undefined ? null : (
            <div>
              <dt>company</dt>
              <dd>{message.company}</dd>
            </div>
          )}
          <div>
            <dt>received</dt>
            <dd>{formatInstant(message.createdAt)}</dd>
          </div>
        </dl>

        {/* `white-space: pre-wrap` inline because the body is the one place in the
            admin that renders someone else's typing: their paragraph breaks are
            meaning, and no `.adm-*` class preserves them. Rendered as text, never
            as markup — this string arrived from an anonymous public form. */}
        <p
          style={{
            whiteSpace: "pre-wrap",
            marginTop: "0.9rem",
            maxWidth: "68ch",
          }}
        >
          {message.message}
        </p>

        {message.attachments === undefined ||
        message.attachments.length === 0 ? null : (
          <div className="adm-contact-attachments">
            <div className="adm-eyebrow">
              Attachments · {message.attachments.length}
            </div>
            <ul>
              {message.attachments.map((attachment) => (
                <li key={attachment.storageKey}>
                  <a
                    className="adm-link"
                    href={attachment.url}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {attachment.name}
                  </a>
                  <span className="adm-micro adm-mono">
                    {attachment.contentType} ·{" "}
                    {Math.max(1, Math.round(attachment.size / 1024))} KB
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {action.failure ? (
          <p className="adm-error" role="alert">
            {action.failure.message}
          </p>
        ) : null}

        {autoRead.failure ? (
          <p className="adm-micro" role="status">
            Could not mark this read: {autoRead.failure.message}
          </p>
        ) : null}
      </AdminPanel>
    </>
  );
}

/**
 * "← Inbox", above the message.
 *
 * The kit's `BackLink` cannot be used here and that is the whole reason this
 * exists: opening a message is a state change in `Inbox`, not a navigation, so
 * there is no href for a `<Link>` to take. What it *can* do is match — the return
 * path on a detail screen belongs at the top of the content column, immediately
 * above the title, on this screen exactly as on `/admin/experience/[id]`, and a
 * button that sits in the footer instead is a different screen shape for no reason
 * the reader can see.
 *
 * `.adm-back` with four resets, following the precedent set by the row's own title
 * button above: no `.adm-*` class turns a `<button>` into inline text, and adding
 * one would mean editing the shared stylesheet. None of the four is a colour or a
 * size — every visual property still comes from the class, which is what keeps this
 * looking like the real `BackLink` when that one changes.
 *
 * `fontFamily` and not `font`: the shorthand would set `font-size` inline, and an
 * inline declaration beats the class, so `.adm-back`'s 12px would lose to the
 * inherited body size. Only the family needs overriding — that is the one property
 * a `<button>` takes from the UA stylesheet rather than from its ancestors.
 */
function BackToInbox({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      className="adm-back"
      style={{
        background: "none",
        border: 0,
        fontFamily: "inherit",
        cursor: "pointer",
        /* The header's version gets its spacing from `.adm-page-head`'s flex gap.
           This one is a sibling of a panel, so it supplies its own — the same
           token, so the two screens sit on the same rhythm. */
        marginBottom: "var(--adm-snug)",
      }}
      onClick={onClose}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 20 20"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 4.6L6.6 10l5.4 5.4" />
      </svg>
      Inbox
    </button>
  );
}
