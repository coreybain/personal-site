"use client";

import { api } from "@home/convex/api";
import type { Doc, Id } from "@home/convex/dataModel";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import {
  ActionButton,
  EntityTable,
  InfoTip,
  RowActions,
  StatusBadge,
  ToolbarEnd,
  usePendingAction,
} from "@/components/admin";

/**
 * `/admin/projects` — every case study, drafts included.
 *
 * ── One query, and why it is not paginated ──────────────────────────────────
 *
 * `projects.list({ includeDrafts: true })` returns the whole table in
 * `sortOrder` order (it reads `by_sortOrder`, which exists for exactly this
 * screen — a Convex index is only usable from its leading field, so
 * `by_published_sortOrder` cannot serve "both states, in one ordered read").
 *
 * Having every row is not a convenience here, it is a requirement:
 * `setSortOrder` takes **every** project id in display order and refuses a
 * subset, because writing positional weights for some rows would collide with
 * the rows left out. A paginated list could not reorder at all.
 *
 * `includeDrafts: true` makes the query admin-only, which is safe because
 * `ConvexGate` (in the page) has already established an authenticated client.
 *
 * ── Sorting vs ordering ────────────────────────────────────────────────────
 *
 * These are two different things and the toolbar keeps them apart. **Order** is
 * `sortOrder`, it is stored, and it is what the public site renders. **Sort** is
 * a local view — by title, by publish state — for finding a row in a long list.
 * The move arrows are therefore disabled outside display order: "move this up"
 * has no meaning in a list sorted alphabetically, and the obvious implementation
 * (swap the two rows you can see) would write a weight that reorders something
 * else entirely.
 */

/** The local view. `order` is the stored one; the rest are for finding things. */
type SortMode = "order" | "title" | "status";

const SORT_MODES: readonly { id: SortMode; label: string; title: string }[] = [
  {
    id: "order",
    label: "Display order",
    title: "The stored sortOrder — what /work renders. Reordering is enabled here.",
  },
  { id: "title", label: "Title", title: "Alphabetical, for finding a row." },
  {
    id: "status",
    label: "Status",
    title: "Drafts first, then published. Each group in display order.",
  },
];

function sortRows(
  rows: readonly Doc<"projects">[],
  mode: SortMode,
): Doc<"projects">[] {
  /* Copied before sorting: the array belongs to the Convex subscription and
     `sort` mutates in place. */
  const copy = [...rows];

  switch (mode) {
    case "title":
      return copy.sort((a, b) => a.title.localeCompare(b.title, "en-AU"));
    case "status":
      /* Drafts first — they are the ones needing attention — and each group
         stays in display order because the input already is. */
      return copy.sort(
        (a, b) =>
          Number(a.published) - Number(b.published) || a.sortOrder - b.sortOrder,
      );
    case "order":
      return copy;
  }
}

export function ProjectsTable() {
  const rows = useQuery(api.projects.list, { includeDrafts: true, limit: 500 });

  const publish = useMutation(api.projects.publish);
  const unpublish = useMutation(api.projects.unpublish);
  const setFeatured = useMutation(api.projects.setFeatured);
  const setSortOrder = useMutation(api.projects.setSortOrder);

  /**
   * One pending state for the whole table.
   *
   * Every mutation here rewrites rows the other buttons act on — a publish and a
   * reorder in flight together would have the second overwrite the first's read
   * of the list — so any running write disables all of them. The failure message
   * is shown by whichever button was pressed.
   */
  const write = usePendingAction();

  const [mode, setMode] = useState<SortMode>("order");

  const ordered = rows === undefined ? undefined : sortRows(rows, mode);

  /**
   * Move one row one place, in the stored order.
   *
   * `setSortOrder` wants the complete list, so this builds it: take the rows in
   * *display order* (never the locally-sorted view — see the docblock), swap the
   * pair, and send every id. The mutation renumbers densely and skips rows whose
   * weight is already right, so a swap near the top of thirty rows is two writes.
   */
  function move(projectId: Id<"projects">, delta: -1 | 1) {
    if (rows === undefined) {
      return;
    }

    const ids = rows.map((row) => row._id);
    const from = ids.indexOf(projectId);
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
        projectIds: ids,
        expectedRevisions: ids.map((id) => revisionById.get(id) ?? 0),
      }),
    );
  }

  return (
    <EntityTable
      columns={[
        { key: "title", label: "Case study" },
        { key: "status", label: "Status" },
        { key: "media", label: "Media" },
        { key: "order", label: "Order", align: "right" },
        { key: "actions", label: "", align: "right" },
      ]}
      toolbar={
        <>
          <span className="adm-eyebrow">Sort</span>
          {/* The distinction in the docblock, where someone puzzled by a
              greyed-out arrow will actually look for it. It is chrome — nothing
              here can be got wrong, the arrows simply disable themselves — so a
              tooltip is the right weight for it. */}
          <InfoTip label="About sorting and display order">
            <strong>Display order</strong> is the stored <code>sortOrder</code>{" "}
            that <code>/work</code> renders, and the only mode the move arrows
            work in. The other two are a local view for finding a row — “move
            this up” has no meaning in an alphabetical list.
          </InfoTip>

          {SORT_MODES.map((option) => (
            <button
              key={option.id}
              type="button"
              className="adm-btn"
              data-size="sm"
              data-variant={mode === option.id ? "primary" : "ghost"}
              /* `aria-pressed` rather than a radio group: these are buttons that
                 change a view, and the pressed state is what a screen reader
                 needs to hear. */
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
      emptyTitle="No case studies yet"
      emptyBody="A case study is client or employer work: attributed, sanitised, and never repo-linked (ADR 008)."
      emptyAction={
        <Link href="/admin/projects/new" className="adm-btn" data-variant="primary">
          New case study
        </Link>
      }
    >
      {ordered?.map((row, index) => {
        /* The gate, in the list: the count `projects.publish` will refuse on.
           Shown per row so the screen says which case study needs work before
           anyone opens it. */
        const unsanitised = row.media.filter(
          (asset) => asset.sanitised !== true,
        ).length;

        return (
          <tr key={row._id}>
            <td>
              <Link
                href={`/admin/projects/${row.slug}`}
                className="adm-cell-primary"
              >
                {row.title}
              </Link>
              <p className="adm-micro">
                {row.client}
                {row.period ? ` · ${row.period}` : ""}
              </p>
            </td>

            <td>
              <StatusBadge published={row.published} featured={row.featured} />
            </td>

            <td>
              <span className="adm-micro">
                {row.media.length === 0
                  ? "none"
                  : `${row.media.length} image${row.media.length === 1 ? "" : "s"}`}
              </span>
              {unsanitised > 0 ? (
                <p className="adm-error">
                  {unsanitised} unsanitised — publish blocked (ADR 009)
                </p>
              ) : null}
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
                      projectId: row._id,
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
                        projectId: row._id,
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
                        projectId: row._id,
                        expectedRevision: row.revision ?? 0,
                      })
                    }
                    disabled={unsanitised > 0}
                    title={
                      unsanitised > 0
                        ? `Blocked by ADR 009: ${unsanitised} image${unsanitised === 1 ? " is" : "s are"} not marked sanitised.`
                        : undefined
                    }
                  >
                    Publish
                  </ActionButton>
                )}
              </RowActions>
            </td>
          </tr>
        );
      })}

      {/* Table-wide failures. Every row's button is `quiet`, so this is the one
          place a refusal is read — an ADR-009 message names three screenshots and
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
