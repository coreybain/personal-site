"use client";

import { useId, useState, type DragEvent, type ReactNode } from "react";

import type { MediaAsset } from "@home/types";

import { useAdminConfig } from "./AdminConfig";
import { TextField, ToggleField } from "./Field";
import { useUploadThing } from "./uploadthing";

/**
 * Upload an image and describe it — the `MediaAsset` editor (ADR 009, ADR 010).
 *
 * ── What a MediaAsset is, and why this is not just an uploader ──────────────
 *
 * The schema's shape is
 *
 *   { kind, url, alt, width?, height?, caption?, storageKey?, sanitised? }
 *
 * and only two of those come from the upload. The rest is editorial, and two of
 * them are load-bearing enough that an uploader which did not collect them would
 * be actively harmful:
 *
 *   `alt`        Required, non-empty, in the Zod schema and the Convex
 *                validator. There is no decorative media on this site. Collected
 *                *here*, next to the thumbnail, because that is the only moment
 *                anyone can see what they are describing — a separate "fill in
 *                the alt text" pass later is a pass that does not happen.
 *
 *   `sanitised`  ADR 009: case-study screenshots are real client UI with client
 *                data scrubbed out. `projects.publish` throws unless every entry
 *                in `projects.media` has `sanitised: true`, naming each offender.
 *                A fresh upload is therefore always `sanitised: false` — never
 *                omitted and never optimistically `true` — and the checkbox is a
 *                human asserting they looked. Absent entirely on Labs covers and
 *                Fun photos, where the concept does not apply, which is what
 *                `requireSanitised` selects.
 *
 * `width`/`height` are measured in the browser before upload, from the `File`
 * itself. The server never decodes the image (a Convex mutation cannot, and the
 * upload callback deliberately writes nothing), so this is the only place they can
 * come from. They matter: the public dashboard renders media at fixed intrinsic
 * size to hold a < 0.05 CLS budget, and an asset with no dimensions forces a
 * skeleton.
 *
 * ── With no UploadThing account ─────────────────────────────────────────────
 *
 * `uploadsEnabled` comes from the server via `AdminConfig` — `UPLOADTHING_TOKEN`
 * is a secret, so the browser cannot check for itself. When it is `false` the
 * dropzone renders as a disabled, explained box and no upload is attempted. Note
 * what stays *enabled*: the alt, caption and sanitised controls for an asset that
 * already exists. An image uploaded from the iOS app, or one already in a
 * document, must remain describable on a deployment that cannot accept new bytes.
 */

/** Mirrors `maxFileSize` in `app/api/uploadthing/core.ts`. Keep the two equal. */
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Read an image's intrinsic size without rendering it.
 *
 * `createImageBitmap` decodes off the main thread and needs no DOM node, unlike
 * the `new Image()` + `onload` dance. Returns `null` rather than throwing on
 * anything it cannot decode (an unsupported format, an old browser, a corrupt
 * file): dimensions are optional in the schema, and refusing an upload because
 * the *thumbnail* could not be measured would be the wrong trade.
 */
async function measure(
  file: File,
): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== "function") {
    return null;
  }

  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

export type ImageUploadProps = {
  /** Field label, e.g. "Cover image". */
  label: string;
  /** The current asset, or `null` when there is none. */
  value: MediaAsset | null;
  /** Called with the whole asset on every edit, and with `null` on remove. */
  onValueChange: (value: MediaAsset | null) => void;
  /**
   * `true` on case-study media (ADR 009): renders the sanitisation checkbox and
   * initialises new uploads with `sanitised: false`. Leave unset for Labs covers,
   * post covers and Fun photos — the field is then omitted entirely rather than
   * set to `false`, because "not applicable" and "not yet checked" are different
   * facts and `projects.publish` only asks about the second.
   */
  requireSanitised?: boolean;
  /**
   * Render the optional `caption` field.
   *
   * Off by default because a caption is *published copy* — it appears under the
   * image on the case-study page — and most media does not want one. Alt text and
   * a caption are not interchangeable: alt describes the image for someone who
   * cannot see it, a caption says something to everyone. Offering the field
   * everywhere invites the two to be filled with the same sentence.
   */
  withCaption?: boolean;
  /** Extra guidance under the dropzone. */
  hint?: string;
  disabled?: boolean;
  /** Rendered at the end of the asset's meta row — reorder controls, usually. */
  assetActions?: ReactNode;
};

