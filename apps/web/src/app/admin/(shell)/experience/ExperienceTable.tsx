"use client";

import { api } from "@home/convex/api";
import type { Doc } from "@home/convex/dataModel";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import {
  AdminNotice,
  DeleteButton,
  EntityTable,
  RowActions,
  ToolbarEnd,
  formatMonth,
  usePendingAction,
} from "@/components/admin";

/**
 * The roles, in résumé order, with reorder and delete.
 *
 * ── Order, and why the numbers look odd ─────────────────────────────────────
 *
 * `by_sortOrder` ascending is the order the résumé prints, and a résumé prints the
 * newest role first — so the **lowest** sort order is the top of the document.
 * `experienceEntries.create` therefore defaults a new row to *one below the current
 * lowest* rather than appending, because the role being added is almost always the
 * one just started. Nothing is renumbered on insert, which is why the values drift
 * negative over time and why the column below shows gaps. That is healthy: the
 * numbers are only ever compared to each other.
 *
 * ── Reorder is one transaction ──────────────────────────────────────────────
 *
 * `swapSortOrder` exchanges a row with its neighbour atomically and rebuilds the
 * résumé once. The single-row mutation remains only for repairing historical
 * duplicate weights, where there is no meaningful value to swap.
 *
 * Up/down buttons rather than drag-and-drop, per the kit: the keyboard
 * implementation of drag-and-drop *is* a pair of move buttons.
 */

/** What every write here reports back about the projection it rebuilt. */
type ResumeEcho = { synced: boolean; roles: number };

