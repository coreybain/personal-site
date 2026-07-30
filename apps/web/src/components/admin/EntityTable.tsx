import type { ReactNode } from "react";

/**
 * The list-screen shell: a toolbar, a scrolling table, an empty state, a loading
 * state.
 *
 * ── A shell, not a data grid ────────────────────────────────────────────────
 *
 * This does **not** take rows, columns and a render function. It takes `columns`
 * (for the header) and `children` (the `<tr>`s), and that is on purpose. Nine
 * entity screens have nine genuinely different row shapes — a project row has an
 * ADR-009 media warning, a token row can never show its own token, a contact row
 * has a status dropdown — and every generic table abstraction that has ever met
 * that situation has grown a `renderCell` escape hatch and become harder to read
 * than the nine tables it replaced.
 *
 * What it *does* own is the part that must be identical everywhere and is easy to
 * get wrong: the header semantics, the horizontal-scroll container, the sticky
 * header, and the two non-row states.
 *
 * ```tsx
 * <EntityTable
 *   columns={[{ key: "title", label: "Title" }, { key: "actions", label: "", align: "right" }]}
 *   toolbar={<AdminButtonRow>…</AdminButtonRow>}
 *   empty={rows?.length === 0}
 *   loading={rows === undefined}
 *   emptyTitle="No case studies yet"
 * >
 *   {rows?.map((row) => <tr key={row._id}>…</tr>)}
 * </EntityTable>
 * ```
 *
 * Server components, all of them. The rows a page passes in may be client
 * components; nothing here needs to be.
 *
 * ── Horizontal scroll ──────────────────────────────────────────────────────
 *
 * `.adm-table-wrap` is `overflow-x: auto`, so a wide table scrolls inside itself
 * and the page body never scrolls sideways. That is not a nicety — a page that
 * scrolls horizontally hides the sidebar on a laptop and is unusable on a phone.
 * Any table wider than its column must stay inside this wrapper.
 */

export type EntityColumn = {
  /** React key, and a stable handle for a page that wants to style one column. */
  key: string;
  /**
   * Header content. Empty string for an actions column — see the note below.
   *
   * `ReactNode` rather than `string` so a column whose meaning is not obvious from
   * one word can carry an `InfoTip`: `label={<>Sort <InfoTip …/></>}`. The tip
   * panel resets the mono/uppercase/letter-spaced type it would otherwise inherit
   * from the `<th>`, and is `position: fixed`, so it is not clipped by
   * `.adm-table-wrap`'s `overflow-x`.
   */
  label: ReactNode;
  align?: "left" | "right";
};

export type EntityTableProps = {
  columns: readonly EntityColumn[];
  children?: ReactNode;
  /** Rendered above the table, in a strip joined to its top edge. */
  toolbar?: ReactNode;
  /**
   * `true` while the Convex subscription has not resolved. Convex's `useQuery`
   * returns `undefined` in that state — *not* an empty array — and the difference
   * matters: "loading" and "there is nothing" must not look the same, or the
   * first thing anyone does with a slow query is create a duplicate record.
   */
  loading?: boolean;
  /** `true` when the query resolved to nothing. Renders `emptyTitle`/`empty*`. */
  empty?: boolean;
  emptyTitle?: string;
  emptyBody?: ReactNode;
  /** A "create the first one" control for the empty state. */
  emptyAction?: ReactNode;
};

export function EntityTable({
  columns,
  children,
  toolbar,
  loading,
  empty,
  emptyTitle = "Nothing here yet",
  emptyBody,
  emptyAction,
}: EntityTableProps) {
  return (
    <>
      {toolbar ? <div className="adm-toolbar">{toolbar}</div> : null}

      <div className="adm-table-wrap">
        {loading ? (
          <SkeletonRows columns={columns.length} />
        ) : empty ? (
          <div className="adm-empty">
            <p className="adm-empty-title">{emptyTitle}</p>
            {emptyBody ? <p>{emptyBody}</p> : null}
            {emptyAction}
          </div>
        ) : (
          <table className="adm-table">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    data-align={column.align === "right" ? "right" : undefined}
                  >
                    {/* An actions column has no meaningful heading, but a `<th>`
                        with no text is announced as blank. The visually-hidden
                        word keeps the column count and the announcement honest. */}
                    {column.label || (
                      <span className="adm-sr-only">Actions</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>{children}</tbody>
          </table>
        )}
      </div>
    </>
  );
}

/**
 * Three shimmer rows while a query resolves.
 *
 * Deliberately not a spinner. The table's shape is known before its contents
 * are, so drawing the shape reserves the space and stops the page jumping when
 * data lands — the same reason `MediaAsset` carries `width`/`height`.
 */
function SkeletonRows({ columns }: { columns: number }) {
  return (
    <table className="adm-table" aria-hidden="true">
      <tbody>
        {[0, 1, 2].map((row) => (
          <tr key={row}>
            {Array.from({ length: columns }, (_, cell) => (
              <td key={cell}>
                <span
                  className="adm-skeleton"
                  style={{ width: cell === 0 ? "60%" : "40%" }}
                />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Right-aligned cluster of row controls. Use in the last `<td>` of a row. */
export function RowActions({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="adm-cell-actions">{children}</div>;
}

/** Pushes toolbar content to the right-hand end of the strip. */
export function ToolbarEnd({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="adm-toolbar-end">{children}</div>;
}
