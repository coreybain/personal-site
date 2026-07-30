"use client";

import type { Doc } from "@home/convex/dataModel";
import type { MediaAsset } from "@home/types";
import { useState } from "react";

import {
  AdminNotice,
  Field,
  ImageUpload,
  RichTextEditor,
  SlugField,
  TextAreaField,
  TextField,
  findUnsupportedMarkdown,
  type ActionFailure,
} from "@/components/admin";

/**
 * The fields of a post, and the one shape the two post screens both hold.
 *
 * `/admin/posts/new` and `/admin/posts/[slug]` edit the same six values and call
 * two different mutations with them (`posts.create`, `posts.update`). This file is
 * the fields plus the conversions; the two pages own the calls. Splitting it that
 * way is what stops the create form and the editor drifting into two slightly
 * different definitions of a post — which is the usual outcome, and shows up as a
 * field you can set when creating and cannot change afterwards.
 *
 * ── `PostDraft` is not `Doc<'posts'>`, on purpose ───────────────────────────
 *
 * Two fields differ from the stored document and both differences are the form's:
 *
 *   `tagsInput`   The stored field is `string[]`. The form holds the raw comma
 *                 separated text, because a controlled input that round-trips
 *                 through an array cannot be typed in — splitting on every
 *                 keystroke deletes the comma the moment you press it. The array
 *                 is produced once, on save, by `parseTags`.
 *
 *   `coverImage`  Required in the schema, `null` here. A form that has not been
 *                 filled in yet has no image, and the alternative — a placeholder
 *                 asset with an empty URL — is a value the mutation would reject
 *                 with a message about URLs rather than one about the field being
 *                 empty.
 *
 * Everything else (`published`, `publishedAt`) is deliberately absent: neither is
 * an editable field. `posts.create` has no `published` argument at all and
 * `publishedAt` is written only by `posts.publish`, so a form that held them would
 * be a form with controls for values it cannot send.
 */

export type PostDraft = {
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  /** Comma separated. See the file header for why this is not `string[]`. */
  tagsInput: string;
  coverImage: MediaAsset | null;
};

/** A blank draft, for `/admin/posts/new`. */
export function emptyPostDraft(): PostDraft {
  return {
    title: "",
    slug: "",
    excerpt: "",
    body: "",
    tagsInput: "",
    coverImage: null,
  };
}

/** A stored post, as the form holds it. */
export function postDraftFromRow(row: Doc<"posts">): PostDraft {
  return {
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    body: row.body,
    tagsInput: row.tags.join(", "),
    coverImage: row.coverImage,
  };
}

/**
 * `"a, b, ,a"` → `["a", "b", "a"]`.
 *
 * Splits and trims and does nothing else. It deliberately does **not** de-duplicate
 * or bound the length: `normaliseTags` in `convex/posts.ts` drops blanks and
 * case-insensitive duplicates, preserves order, and rejects a tag over 40
 * characters with a message naming it. Doing any of that here would be a second
 * copy of a rule that already exists, and the copy is the one that goes stale.
 *
 * Blanks are dropped rather than passed through only because an empty string is
 * not a tag by any reading, and a trailing comma is the normal way to finish
 * typing a list.
 */
