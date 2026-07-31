"use client";

import { api } from "@home/convex/api";
import type { Doc, Id } from "@home/convex/dataModel";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useMemo, useState } from "react";

import {
  ActionButton,
  DeleteButton,
  EntityTable,
  RowActions,
  StatusBadge,
  ToolbarEnd,
  formatInstant,
  usePendingAction,
} from "@/components/admin";

/**
 * The writing list.
 *
 * ── What the query gives back, and why there is a sort control at all ────────
 *
 * `posts.list` is auth-aware: an anonymous caller gets published posts in
 * `publishedAt` descending order straight from `by_published_publishedAt`, and an
 * authenticated one gets **drafts first as a block**, then the published posts.
 * `ConvexGate` guarantees the second case here.
 *
 * That order is the right default for an editor — unfinished work at the top — and
 * the wrong one for "when did I last publish something", because every draft has
 * `publishedAt: null` and cannot be ordered against a date it does not have. So
 * the two other orders are done in memory over an already-bounded array (200 rows,
 * `MAX_LIMIT` in convex/posts.ts) rather than by asking the backend for a second
 * index it would only need for this screen.
 *
 * The status filter is in memory for the same reason: `posts.list` takes no
 * `published` argument, and adding one would be an index and a branch in the
 * backend to save a `.filter()` over at most 200 rows.
 */

/** How many rows to subscribe to. `MAX_LIMIT` in convex/posts.ts — see below. */
const LIMIT = 200;

type StatusFilter = "all" | "published" | "draft";
type Order = "queue" | "newest" | "title";

const ORDER_LABELS: Record<Order, string> = {
  queue: "Drafts first",
  newest: "Newest first",
  title: "Title A–Z",
};

/**
 * The instant a row sorts by under "newest first".
 *
 * A draft has no `publishedAt`, so it falls back to its creation time — which is
 * the only date it has and is what "newest" means for something unpublished.
 * `_creationTime` is epoch milliseconds (the one numeric timestamp in Convex; the
 * schema's own `*At` fields are RFC-3339 strings), so it is converted rather than
 * compared against one.
 */
function sortInstant(row: Doc<"posts">): number {
  return row.publishedAt !== null
    ? Date.parse(row.publishedAt)
    : row._creationTime;
}

/**
 * `"7 posts, 2 drafts"`. Counts the whole subscription, not the filtered view —
 * the number is there to answer "how much is in here", which a filter should not
 * change.
 */
function summarise(total: number, drafts: number): string {
  const posts = `${total} post${total === 1 ? "" : "s"}`;
  return drafts === 0
    ? posts
    : `${posts}, ${drafts} draft${drafts === 1 ? "" : "s"}`;
}

export function PostsTable() {
  /**
   * One subscription for the whole screen.
   *
   * `undefined` while it resolves, and that state is passed to `EntityTable` as
   * `loading` rather than being collapsed into an empty array — a table that says
   * "no posts yet" while loading is a table that gets a duplicate post created.
   */
  const rows = useQuery(api.posts.list, { limit: LIMIT });

  const publish = useMutation(api.posts.publish);
  const unpublish = useMutation(api.posts.unpublish);
  const remove = useMutation(api.posts.remove);

  const [status, setStatus] = useState<StatusFilter>("all");
  const [order, setOrder] = useState<Order>("queue");

  const visible = useMemo(() => {
    if (!rows) {
      return undefined;
    }

    const filtered =
      status === "all"
        ? rows
        : rows.filter((row) => row.published === (status === "published"));

    /* Copy before sorting: the array is the query's, React holds it across
       renders, and `Array.prototype.sort` mutates. Sorting it in place would
       reorder the subscription's own value and make the next render's `queue`
       order wrong. */
    if (order === "title") {
      return [...filtered].sort((a, b) =>
        a.title.localeCompare(b.title, "en-AU"),
      );
    }

    if (order === "newest") {
      return [...filtered].sort((a, b) => sortInstant(b) - sortInstant(a));
    }

    /* `queue` is the backend's own order — drafts first, then published newest
       first. Nothing to do, and deliberately not re-derived: reproducing it here
       would be a second implementation of a rule convex/posts.ts already owns. */
    return filtered;
  }, [rows, status, order]);

  const drafts = rows?.filter((row) => !row.published).length ?? 0;

  return (
    <EntityTable
      columns={[
        { key: "title", label: "Title" },
        { key: "status", label: "Status" },
        { key: "published", label: "Published" },
        { key: "tags", label: "Tags" },
        { key: "actions", label: "", align: "right" },
      ]}
      toolbar={
        <>
          <label className="adm-micro" htmlFor="posts-status">
            Show
          </label>
          <select
            id="posts-status"
            className="adm-select"
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as StatusFilter)
            }
          >
            <option value="all">Everything</option>
            <option value="published">Live only</option>
            <option value="draft">Drafts only</option>
          </select>

          <label className="adm-micro" htmlFor="posts-order">
            Order
          </label>
          <select
            id="posts-order"
            className="adm-select"
            value={order}
            onChange={(event) => setOrder(event.target.value as Order)}
          >
            {(Object.keys(ORDER_LABELS) as Order[]).map((key) => (
              <option key={key} value={key}>
                {ORDER_LABELS[key]}
              </option>
            ))}
          </select>

          <ToolbarEnd>
            <span className="adm-micro">
              {rows === undefined ? "…" : summarise(rows.length, drafts)}
            </span>
          </ToolbarEnd>
        </>
      }
      loading={rows === undefined}
      empty={visible?.length === 0}
      emptyTitle={
        rows?.length === 0 ? "Nothing written yet" : "Nothing matches that filter"
      }
      emptyBody={
        rows?.length === 0 ? (
          <>
            A post is created as a draft and stays invisible to the public site
            until it is published. The blog itself ships hidden (ADR 018), so a
            first post can be written long before anyone can read it.
          </>
        ) : (
          <>Change the filter above to see the rest.</>
        )
      }
      emptyAction={
        rows?.length === 0 ? (
          <Link href="/admin/posts/new" className="adm-btn" data-variant="primary">
            Write the first post
          </Link>
        ) : null
      }
    >
      {visible?.map((row) => (
        <PostRow
          key={row._id}
          row={row}
          publish={publish}
          unpublish={unpublish}
          remove={remove}
        />
      ))}
    </EntityTable>
  );
}

