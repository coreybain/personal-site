"use client";

import { api } from "@home/convex/api";
import type { Doc, Id } from "@home/convex/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  AdminButtonRow,
  AdminForm,
  AdminNotice,
  AdminPanel,
  Badge,
  DeleteButton,
  SaveButton,
  formatInstant,
  usePendingAction,
} from "@/components/admin";

import {
  FunFields,
  funDraftFromRow,
  funPatch,
  funTypeLabel,
  type FunDraft,
} from "../FunFields";

/**
 * `/admin/fun/[id]` — edit one entry.
 *
 * ── Why this route is keyed on an id and `/admin/posts/[slug]` is not ────────
 *
 * Because `funEntries` has no slug. Its docblock is explicit about it: an entry has
 * no page of its own — /fun is a grid — so it needs no URL, and `convex/funEntries.ts`
 * exports `get({ entryId })` and deliberately no `getBySlug`. This is the one
 * content table in the package addressed by id, and the id in the URL is a Convex
 * `Id<'funEntries'>`.
 *
 * A URL segment is a `string`, so the cast below is unavoidable. It is also the one
 * way this screen can crash: an id-shaped string that is not a real id fails
 * `v.id('funEntries')` inside the query and `useQuery` throws during render, which
 * an `error.tsx` in this directory catches. A *valid* id for a deleted row returns
 * `null` and is handled here as "no such entry".
 */

export function FunEditor({ entryId }: { entryId: string }) {
  /* The cast is a claim about the URL, not a check. See the file header for what
     happens when the claim is false. */
  const row = useQuery(api.funEntries.get, {
    entryId: entryId as Id<"funEntries">,
  });

  if (row === undefined) {
    return (
      <AdminPanel>
        <p className="adm-micro" role="status">
          Loading entry…
        </p>
      </AdminPanel>
    );
  }

  if (row === null) {
    /* No button back to the list: the page header above this panel carries a
       `BackLink` to it, and repeating the destination inside the panel was the
       kind of furniture this pass removed. */
    return (
      <AdminPanel title="No such entry">
        <AdminNotice tone="warn">
          Nothing is stored at that id. Fun Entries are deleted outright — there is
          no soft delete and no archive — so it is most likely gone for good.
        </AdminNotice>
      </AdminPanel>
    );
  }

  /* Remount when the URL moves to a different entry, so the previous entry's
     unsaved draft is discarded rather than shown against the new row. Same
     reasoning as `PostEditor`. */
  return <FunEditorForm key={row._id} row={row} />;
}

function FunEditorForm({ row }: { row: Doc<"funEntries"> }) {
  const router = useRouter();

  const update = useMutation(api.funEntries.update);
  const remove = useMutation(api.funEntries.remove);

  const save = usePendingAction();
  const write = usePendingAction();

  /**
   * Seeded once from the row and not synchronised to it afterwards — the Convex
   * subscription pushes a new `row` on every write to this document, and copying it
   * back into state would overwrite what is being typed at the moment a save lands.
   * The cost: a change made by the iOS app while this form is open is not visible
   * until a reload.
   */
  const [form, setForm] = useState(() => {
    const draft = funDraftFromRow(row);
    return {
      draft,
      savedDraft: draft,
      expectedRevision: row.revision ?? 0,
    };
  });
  const { draft, savedDraft, expectedRevision } = form;
  const setDraft = (next: FunDraft) =>
    setForm((current) => ({ ...current, draft: next }));
  const pendingPatch = funPatch(savedDraft, draft);
  const dirty = Object.keys(pendingPatch).length > 0;

  /* `photo` has no `null` in `funEntries.update`'s validator — a Fun Entry without
     a photo is a hole in the /fun grid — so removing the image holds the save
     rather than sending a call that cannot express what it means. `occurredAt` is
     the same: absent means "leave it", and there is no way to say "no date". */
  const missingPhoto = draft.photo === null;
  const missingDate = draft.occurredAt === null;
  const blocked = missingPhoto || missingDate;

  const kindChanged = draft.type !== savedDraft.type;

  return (
    <>
      <AdminPanel
        title="Entry"
        /* The paragraph that used to sit under the dates is now the tip. That this
           entry is public is said by the page header and by its "View on site"
           link; the cron lag on the homepage's life-signal strip is chrome —
           genuinely useful once, and not something to act on before editing. */
        info={
          <>
            Editing changes what <code>/fun</code> shows on the next read. The
            homepage&rsquo;s life-signal strip reads a denormalised copy rebuilt by
            an hourly cron (ADR 004), so it can lag behind by up to an hour.
          </>
        }
        infoLabel="About this entry"
        headerEnd={<Badge>{funTypeLabel(row.type)}</Badge>}
        footer={
          <AdminButtonRow>
            <DeleteButton
              action={write}
              size="md"
              name={row.title}
              disabled={save.pending}
              onAction={async () => {
                const result = await remove({
                  entryId: row._id,
                  expectedRevision,
                });
                /* The id has just stopped resolving; `replace` keeps a dead
                   editor out of the history. */
                router.replace("/admin/fun");
                return result;
              }}
            />
          </AdminButtonRow>
        }
      >
        <p className="adm-micro">
          Happened{" "}
          <span className="adm-mono">{formatInstant(row.occurredAt)}</span>
          {" · "}Added{" "}
          <span className="adm-mono">
            {/* `_creationTime` is epoch milliseconds; `occurredAt` is the RFC-3339
                instant the entry claims. The two differ by however long the photo
                sat on the phone, which is exactly why the schema stores both. */}
            {formatInstant(new Date(row._creationTime).toISOString())}
          </span>
        </p>
      </AdminPanel>

      <AdminPanel
        title="Content"
        footer={
          <AdminButtonRow>
            <SaveButton
              action={save}
              dirty={dirty}
              disabled={write.pending || blocked}
              title={
                missingPhoto
                  ? "An entry cannot be saved without a photo."
                  : missingDate
                    ? "An entry needs the date it happened."
                    : undefined
              }
              onAction={async () => {
                /* `funPatch` holds the only kind-awareness a client needs: which
                   of `steps`/`km` to send, given where the kind is going. Its
                   docblock has the reasoning. */
                if (Object.keys(pendingPatch).length === 0) {
                  return;
                }

                const result = await update({
                  entryId: row._id,
                  expectedRevision,
                  ...pendingPatch,
                });

                if (result.changed) {
                  setForm((current) => ({
                    ...current,
                    savedDraft: draft,
                    expectedRevision: result.revision,
                  }));
                }

                return result;
              }}
            />
          </AdminButtonRow>
        }
      >
        <AdminForm>
          {missingPhoto ? (
            <AdminNotice tone="warn" title="A photo is required">
              <code>funEntries.update</code> can replace the photo but not remove it.
              Upload a replacement below.
            </AdminNotice>
          ) : null}

          {kindChanged ? (
            <AdminNotice
              tone="warn"
              title={`Changing ${funTypeLabel(savedDraft.type).toLowerCase()} → ${funTypeLabel(draft.type).toLowerCase()}`}
            >
              {draft.type === "walk" ? (
                <>
                  A walk must carry both steps and distance. Fill them in below or
                  the save is refused by name.
                </>
              ) : (
                <>
                  The steps and distance stored on this entry are dropped in the
                  same write that changes the kind, and a note becomes required.
                </>
              )}
            </AdminNotice>
          ) : null}

          <FunFields
            draft={draft}
            onDraftChange={setDraft}
            failure={save.failure ?? write.failure}
            disabled={save.pending || write.pending}
          />
        </AdminForm>
      </AdminPanel>
    </>
  );
}
