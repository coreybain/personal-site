"use client";

import { api } from "@home/convex/api";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  AdminButtonRow,
  AdminForm,
  AdminNotice,
  AdminPanel,
  SaveButton,
  usePendingAction,
} from "@/components/admin";

import {
  FunFields,
  emptyFunDraft,
  funLocationFrom,
  type FunDraft,
} from "../FunFields";

/**
 * `/admin/fun/new` — add an entry by hand.
 *
 * There is no publish step: `funEntries` has no `published` field, so pressing the
 * button puts a photo and a sentence on the public /fun grid. The notice below says
 * so, because every other create form in this admin makes a draft.
 *
 * The Snapshot lag is worth knowing and is mentioned too: `snapshot.latestFunEntry`
 * is a denormalised copy rebuilt by an hourly cron (ADR 004, phase 4), so the
 * homepage's life-signal strip will not mention this entry until the next tick.
 * That is documented on the mutation and is not something this screen can fix.
 */
export function NewFunEntryForm() {
  const router = useRouter();
  const create = useMutation(api.funEntries.create);
  const save = usePendingAction();

  const [draft, setDraft] = useState<FunDraft>(emptyFunDraft);

  /**
   * The two arguments that have no absent form, and so cannot be left to the
   * mutation to refuse.
   *
   * `photo` and `occurredAt` are **required** by `funEntries.create`'s validator, so
   * with either missing there is no call to make — Convex would reject the arguments
   * before the handler ran, with a message about a validator rather than about a
   * photo. Everything conditional (a walk's `steps`, a beer's `note`, half a
   * coordinate) is left to `assertKind` and reported at its field.
   */
  const blocked = draft.photo === null || draft.occurredAt === null;

  return (
    /* No panel title: it said "New entry", which the page header already says two
       lines above. One panel on a screen does not need naming. */
    <AdminPanel
      footer={
        <AdminButtonRow>
          <SaveButton
            action={save}
            label="Add entry"
            disabled={blocked}
            title={
              blocked
                ? "An entry needs a photo and a date before it can be saved."
                : undefined
            }
            onAction={async () => {
              /* Narrowed here rather than trusted from `disabled`, which is a UI
                 state. Unreachable in practice; caught and shown if not. */
              if (draft.photo === null || draft.occurredAt === null) {
                throw new Error("An entry needs a photo and a date.");
              }

              const location = funLocationFrom(draft);

              const created = await create({
                type: draft.type,
                title: draft.title,
                photo: draft.photo,
                occurredAt: draft.occurredAt,
                /* Optional arguments are *omitted*, never sent empty. `note: ''`
                   would be trimmed to absent by the mutation and `rating: null` is
                   not in `create`'s validator at all (only `update` has the
                   nullable form, because only an update can clear a field). The
                   walk metrics are sent only on a walk — `assertKind` forbids them
                   on the other three kinds. */
                ...(draft.note.trim().length > 0
                  ? { note: draft.note }
                  : {}),
                ...(draft.rating !== null ? { rating: draft.rating } : {}),
                ...(location !== null ? { location } : {}),
                ...(draft.type === "walk" && draft.steps !== null
                  ? { steps: draft.steps }
                  : {}),
                ...(draft.type === "walk" && draft.km !== null
                  ? { km: draft.km }
                  : {}),
              });

              /* Straight to the editor for the row that was just created — the
                 usual next action is to fix the note or add the rating that was
                 forgotten. `push`, so Back returns to this form. */
              router.push(`/admin/fun/${created.entryId}`);

              return created;
            }}
          />
        </AdminButtonRow>
      }
    >
      <AdminForm>
        <AdminNotice tone="warn" title="This publishes immediately">
          Fun Entries have no draft state. Saving puts this photo on <code>/fun</code>{" "}
          — the only way to take it back is to delete it.
        </AdminNotice>

        <FunFields
          draft={draft}
          onDraftChange={setDraft}
          failure={save.failure}
          disabled={save.pending}
        />
      </AdminForm>
    </AdminPanel>
  );
}