/**
 * One row, with its own pending state.
 *
 * The state is per row rather than per table, and shared *within* the row: publish
 * and delete on the same post would race each other, and publish on post A has no
 * reason to disable delete on post B. `usePendingAction` cannot be called
 * conditionally or in a loop, which is the mechanical reason a row is a component.
 *
 * The three mutations are passed in rather than hooked here. `useMutation` is
 * cheap, but one instance per row is 3n subscriptions to the same three functions
 * for no gain.
 */
function PostRow({
  row,
  publish,
  unpublish,
  remove,
}: {
  row: Doc<"posts">;
  publish: (args: {
    postId: Id<"posts">;
    expectedRevision?: number;
  }) => Promise<unknown>;
  unpublish: (args: {
    postId: Id<"posts">;
    expectedRevision?: number;
  }) => Promise<unknown>;
  remove: (args: {
    postId: Id<"posts">;
    expectedRevision?: number;
  }) => Promise<unknown>;
}) {
  const action = usePendingAction();

  return (
    <tr>
      <td>
        {/* Addressed by slug, not by id — see the docblock in
            `[slug]/page.tsx` for why (`posts` has `getBySlug` and no `get`). */}
        <Link href={`/admin/posts/${row.slug}`} className="adm-cell-primary">
          {row.title || <em>Untitled</em>}
        </Link>
      </td>

      <td>
        <StatusBadge published={row.published} />
      </td>

      <td>
        {/* Shown for an unpublished post too, when it has ever been published:
            `posts.unpublish` deliberately leaves `publishedAt` alone, so a draft
            with a date is a post that was pulled rather than one never released,
            and hiding the date would lose that distinction. */}
        <span className="adm-micro">{formatInstant(row.publishedAt)}</span>
      </td>

      <td>
        <span className="adm-micro">
          {row.tags.length > 0 ? row.tags.join(", ") : "—"}
        </span>
      </td>

      <td data-align="right">
        <RowActions>
          {row.published ? (
            <ActionButton
              action={action}
              size="sm"
              onAction={() =>
                unpublish({
                  postId: row._id,
                  expectedRevision: row.revision ?? 0,
                })
              }
              pendingLabel="Hiding…"
              title="Hide from the public site. Keeps the publication date."
            >
              Unpublish
            </ActionButton>
          ) : (
            <ActionButton
              action={action}
              size="sm"
              variant="primary"
              onAction={() =>
                publish({
                  postId: row._id,
                  expectedRevision: row.revision ?? 0,
                })
              }
              pendingLabel="Publishing…"
            >
              Publish
            </ActionButton>
          )}

          <DeleteButton
            action={action}
            name={row.title}
            onAction={() =>
              remove({
                postId: row._id,
                expectedRevision: row.revision ?? 0,
              })
            }
          />
        </RowActions>
      </td>
    </tr>
  );
}