export function ImageUpload({
  label,
  value,
  onValueChange,
  requireSanitised,
  withCaption,
  hint,
  disabled,
  assetActions,
}: ImageUploadProps) {
  const { uploadsEnabled } = useAdminConfig();
  const inputId = useId();

  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const { startUpload, isUploading } = useUploadThing("adminImage", {
    uploadProgressGranularity: "coarse",
    onUploadProgress: setProgress,
    /* UploadThing surfaces the `UploadThingError` message thrown by the route's
       middleware here — "Sign in to upload.", "Uploads are unavailable…" — so
       this is the honest text to show rather than a generic failure. */
    onUploadError: (uploadError) => setError(uploadError.message),
  });

  const busy = isUploading || disabled;

  async function accept(files: FileList | File[] | null) {
    setError(null);

    const file = files?.[0];

    if (!file) {
      return;
    }

    /* Checked here as well as by UploadThing so the refusal is instant and
       specific. The server check is the real one — this is a courtesy. */
    if (!file.type.startsWith("image/")) {
      setError(`${file.name} is not an image (${file.type || "unknown type"}).`);
      return;
    }

    if (file.size > MAX_BYTES) {
      setError(
        `${file.name} is ${formatBytes(file.size)}; the limit is ${formatBytes(MAX_BYTES)}.`,
      );
      return;
    }

    const size = await measure(file);
    const uploaded = await startUpload([file]);
    const result = uploaded?.[0];

    if (!result) {
      /* `startUpload` resolves `undefined` when it failed; `onUploadError` has
         already written the message, so adding another would replace a specific
         one with a vague one. */
      return;
    }

    onValueChange({
      kind: "image",
      /* `ufsUrl`, not `url`: `url` is UploadThing's legacy field and is
         deprecated in v7. Both are returned; only one has a future. */
      url: result.ufsUrl,
      storageKey: result.key,
      /* Alt text is carried over on a replace — swapping the screenshot for a
         better crop of the same screen rarely changes the description — and is
         empty on a first upload, which the field below flags as an error. */
      alt: value?.alt ?? "",
      ...(value?.caption ? { caption: value.caption } : {}),
      ...(size ?? {}),
      /* Always false on a new upload, never carried over from the replaced
         asset: the new bytes have not been looked at. */
      ...(requireSanitised ? { sanitised: false } : {}),
    });

    setProgress(0);
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);

    if (!uploadsEnabled || busy) {
      return;
    }

    void accept(event.dataTransfer.files);
  }

  const dropzone = (
    /* A <label> wrapping a hidden <input type="file"> — the whole box is a click
       target, keyboard-focusable and announced, with no role/tabindex/keydown
       handling of our own. A <div onClick> would need all three and would still
       not be a form control. */
    <label
      className="adm-drop"
      htmlFor={inputId}
      data-dragging={dragging ? "true" : undefined}
      data-disabled={!uploadsEnabled || busy ? "true" : undefined}
      onDragOver={(event) => {
        event.preventDefault();
        if (uploadsEnabled && !busy) {
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <input
        id={inputId}
        type="file"
        accept="image/*"
        disabled={!uploadsEnabled || busy}
        onChange={(event) => {
          void accept(event.target.files);
          /* Reset, so choosing the same file twice in a row fires `change` the
             second time. Without this, retrying a failed upload silently does
             nothing. */
          event.target.value = "";
        }}
      />

      {isUploading ? (
        <>
          <p className="adm-drop-title">Uploading…</p>
          <span className="adm-progress">
            <i style={{ width: `${progress}%` }} />
          </span>
        </>
      ) : uploadsEnabled ? (
        <>
          <p className="adm-drop-title">
            <strong>{value ? "Replace image" : "Choose an image"}</strong> or drop
            one here
          </p>
          <p className="adm-hint">
            Images only, up to {formatBytes(MAX_BYTES)}.
            {hint ? ` ${hint}` : ""}
          </p>
        </>
      ) : (
        <>
          <p className="adm-drop-title">
            <strong>Uploads are unavailable</strong>
          </p>
          <p className="adm-hint">
            UPLOADTHING_TOKEN is not set on this deployment (ADR 010). Existing
            images stay editable; new ones cannot be added from the browser.
          </p>
        </>
      )}
    </label>
  );

  return (
    <div className="adm-media">
      <p className="adm-label">{label}</p>

      {value ? (
        <div className="adm-asset">
          <div className="adm-asset-thumb">
            {/* A plain <img>, not next/image. The optimiser would need
                `images.remotePatterns` to include the UploadThing CDN, which is a
                public-site config change made for an admin thumbnail, and the
                admin has no LCP budget. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={value.url}
              alt=""
              width={value.width}
              height={value.height}
              loading="lazy"
              decoding="async"
            />
          </div>

          <div className="adm-asset-body">
            <TextField
              label="Alt text"
              value={value.alt}
              onValueChange={(alt) => onValueChange({ ...value, alt })}
              placeholder="What the image shows, for someone who cannot see it"
              maxLength={280}
              required
              error={
                value.alt.trim().length === 0
                  ? "Required. Every image on this site is described."
                  : null
              }
            />

            {withCaption ? (
              <TextField
                label="Caption"
                value={value.caption ?? ""}
                onValueChange={(caption) =>
                  /* Empty means absent, not empty-string: the schema has the
                     field optional, and an empty caption would render an empty
                     element under the image on the public page. */
                  onValueChange({
                    ...value,
                    caption: caption.length > 0 ? caption : undefined,
                  })
                }
                placeholder="Published under the image. Optional."
                maxLength={200}
                optional
              />
            ) : null}

            {requireSanitised ? (
              <ToggleField
                label="Sanitised"
                checked={value.sanitised === true}
                onCheckedChange={(sanitised) =>
                  onValueChange({ ...value, sanitised })
                }
                description={
                  <>
                    ADR 009 — client data scrubbed, identifiers removed.{" "}
                    <strong>Publishing is blocked</strong> until every image on
                    this case study is marked.
                  </>
                }
              />
            ) : null}

            <div className="adm-asset-meta">
              <span title={value.url}>{value.storageKey ?? "no storage key"}</span>
              {value.width && value.height ? (
                <span>
                  {value.width}×{value.height}
                </span>
              ) : (
                <span>dimensions unknown</span>
              )}
              <button
                type="button"
                className="adm-btn"
                data-variant="ghost"
                data-size="sm"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  onValueChange(null);
                }}
              >
                Remove
              </button>
              {assetActions}
            </div>
          </div>
        </div>
      ) : null}

      {dropzone}

      {error ? (
        <p className="adm-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
