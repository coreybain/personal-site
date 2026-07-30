/**
 * `string[]` ⇄ one-entry-per-line text, for the two list fields on a case study.
 *
 * ── Why a textarea and not a repeater ───────────────────────────────────────
 *
 * `projects.outcomes` and `projects.stack` are arrays of short, order-significant
 * strings — "Deploys went from fortnightly to hourly", "TypeScript". The obvious
 * editor is a repeating row of inputs with add/remove/move buttons, which is what
 * `MediaListEditor` is for assets. It is the wrong shape here, for three reasons:
 *
 *   1. **Reordering is free.** Moving a line in a textarea is a cut and a paste,
 *      or Alt+↑ in most editors people paste from. A repeater needs a pair of
 *      buttons per row to do the same thing, which is the machinery
 *      `MediaListEditor` carries because an asset is too big to retype.
 *   2. **Bulk entry is the normal case.** A stack list arrives as eleven lines
 *      pasted from a README. Into a repeater that is eleven "add" clicks.
 *   3. **It needs no new CSS.** `admin.css` is owned by the kit and this screen
 *      may not add to it, so a repeater would have to be laid out with inline
 *      styles — a worse outcome than a control the kit already ships.
 *
 * The cost is that a line's *internal* whitespace is not visible, and that empty
 * lines silently vanish. Both are handled below rather than left to the mutation:
 * `assertText` in `packages/convex/convex/lib/validate.ts` rejects an empty
 * string, so a stray blank line would otherwise fail the whole save with
 * `outcomes[3] is required` — an error about a line the person cannot see.
 *
 * Server-safe: no `"use client"`, no imports. Both directions are used from a
 * client form, but nothing here needs a browser.
 */

/**
 * Stored array → textarea value.
 *
 * `undefined` (the field is absent on the document) and `[]` both render as an
 * empty textarea. That collapse is intentional and is why the reverse direction
 * is the one that decides between "omit" and "clear" — see `textToLines`.
 */
export function linesToText(lines: readonly string[] | undefined): string {
  return lines === undefined ? "" : lines.join("\n");
}

/**
 * Textarea value → stored array.
 *
 * Trims each line and drops the empty ones, so a trailing newline, a blank line
 * between groups, and a line of spaces all disappear rather than becoming an
 * empty entry the Convex validator refuses.
 *
 * Returns `[]` for an empty textarea. The caller decides what that means: on
 * `create` an empty `outcomes` is omitted (the field is optional), on `update` it
 * is sent as `null` to clear it — the distinction the patch API draws between
 * "leave it alone" and "empty it".
 */
export function textToLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
