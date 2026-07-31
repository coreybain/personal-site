"use client";

import { api } from "@home/convex/api";
import type { Doc, Id } from "@home/convex/dataModel";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import {
  ActionButton,
  EntityTable,
  formatInstant,
  InfoTip,
  RowActions,
  StatusBadge,
  ToolbarEnd,
  usePendingAction,
} from "@/components/admin";

/**
 * `/admin/labs` — every Lab, drafts included.
 *
 * The same shape as the case-study list, and for the same reasons: one
 * unpaginated `list({ includeDrafts: true })` because `setSortOrder` requires
 * every id in display order, a local sort that is kept distinct from the stored
 * order, and one shared pending state so two writes cannot race.
 *
 * What differs is the middle of the table. A Lab's interesting columns are the
 * repo it tracks and what the cron last read from it — stars and a sync time —
 * because "the cron has not run" is the failure this screen is most likely to be
 * looking at, and it is invisible on the public site (the card just shows zero).
 */

/** The local view. `order` is the stored one; the rest are for finding things. */
type SortMode = "order" | "title" | "stars";

const SORT_MODES: readonly { id: SortMode; label: string; title: string }[] = [
  {
    id: "order",
    label: "Display order",
    title: "The stored sortOrder — what /labs renders. Reordering is enabled here.",
  },
  { id: "title", label: "Title", title: "Alphabetical, for finding a row." },
  {
    id: "stars",
    label: "Stars",
    title: "Most stars first. Cron-written, so this is a read of GitHub, not a choice.",
  },
];

function sortRows(rows: readonly Doc<"labs">[], mode: SortMode): Doc<"labs">[] {
  /* Copied before sorting: the array belongs to the Convex subscription and
     `sort` mutates in place. */
  const copy = [...rows];

  switch (mode) {
    case "title":
      return copy.sort((a, b) => a.title.localeCompare(b.title, "en-AU"));
    case "stars":
      return copy.sort(
        (a, b) =>
          b.liveStats.stars - a.liveStats.stars || a.sortOrder - b.sortOrder,
      );
    case "order":
      return copy;
  }
}

