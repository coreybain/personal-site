/**
 * One string per line ⇄ `string[]`.
 *
 * Shared by the three screens in the admin's **profile** group — the résumé
 * (`capabilities`), experience entries (`highlights`, `skills`, `projectSlugs`)
 * and site settings (the three `featured.*Slugs` lists). Every one of those is a
 * short, ordered list of short strings, and a line-per-item textarea is the right
 * control for all of them: it reorders by editing, pastes from anywhere, and needs
 * no add/remove buttons. A repeater with a row per item would be five components
 * and a focus-management problem to enter the same data.
 *
 * ── Why the conversion lives here and not in each screen ────────────────────
 *
 * Because the trimming rules have to match the backend's, and there are three
 * places to get them wrong. `normaliseCapabilities` in `convex/resume.ts`,
 * `normaliseHighlights`/`normaliseSkills` in `convex/experienceEntries.ts` all
 * trim, drop blanks and preserve order — a trailing newline in a textarea is a
 * typing artefact, not an empty item worth failing a save over. `linesToList`
 * mirrors that exactly, so what the screen sends is what the server would have
 * stored anyway, and a saved value round-trips through the field unchanged.
 *
 * What it deliberately does *not* mirror is de-duplication or the length bounds.
 * Those refuse a save with a message naming the field, and refusing in the browser
 * instead would mean a second copy of rules that can drift — see §6 of the kit
 * README on why no field in this admin validates.
 *
 * Server-safe: no `"use client"`, no imports, no `Date`.
 */

/** A stored list → textarea value. One item per line, order preserved. */
export function listToLines(values: readonly string[]): string {
  return values.join("\n");
}

/**
 * A textarea value → the list a mutation wants.
 *
 * Splits on any newline (`\r\n` included — a paste from a Windows editor or from
 * a PDF arrives that way), trims each line, and drops the empties. The result is
 * always a fresh array, so it can be handed straight to a Convex mutation without
 * aliasing the caller's state.
 */
export function linesToList(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
