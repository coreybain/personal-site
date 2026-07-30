"use client";

import type { MediaAsset } from "@home/types";

import { ImageUpload } from "./ImageUpload";

/**
 * An ordered array of `MediaAsset` — `projects.media`.
 *
 * ── Why this exists as well as `ImageUpload` ────────────────────────────────
 *
 * `projects.media` is the only array-of-asset field in the schema, and it is the
 * one that matters most: it is the case-study gallery, the thing ADR 009's publish
 * gate is about, and its *order* is editorial (the first image is the one the grid
 * tile shows). Left to a page to assemble, it would come out as "an ImageUpload in
 * a map with a remove button", and the two properties that are easy to lose —
 * order being explicit, and every item carrying `sanitised: false` until someone
 * says otherwise — would be lost in exactly the place they are checked.
 *
 * ── Ordering ───────────────────────────────────────────────────────────────
 *
 * Up/down buttons, not drag-and-drop. Drag-and-drop for a list of three to six
 * images needs pointer, touch and keyboard implementations to be usable by
 * everyone, and the keyboard implementation *is* a pair of move buttons. So the
 * buttons are built and the drag is not: the same capability, a tenth of the code,
 * and it works with a screen reader on the first try.
 *
 * ── The publish gate, surfaced ──────────────────────────────────────────────
 *
 * The count of unsanitised assets is shown above the list when `requireSanitised`
 * is set, because `projects.publish` will refuse with exactly that information and
 * a form should not let a refusal be a surprise. It is a *report*, not a
 * validation: the mutation remains the only authority, and this component never
 * blocks anything.
 */

export type MediaListEditorProps = {
  /** The current array. Never `undefined` — pass `[]` for empty. */
  value: readonly MediaAsset[];
  onValueChange: (value: MediaAsset[]) => void;
  /** ADR 009. `true` for `projects.media`; unset everywhere else. */
  requireSanitised?: boolean;
  /** Render the caption field on each asset. */
  withCaption?: boolean;
  label?: string;
  disabled?: boolean;
};

export function MediaListEditor({
  value,
  onValueChange,
  requireSanitised,
  withCaption,
  label = "Media",
  disabled,
}: MediaListEditorProps) {
  function replaceAt(index: number, asset: MediaAsset | null) {
    const next = [...value];

    if (asset === null) {
      next.splice(index, 1);
    } else {
      next[index] = asset;
    }

    onValueChange(next);
  }

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;

    if (target < 0 || target >= value.length) {
      return;
    }

    const next = [...value];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    onValueChange(next);
  }

  const unsanitised = requireSanitised
    ? value.filter((asset) => asset.sanitised !== true).length
    : 0;

  return (
    <div className="adm-media">
      <p className="adm-label">
        {label}
        <span className="adm-optional">
          {value.length} {value.length === 1 ? "image" : "images"}
        </span>
      </p>

      {requireSanitised && unsanitised > 0 ? (
        <p className="adm-error" role="status">
          {unsanitised} of {value.length} not marked sanitised — publishing will be
          refused until every image is (ADR 009).
        </p>
      ) : null}

      {value.map((asset, index) => (
        <ImageUpload
          /* Keyed by storage key where there is one — a stable identity that
             survives a reorder, so React moves the DOM node rather than
             rewriting its contents and losing focus in the alt field mid-edit.
             The index fallback covers an iOS-uploaded asset with no key. */
          key={asset.storageKey ?? `index-${index}`}
          label={`Image ${index + 1}${index === 0 ? " — grid tile" : ""}`}
          value={asset}
          onValueChange={(next) => replaceAt(index, next)}
          requireSanitised={requireSanitised}
          withCaption={withCaption}
          disabled={disabled}
          assetActions={
            <>
              <button
                type="button"
                className="adm-btn"
                data-variant="ghost"
                data-size="sm"
                disabled={disabled || index === 0}
                onClick={() => move(index, -1)}
                aria-label={`Move image ${index + 1} earlier`}
              >
                ↑
              </button>
              <button
                type="button"
                className="adm-btn"
                data-variant="ghost"
                data-size="sm"
                disabled={disabled || index === value.length - 1}
                onClick={() => move(index, 1)}
                aria-label={`Move image ${index + 1} later`}
              >
                ↓
              </button>
            </>
          }
        />
      ))}

      {/* The append slot: an ImageUpload with no value, so its dropzone reads
          "Choose an image" and a completed upload lands at the end of the array.
          Keyed by length so it remounts after each add and does not hold the
          previous upload's error. */}
      <ImageUpload
        key={`append-${value.length}`}
        label={value.length === 0 ? "First image" : "Add another image"}
        value={null}
        onValueChange={(asset) => {
          if (asset) {
            onValueChange([...value, asset]);
          }
        }}
        requireSanitised={requireSanitised}
        withCaption={withCaption}
        disabled={disabled}
      />
    </div>
  );
}
