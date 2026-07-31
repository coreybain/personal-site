"use client";

import { api } from "@home/convex/api";
import type { Doc } from "@home/convex/dataModel";
import type { FunEntryKind } from "@home/types";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import {
  Badge,
  DeleteButton,
  EntityTable,
  RowActions,
  ToolbarEnd,
  formatInstant,
} from "@/components/admin";

import { FUN_TYPE_OPTIONS, funTypeLabel } from "./FunFields";

/**
 * The Fun Entries list: photo first, newest first, filterable by kind.
 *
 * ── The filter is the query, not a `.filter()` ───────────────────────────────
 *
 * `funEntries.list` takes an optional `type` and reads through
 * `by_type_occurredAt` when given one and `by_occurredAt` when not — two indexes,
 * both descending, both giving reverse-chronological order *from the index* because
 * `occurredAt` is a fixed-width UTC string. So filtering by kind is a different
 * subscription rather than a client-side pass, which is both cheaper and the reason
 * those two indexes exist.
 *
 * Note the contrast with `/admin/posts`, which filters in memory: `posts.list` has
 * no argument to filter on, and adding one would mean a backend change for a
 * screen-level convenience. Here the argument already exists.
 *
 * There is no sort control. The order is `occurredAt` descending and there is no
 * second useful one — an entry is a dated thing and nothing else, with no title
 * anyone looks alphabetically for and no draft state to bring to the top.
 */

/** `MAX_LIMIT` in convex/funEntries.ts. The whole feed, in one subscription. */
const LIMIT = 300;

type Filter = FunEntryKind | "all";

export function FunTable() {
  const [filter, setFilter] = useState<Filter>("all");

  /**
   * Two shapes of argument, one hook.
   *
   * Convex re-subscribes when the arguments change, so switching the filter swaps
   * which index is read. `type` is omitted rather than passed as `undefined` for
   * the "all" case: the validator is `v.optional`, and an explicit `undefined`
   * reads as a value in a way that is easy to get wrong elsewhere.
   */
  const rows = useQuery(
    api.funEntries.list,
    filter === "all" ? { limit: LIMIT } : { type: filter, limit: LIMIT },
  );

  const remove = useMutation(api.funEntries.remove);

  return (
    <EntityTable
      columns={[
        /* The photo column's heading is empty; `EntityTable` renders a
           visually-hidden "Actions" for an empty label, which would be wrong
           here, so it is labelled and the label is short. */
        { key: "photo", label: "Photo" },
        { key: "title", label: "Title" },
        { key: "kind", label: "Kind" },
        { key: "when", label: "When" },
        { key: "detail", label: "Detail" },
        { key: "actions", label: "", align: "right" },
      ]}
      toolbar={
        <>
          <label className="adm-micro" htmlFor="fun-filter">
            Kind
          </label>
          <select
            id="fun-filter"
            className="adm-select"
            value={filter}
            onChange={(event) => setFilter(event.target.value as Filter)}
          >
            <option value="all">Everything</option>
            {FUN_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <ToolbarEnd>
            <span className="adm-micro">
              {rows === undefined
                ? "…"
                : `${rows.length} entr${rows.length === 1 ? "y" : "ies"}`}
            </span>
          </ToolbarEnd>
        </>
      }
      loading={rows === undefined}
      empty={rows?.length === 0}
      emptyTitle={
        filter === "all"
          ? "No Fun Entries yet"
          : `No ${funTypeLabel(filter).toLowerCase()} entries`
      }
      emptyBody={
        filter === "all" ? (
          <>
            These are usually written by the iOS app — a photo, a sentence, and when
            it happened. They can be typed here too, and every one of them is public
            the moment it is saved: the table has no draft state.
          </>
        ) : (
          <>Switch the filter to Everything to see the rest.</>
        )
      }
      emptyAction={
        filter === "all" ? (
          <Link href="/admin/fun/new" className="adm-btn" data-variant="primary">
            Add the first entry
          </Link>
        ) : null
      }
    >
      {rows?.map((row) => (
        <tr key={row._id}>
          <td>
            {/* `.adm-asset-thumb` is the kit's 16:10 cropping frame, borrowed from
                `ImageUpload` and given a row-sized width. A plain <img>, not
                next/image: the optimiser would need `images.remotePatterns` to
                list the UploadThing CDN, which is a public-site config change made
                for an admin thumbnail. Same reasoning as `ImageUpload`. */}
            <span
              className="adm-asset-thumb"
              style={{ display: "block", width: "64px" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={row.photo.url}
                /* Empty alt on purpose: the title in the next cell is the row's
                   accessible name, and reading the photo's description as well
                   would announce the same entry twice. */
                alt=""
                loading="lazy"
                decoding="async"
              />
            </span>
          </td>

          <td>
            <Link href={`/admin/fun/${row._id}`} className="adm-cell-primary">
              {row.title || <em>Untitled</em>}
            </Link>
          </td>

          <td>
            <Badge>{funTypeLabel(row.type)}</Badge>
          </td>

          <td>
            <span className="adm-micro">{formatInstant(row.occurredAt)}</span>
          </td>

          <td>
            <span className="adm-micro">{describe(row)}</span>
          </td>

          <td data-align="right">
            <RowActions>
              {/* `DeleteButton` with no `action` owns its own pending state, which
                  is right here: it is the only control in the row, so there is
                  nothing for it to race. Unlike a post, an entry has no URL of its
                  own to break, so there is no `unpublish` to prefer. */}
              <DeleteButton
                name={row.title}
                onAction={() =>
                  remove({
                    entryId: row._id,
                    expectedRevision: row.revision ?? 0,
                  })
                }
              />
            </RowActions>
          </td>
        </tr>
      ))}
    </EntityTable>
  );
}

/**
 * The one-line summary in the Detail column: metrics for a walk, a score and a
 * place for everything else.
 *
 * Per-kind rather than one shape for all four, because the fields are per-kind —
 * `steps`/`km` exist only on a walk and `assertKind` forbids them elsewhere, so a
 * column that showed them for every row would be mostly em dashes.
 */
function describe(row: Doc<"funEntries">): string {
  const parts: string[] = [];

  if (row.type === "walk") {
    if (row.steps !== undefined) {
      parts.push(`${row.steps.toLocaleString("en-AU")} steps`);
    }
    if (row.km !== undefined) {
      parts.push(`${row.km} km`);
    }
  }

  if (row.rating !== undefined) {
    parts.push(`${row.rating}/5`);
  }

  if (row.location) {
    parts.push(
      row.location.suburb
        ? `${row.location.name}, ${row.location.suburb}`
        : row.location.name,
    );
  }

  return parts.length > 0 ? parts.join(" · ") : "—";
}