export function parseTags(input: string): string[] {
  return input
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

/** Have any of the six values changed? Drives `SaveButton`'s `dirty`. */
export function postDraftsEqual(a: PostDraft, b: PostDraft): boolean {
  return (
    a.title === b.title &&
    a.slug === b.slug &&
    a.excerpt === b.excerpt &&
    a.body === b.body &&
    a.tagsInput === b.tagsInput &&
    /* Structural compare: `MediaAsset` is a flat object of primitives written
       wholesale by `ImageUpload`, so stringify is exact here and a field-by-field
       compare would be seven lines that need editing when the shape changes. */
    JSON.stringify(a.coverImage) === JSON.stringify(b.coverImage)
  );
}

/**
 * Route a backend failure to the field it names.
 *
 * `convex/posts.ts` throws `ConvexError({ code, field, message })` and its
 * `field` values are the argument names — `'title'`, `'slug'`, `'tags'`,
 * `'coverImage.alt'`. `usePendingAction` keeps `field` on the failure so the
 * message can appear under the input that caused it instead of only next to the
 * button, which is the difference between "the server refused this" and knowing
 * which of eleven fields to look at.
 *
 * Prefix matching, so `coverImage.url` and `coverImage.alt` both land on
 * `coverImage`. The message itself is always shown verbatim — it is written for
 * the person reading it.
 */
function errorFor(
  failure: ActionFailure | null,
  field: string,
): string | undefined {
  if (!failure?.field) {
    return undefined;
  }

  return failure.field === field || failure.field.startsWith(`${field}.`)
    ? failure.message
    : undefined;
}

/**
 * `["a table", "an image"]` → `"a table and an image"`.
 *
 * `findUnsupportedMarkdown` returns its constructs already phrased for a sentence,
 * which is the whole reason it does; this joins them the way a person would.
 */
function listConstructs(found: readonly string[]): string {
  if (found.length <= 1) {
    return found[0] ?? "";
  }

  return `${found.slice(0, -1).join(", ")} and ${found[found.length - 1]}`;
}

export type PostFieldsProps = {
  draft: PostDraft;
  onDraftChange: (draft: PostDraft) => void;
  /**
   * The stored `published` flag, or `false` on a new post. Only used to switch
   * `SlugField`'s hint to the link-breaking warning — nothing here can change it.
   */
  published?: boolean;
  /** The last mutation failure, so its message can be shown at its field. */
  failure?: ActionFailure | null;
  /** True while a save is in flight. */
  disabled?: boolean;
};

export function PostFields({
  draft,
  onDraftChange,
  published = false,
  failure = null,
  disabled,
}: PostFieldsProps) {
  /** One patch helper, so every field below is a one-liner. */
  const set = <K extends keyof PostDraft>(key: K, value: PostDraft[K]) => {
    onDraftChange({ ...draft, [key]: value });
  };

  /**
   * Which control the body gets, decided **once** on mount.
   *
   * `RichTextEditor` destroys a handful of Markdown constructs silently — a GFM
   * table becomes the empty string, an image becomes its alt text — and the kit's
   * guidance for a form that can see the problem coming is to not offer the editor
   * at all rather than to warn about it (README §4b). So a body that already
   * contains one of them is edited as source.
   *
   * Snapshotted with `useState` rather than recomputed per render for two reasons.
   * The obvious one is that swapping the control while someone is typing would
   * destroy the caret and the undo history. The subtler one is that it would not
   * work anyway: the editor cannot *produce* an unsupported construct, so a live
   * check would flip to the textarea the moment a stored table was parsed away and
   * then flip straight back, having lost the table in between. The check has to be
   * on what was loaded.
   *
   * The form is remounted per post (`key={row._id}` in `PostEditor`), so "on mount"
   * is "per post", which is the granularity this wants.
   */
  const [unsupported] = useState(() => findUnsupportedMarkdown(draft.body));

  return (
    <>
      <TextField
        label="Title"
        value={draft.title}
        onValueChange={(title) => set("title", title)}
        placeholder="What the post is called"
        /* Mirrors MAX_TITLE in convex/posts.ts. A courtesy — the mutation holds
           the real bound. */
        maxLength={200}
        required
        disabled={disabled}
        error={errorFor(failure, "title")}
      />

      <SlugField
        value={draft.slug}
        onValueChange={(slug) => set("slug", slug)}
        source={draft.title}
        prefix="/blog/"
        published={published}
        required
        disabled={disabled}
        error={errorFor(failure, "slug")}
      />

      {/* The hint keeps the *constraint* — how long it should be — and the reason
          it matters moves into `info`. `hint` is documented as small print about
          the format, not about the field. */}
      <TextAreaField
        label="Excerpt"
        value={draft.excerpt}
        onValueChange={(excerpt) => set("excerpt", excerpt)}
        info={
          <>
            The blog index shows this instead of the post, and it becomes the
            page&rsquo;s meta description — so it is read far more often than the
            post itself is.
          </>
        }
        infoLabel="About the excerpt"
        hint="One or two sentences."
        placeholder="The short version."
        rows={3}
        maxLength={400}
        required
        disabled={disabled}
        error={errorFor(failure, "excerpt")}
      />

      <TextField
        label="Tags"
        value={draft.tagsInput}
        onValueChange={(tagsInput) => set("tagsInput", tagsInput)}
        info={
          <>
            Blanks and repeats are dropped on save, case-insensitively and in
            order. At most 12 tags, each 40 characters or fewer;{" "}
            <code>posts.create</code> refuses a longer one by name.
          </>
        }
        infoLabel="About tags"
        hint="Comma separated."
        placeholder="convex, next, agents"
        optional
        disabled={disabled}
        error={errorFor(failure, "tags")}
      />

      <ImageUpload
        label="Cover image"
        value={draft.coverImage}
        onValueChange={(coverImage) => set("coverImage", coverImage)}
        /* No `requireSanitised`. ADR 009's gate is about client screenshots in
           `projects.media`; a blog cover is not client work, which is why
           `posts.publish` does not ask about the field and why leaving the prop
           unset — so the field is *absent* rather than `false` — is correct.

           No `withCaption` either: a cover image is a banner, not a figure. It
           has no position on the page for a caption to sit under, and offering
           the field would invite the alt text to be pasted into it. */
        hint="Required — the blog index renders it."
        disabled={disabled}
      />
      {errorFor(failure, "coverImage") ? (
        <p className="adm-error" role="alert">
          {errorFor(failure, "coverImage")}
        </p>
      ) : null}

      {/*
        ── The body ─────────────────────────────────────────────────────────────

        A real editor, which the comment that used to sit here said was out of
        scope. `RichTextEditor` is Markdown in and Markdown out, so the stored
        value is the same string this field has always held and every consumer —
        the public renderer, the iOS app — is unaffected. What changed is that
        `## ` and ⌘B now do what they look like they do.

        Two things the textarea had and this does not, both deliberate:

          • **No `maxLength`.** The editor is a `contenteditable`, which has no
            such attribute. MAX_BODY (~120 KB, a fifth of Convex's per-document
            limit) is enforced by `posts.update`, which is where it always was —
            the textarea's copy was a courtesy, and losing it costs a save round
            trip in the one case where a post is longer than a novella.

          • **No monospace.** The point of a proportional face here is that the
            body is prose; a fenced code block inside it still renders mono,
            because `.adm-rte-content pre` says so.
      */}
      {unsupported.length > 0 ? (
        <>
          {/* Inline and loud, not a tooltip: this is the ADR-009 rule from
              README §2a applied to a different irreversible consequence. The
              reader is being told why the field looks different from the one they
              saw on the last post, and the alternative to telling them is losing
              their table. */}
          <AdminNotice tone="warn" title="Edited as Markdown source">
            This body contains {listConstructs(unsupported)}, which the rich text
            editor cannot represent — opening it there would delete it on the first
            keystroke. The plain Markdown field is used instead. Remove the
            construct and reload to get the editor.
          </AdminNotice>

          <TextAreaField
            label="Body"
            value={draft.body}
            onValueChange={(body) => set("body", body)}
            rows={24}
            maxLength={120_000}
            mono
            required
            disabled={disabled}
            error={errorFor(failure, "body")}
          />
        </>
      ) : (
        <Field label="Body" required error={errorFor(failure, "body")}>
          {({ id, describedBy, invalid }) => (
            <RichTextEditor
              id={id}
              describedBy={describedBy}
              invalid={invalid}
              /* Not optional in practice: `Field`'s `<label htmlFor>` cannot
                 associate with a `contenteditable`, which is not a labelable
                 element, so without this the visible label is decoration as far
                 as a screen reader is concerned. README §4b. */
              ariaLabel="Body"
              value={draft.body}
              onChange={(body) => set("body", body)}
              placeholder="Write the post…"
              /* Taller than the default 8 because a post is the longest thing in
                 this admin, shorter than the textarea's 24 rows because the
                 editor *grows*: 24 rows of empty box was a screen of nothing
                 between the fields and the save button. */
              minRows={14}
              disabled={disabled}
            />
          )}
        </Field>
      )}
    </>
  );
}