export function LabsTable() {
  const rows = useQuery(api.labs.list, { includeDrafts: true, limit: 500 });

  const publish = useMutation(api.labs.publish);
  const unpublish = useMutation(api.labs.unpublish);
  const setFeatured = useMutation(api.labs.setFeatured);
  const setSortOrder = useMutation(api.labs.setSortOrder);

  /* One pending state for the table: every mutation here rewrites rows the other
     buttons act on, so any running write disables all of them. */
  const write = usePendingAction();

  const [mode, setMode] = useState<SortMode>("order");

  const ordered = rows === undefined ? undefined : sortRows(rows, mode);

  /**
   * Move one row one place, in the stored order.
   *
   * Built from the rows in *display* order rather than from the sorted view — see
   * the docblock on `ProjectsTable`. `setSortOrder` renumbers densely and skips
   * rows already at the right weight, so one swap is two writes.
   */
  function move(labId: Id<"labs">, delta: -1 | 1) {
    if (rows === undefined) {
      return;
    }

    const ids = rows.map((row) => row._id);
    const from = ids.indexOf(labId);
    const to = from + delta;

    if (from === -1 || to < 0 || to >= ids.length) {
      return;
    }

    [ids[from], ids[to]] = [ids[to], ids[from]];

    const revisionById = new Map(
      rows.map((row) => [row._id, row.revision ?? 0] as const),
    );
    void write.run(() =>
      setSortOrder({
        labIds: ids,
        expectedRevisions: ids.map((id) => revisionById.get(id) ?? 0),
      }),
    );
  }

  return (
    <EntityTable
      columns={[
        { key: "title", label: "Lab" },
        { key: "status", label: "Status" },
        { key: "stats", label: "GitHub" },
        { key: "order", label: "Order", align: "right" },
        { key: "actions", label: "", align: "right" },
      ]}
      toolbar={
        <>
          <span className="adm-eyebrow">Sort</span>
          {/* Same tip as the case-study list, plus the one fact specific to
              this table: the star count is a read of GitHub rather than a
              choice, so sorting by it is not a way to reorder the site. */}
          <InfoTip label="About sorting and display order">
            <strong>Display order</strong> is the stored <code>sortOrder</code>{" "}
            that <code>/labs</code> renders, and the only mode the move arrows
            work in. Title and stars are a local view for finding a row — and
            stars are cron-written, so that one is a read of GitHub, not a
            decision.
          </InfoTip>

          {SORT_MODES.map((option) => (
            <button
              key={option.id}
              type="button"
              className="adm-btn"
              data-size="sm"
              data-variant={mode === option.id ? "primary" : "ghost"}
              aria-pressed={mode === option.id}
              title={option.title}
              onClick={() => setMode(option.id)}
            >
              {option.label}
            </button>
          ))}

          <ToolbarEnd>
            <span className="adm-micro">
              {rows === undefined
                ? "Loading…"
                : `${rows.length} total · ${rows.filter((row) => !row.published).length} draft`}
            </span>
          </ToolbarEnd>
        </>
      }
      loading={rows === undefined}
      empty={ordered?.length === 0}
      emptyTitle="No Labs yet"
      emptyBody="A Lab is a repo built for its own sake — no client, no invoice — and it is curated in by hand (ADR 014) rather than synced from a GitHub account."
      emptyAction={
        <Link href="/admin/labs/new" className="adm-btn" data-variant="primary">
          New Lab
        </Link>
      }
    >
      {ordered?.map((row, index) => (
        <tr key={row._id}>
          <td>
            <Link href={`/admin/labs/${row.slug}`} className="adm-cell-primary">
              {row.title}
            </Link>
            <p className="adm-micro">
              <span className="adm-mono">{row.repoFullName}</span> · {row.language}
            </p>
          </td>

          <td>
            <StatusBadge published={row.published} featured={row.featured} />
          </td>

          <td>
            <span className="adm-micro">
              ★ {row.liveStats.stars} · {row.liveStats.commitsYear} commits
            </span>
            <p className="adm-micro">
              {/* An absent `syncedAt` is the cron's "has not run yet" signal, and
                  saying so is the whole value of this column: on the public card a
                  never-synced Lab is indistinguishable from an unpopular one. */}
              {row.liveStats.syncedAt
                ? `synced ${formatInstant(row.liveStats.syncedAt)}`
                : "never synced — cron pending"}
            </p>
          </td>

          <td data-align="right" data-numeric="true">
            {row.sortOrder}
          </td>

          <td data-align="right">
            <RowActions>
              <button
                type="button"
                className="adm-btn"
                data-variant="ghost"
                data-size="sm"
                disabled={write.pending || mode !== "order" || index === 0}
                onClick={() => move(row._id, -1)}
                aria-label={`Move ${row.title} earlier`}
                title={
                  mode === "order"
                    ? "Move earlier"
                    : "Reordering only works in display order."
                }
              >
                ↑
              </button>
              <button
                type="button"
                className="adm-btn"
                data-variant="ghost"
                data-size="sm"
                disabled={
                  write.pending ||
                  mode !== "order" ||
                  index === (ordered?.length ?? 0) - 1
                }
                onClick={() => move(row._id, 1)}
                aria-label={`Move ${row.title} later`}
                title={
                  mode === "order"
                    ? "Move later"
                    : "Reordering only works in display order."
                }
              >
                ↓
              </button>

              <ActionButton
                action={write}
                size="sm"
                quiet
                onAction={() =>
                  setFeatured({
                    labId: row._id,
                    featured: !row.featured,
                    expectedRevision: row.revision ?? 0,
                  })
                }
                title={
                  row.featured
                    ? "Remove from the dashboard's hero row"
                    : "Make eligible for the dashboard's hero row"
                }
              >
                {row.featured ? "Unfeature" : "Feature"}
              </ActionButton>

              {row.published ? (
                <ActionButton
                  action={write}
                  size="sm"
                  quiet
                  onAction={() =>
                    unpublish({
                      labId: row._id,
                      expectedRevision: row.revision ?? 0,
                    })
                  }
                >
                  Unpublish
                </ActionButton>
              ) : (
                <ActionButton
                  action={write}
                  size="sm"
                  quiet
                  onAction={() =>
                    publish({
                      labId: row._id,
                      expectedRevision: row.revision ?? 0,
                    })
                  }
                >
                  Publish
                </ActionButton>
              )}
            </RowActions>
          </td>
        </tr>
      ))}

      {/* Table-wide failures. Every row's button is `quiet`, so this is the one
          place a refusal is read — a duplicate-repo or incomplete-ordering message
          does not fit in a cell. */}
      {write.failure ? (
        <tr>
          <td colSpan={5}>
            <p className="adm-error" role="alert">
              {write.failure.message}
            </p>
          </td>
        </tr>
      ) : null}
    </EntityTable>
  );
}