export function ExperienceTable() {
  const rows = useQuery(api.experienceEntries.list, {});
  const setSortOrder = useMutation(api.experienceEntries.setSortOrder);
  const swapSortOrder = useMutation(api.experienceEntries.swapSortOrder);
  const remove = useMutation(api.experienceEntries.remove);

  /**
   * One pending state for all the move buttons, so a second click while a swap is
   * in flight is dropped. The backend swap is atomic, but accepting two gestures
   * against the same stale list would make the second one an avoidable conflict.
   *
   * The delete buttons deliberately do **not** share it: `DeleteButton` renders the
   * failure of whatever action it is given inline, and a shared one would print a
   * move's error in every row at once. Each delete owns a private state, which is
   * exactly the case the kit's default is for. A delete racing a move is harmless —
   * `remove` is idempotent and `setSortOrder` reports `not-found` for a row that has
   * gone.
   */
  const moving = usePendingAction();

  /**
   * The last write's `resume` field.
   *
   * Worth surfacing because `synced: false` is the one non-obvious outcome in this
   * screen: it means there is no résumé document to project into yet, which is a
   * successful no-op rather than a failure — entries may legitimately be authored
   * before the singleton exists. The honest instruction is "go and save the
   * résumé", and it is not something the row itself can show.
   */
  const [echo, setEcho] = useState<ResumeEcho | null>(null);

  const move = async (rows: readonly Doc<"experienceEntries">[], index: number, delta: number) => {
    const from = rows[index];
    const to = rows[index + delta];

    if (from === undefined || to === undefined) {
      return;
    }

    if (from.sortOrder === to.sortOrder) {
      /* Two rows holding the same value: their relative order is the index's
         choice, not the admin's, so a swap is a no-op. Nudge this one past the
         other instead, which also repairs the state a half-completed swap left. */
      const answer = await setSortOrder({
        entryId: from._id,
        sortOrder: delta < 0 ? from.sortOrder - 1 : from.sortOrder + 1,
        expectedRevision: from.revision ?? 0,
      });
      setEcho(answer.resume);
      return;
    }

    const answer = await swapSortOrder({
      firstEntryId: from._id,
      secondEntryId: to._id,
      firstExpectedRevision: from.revision ?? 0,
      secondExpectedRevision: to.revision ?? 0,
    });
    setEcho(answer.resume);
  };

  return (
    <>
      {echo !== null && !echo.synced ? (
        <AdminNotice tone="warn" title="The résumé document does not exist yet">
          The write succeeded and the entry is stored, but there is nothing to
          project it into. Save the résumé at <Link href="/admin/resume">/admin/resume</Link>{" "}
          and its work history is built from these{" "}
          {echo.roles === 1 ? "1 entry" : `${echo.roles} entries`} as part of that
          write.
        </AdminNotice>
      ) : null}

      <EntityTable
        columns={[
          { key: "role", label: "Role" },
          { key: "period", label: "Period" },
          { key: "highlights", label: "Highlights", align: "right" },
          { key: "order", label: "Order", align: "right" },
          { key: "actions", label: "", align: "right" },
        ]}
        toolbar={
          <>
            {/* The one orienting fact this table needs and cannot show: the rows
                are in *print* order, so "up" means further up the résumé rather
                than newer or older. Eight words, and it stays inline — the
                ↑/↓ buttons are meaningless without it, which makes it part of the
                control rather than commentary on it. The rest of what used to be
                explained here (why the sort numbers are negative and gappy) is in
                the page header's tooltip. */}
            <span className="adm-micro">
              Top of this list is the top of the résumé.
            </span>
            <ToolbarEnd>
              {echo !== null && echo.synced ? (
                <span className="adm-eyebrow" role="status">
                  résumé rebuilt · {echo.roles}{" "}
                  {echo.roles === 1 ? "role" : "roles"}
                </span>
              ) : null}
            </ToolbarEnd>
          </>
        }
        loading={rows === undefined}
        empty={rows?.length === 0}
        emptyTitle="No roles yet"
        emptyBody="The résumé's work history is built from this table, so it prints empty until there is one."
        emptyAction={
          <Link
            href="/admin/experience/new"
            className="adm-btn"
            data-variant="primary"
          >
            Add the first role
          </Link>
        }
      >
        {rows?.map((row, index) => (
          <tr key={row._id}>
            <td>
              <Link
                href={`/admin/experience/${row._id}`}
                className="adm-cell-primary"
              >
                {row.title}
              </Link>
              <div className="adm-micro">{row.company}</div>
            </td>

            <td data-numeric="true">
              {/* Month precision, string-sliced. A calendar day must never go
                  through `Date` — see the header of the kit's datetime.ts for the
                  day-drift bug that avoids. `null` endDate is the current role and
                  the résumé prints it as "Present". */}
              {formatMonth(row.startDate)} →{" "}
              {row.endDate === null ? "Present" : formatMonth(row.endDate)}
            </td>

            <td data-align="right" data-numeric="true">
              {row.highlights.length}
            </td>

            <td data-align="right" data-numeric="true">
              {row.sortOrder}
            </td>

            <td data-align="right">
              <RowActions>
                <button
                  type="button"
                  className="adm-btn"
                  data-size="sm"
                  disabled={index === 0 || moving.pending}
                  /* The glyph is not a name. `aria-label` is what a screen reader
                     announces; `title` is the sighted hover explanation. */
                  aria-label={`Move ${row.title} up`}
                  title="Move towards the top of the résumé"
                  onClick={() => {
                    void moving.run(() => move(rows, index, -1));
                  }}
                >
                  <span aria-hidden="true">↑</span>
                </button>
                <button
                  type="button"
                  className="adm-btn"
                  data-size="sm"
                  disabled={index === rows.length - 1 || moving.pending}
                  aria-label={`Move ${row.title} down`}
                  title="Move towards the bottom of the résumé"
                  onClick={() => {
                    void moving.run(() => move(rows, index, 1));
                  }}
                >
                  <span aria-hidden="true">↓</span>
                </button>

                <DeleteButton
                  name={row.title}
                  onAction={async () => {
                    const answer = await remove({
                      entryId: row._id,
                      expectedRevision: row.revision ?? 0,
                    });
                    setEcho(answer.resume);
                  }}
                />
              </RowActions>
            </td>
          </tr>
        ))}
      </EntityTable>

      {moving.failure ? (
        <p className="adm-error" role="alert">
          {moving.failure.message}
        </p>
      ) : null}
    </>
  );
}
