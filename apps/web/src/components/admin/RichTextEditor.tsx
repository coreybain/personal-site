"use client";

import { isMacOS } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { AdminNotice } from "./AdminPage";

/**
 * The long-form editor. Markdown in, Markdown out.
 *
 * ── The value contract, and why it is a string ───────────────────────────────
 *
 * `value` is a **Markdown string** and `onChange` hands back a **Markdown
 * string**. Not HTML, not ProseMirror JSON. That is not a stylistic preference:
 * `posts.body`, `projects.body` and `projects.problem/approach` are
 * `v.string()` markdown in the Convex schema, the public site renders them as
 * markdown, and phase 5's PDF résumé consumes the same strings. This component
 * is a *view* over a field the rest of the system already owns. If it introduced
 * a storage format of its own, every consumer would need a ProseMirror schema to
 * read a paragraph, and the day someone edits a body with `TextAreaField mono`
 * (which still exists and is still right for short fields) the two formats would
 * diverge with no way to tell which is authoritative.
 *
 * The serializer is `@tiptap/markdown` — first-party, versioned in lockstep with
 * core. README §4b has the full rationale for that choice over the community
 * `tiptap-markdown`, and for why all five Tiptap packages are pinned exactly.
 *
 * ── Round-trip fidelity: measured, not assumed ───────────────────────────────
 *
 * A markdown editor's real failure mode is quiet: you open a body, type one
 * character, save, and a construct the editor could not represent is gone. So
 * the parse → serialize path was driven headlessly over 33 constructs before
 * this file was written (`MarkdownManager` with this exact extension list, no
 * DOM needed). What came back:
 *
 * **Byte-identical** — ATX headings at every level, paragraphs, `**bold**`,
 * `*italic*`, `` `code` ``, `~~strike~~`, `[text](href)` including a title
 * attribute and relative hrefs, tight bullet lists including nested ones,
 * ordered lists, blockquotes (including a list inside one), fenced code blocks
 * with and without a language, `---`, two-space hard breaks, and HTML entities.
 *
 * **Rewritten but equivalent** — these change the bytes and render the same, so
 * a body that has never been edited here will come back from its first keystroke
 * with a diff wider than the edit:
 *
 *   - Markdown-significant characters in prose get backslash-escaped:
 *     `5 * 3` → `5 \* 3`, `a_b_c` → `a\_b\_c`.
 *   - A bare URL in a *loaded* body becomes an explicit link:
 *     `https://x.com` → `[https://x.com](https://x.com)`. That is `marked`'s
 *     GFM tokenizer, not the Link extension's `autolink`, which is switched off
 *     below — so a URL you *type* stays a URL.
 *   - Loose lists are tightened (the blank line between items is dropped).
 *   - A trailing run of blank lines collapses to one.
 *
 * **Lossy — the reason `findUnsupportedMarkdown` exists below:**
 *
 *   | Construct | What comes back |
 *   | --- | --- |
 *   | GFM table | **the empty string** — the whole table is deleted |
 *   | `![alt](src)` image | `alt` — the URL is gone |
 *   | `- [ ]` task list | `- ` — the checkbox is gone |
 *   | `[^1]` footnote | `Text[^1](note)` — mangled into a link-ish shape |
 *   | raw inline HTML | `&lt;em&gt;` — entity-escaped into visible source |
 *
 * Tables and task lists are lost because their extensions are not installed and
 * `@tiptap/markdown` only serialises what the extension list knows about;
 * footnotes because `marked` tokenises them and nothing claims the token. All of
 * them are *silent*, which is why this component refuses to be quiet about them:
 * it renders an inline warning naming the construct, above the toolbar, on the
 * same principle as the ADR-009 publish blocker (README §2a) — a consequence you
 * cannot undo does not go behind a tooltip.
 *
 * Two smaller notes on headings. The schema carries levels 2–4 (the toolbar's
 * vocabulary: h1 is the page title, and a body that needs h5 needs restructuring
 * instead), but ProseMirror does not validate the `level` attribute against that
 * list, so an existing `# One` or `##### Five` survives a round trip **as
 * markdown** while *displaying* as an h2 — wrong-looking, not destructive.
 * `findUnsupportedMarkdown` flags it anyway, because "why is my h1 rendering
 * small" deserves an answer on the page.
 *
 * ── Why there is no image button ─────────────────────────────────────────────
 *
 * Media does not flow through this component in v1, and not only because
 * `@tiptap/extension-image` is not installed. Every image in this system is an
 * `MediaAsset` — a `UploadThing` URL plus alt text, measured `width`/`height`,
 * and for `projects.media` the ADR-009 `sanitised` flag that `projects.publish`
 * asserts on. A markdown `![alt](src)` carries the first two of those five and
 * has nowhere to put the rest, so an image pasted into a body would be an asset
 * that bypasses the sanitisation gate. Images go through `ImageUpload` /
 * `MediaListEditor`, which is where those fields live. See README §Media.
 *
 * ── Controlled, but not reset on every keystroke ─────────────────────────────
 *
 * The naive `content: value` + `setContent(value)`-on-change loop destroys the
 * selection on every character: you type, the parent re-renders with the new
 * value, the effect writes it back, the document is replaced and the caret jumps
 * to the top. The standard Tiptap pattern, and what this does, is to remember
 * the last string *we* emitted and ignore the echo:
 *
 *   - `content` is captured **once**, into `useState`, so the options object
 *     handed to `useEditor` never changes identity for it. (`useEditor`
 *     shallow-compares its options on every render and calls `setOptions` on a
 *     mismatch, which is why `extensions` and `editorProps` are memoised too, and
 *     why `editable` is captured the same way and then driven by `setEditable`.)
 *   - The `update` handler records what it serialised, then calls `onChange`.
 *   - The effect below writes an incoming `value` in **only** when it differs
 *     from both the last emitted string and the current serialisation — a real
 *     external change (a load finishing, a discard, a form reset).
 *
 * The `update` handler is attached to the instance in an effect rather than passed
 * as the `onUpdate` option, and reaches `onChange` through `useEffectEvent`,
 * because the `Editor` registers its listeners once in its constructor and a
 * later `setOptions` does not rebind them. An `onUpdate` closing over the first
 * render's `onChange` would mean every keystroke after the first parent
 * re-render writes to a stale setter.
 *
 * ── SSR ─────────────────────────────────────────────────────────────────────
 *
 * `immediatelyRender: false` per Tiptap's Next.js guidance: ProseMirror needs a
 * `document`, so the editor is created in an effect and `useEditor` returns
 * `null` for the server render *and* for the first client render. That is what
 * makes hydration match. The toolbar is rendered only once `editor` exists,
 * which is also why it may call `isMacOS()` freely — that render never happens on
 * the server, so there is no `⌘`/`Ctrl` mismatch to hydrate.
 */

/* ------------------------------------------------------------------ *
 * Fidelity guard
 * ------------------------------------------------------------------ */

/**
 * Names the constructs in `md` that this editor cannot represent, in the words
 * to put in a sentence ("a table", "an image"). Empty array means the body is
 * safe to edit here.
 *
 * The component calls this on its own `value` and warns inline. It is exported
 * because a *form* can do better than a warning: a screen that knows a body
 * contains a table can render `TextAreaField` with `mono` instead and never
 * offer the editor at all.
 *
 * Fenced code blocks are stripped first, so a pipe table pasted inside triple
 * backticks — which round-trips perfectly, being just text — does not trip it.
 */
export function findUnsupportedMarkdown(md: string): string[] {
  if (!md) {
    return [];
  }

  /* Fences and inline code spans are verbatim text on the way through, so
     anything inside them is not markdown for our purposes. */
  const prose = md
    .replace(/^[ \t]{0,3}(```|~~~)[\s\S]*?^[ \t]{0,3}\1[ \t]*$/gm, "")
    .replace(/`[^`\n]*`/g, "");

  const found: string[] = [];

  /* A GFM delimiter row: at least two columns of dashes, optional alignment
     colons. Matching the delimiter rather than a `|` line avoids claiming every
     sentence that happens to contain a pipe. */
  if (/^[ \t]{0,3}\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$/m.test(prose)) {
    found.push("a table");
  }

  if (/!\[[^\]]*\]\(|!\[[^\]]*\]\[/.test(prose)) {
    found.push("an image");
  }

  if (/^[ \t]*[-+*][ \t]+\[[ xX]\][ \t]+/m.test(prose)) {
    found.push("a task list");
  }

  if (/\[\^[^\]\s]+\]/.test(prose)) {
    found.push("a footnote");
  }

  /* A real tag, not an autolink: `<https://x.com>` must not match, so the tag
     name has to be followed by whitespace, a slash or the closing bracket. */
  if (/<\/?[a-zA-Z][a-zA-Z0-9-]*([ \t\n][^>]*)?\/?>/.test(prose)) {
    found.push("inline HTML");
  }

  if (/^[ \t]{0,3}#(?!#)[ \t]/m.test(prose)) {
    found.push("a level-1 heading");
  }

  if (/^[ \t]{0,3}#{5,6}[ \t]/m.test(prose)) {
    found.push("a heading below level 4");
  }

  return found;
}

/* ------------------------------------------------------------------ *
 * Toolbar
 * ------------------------------------------------------------------ */

/**
 * What the buttons look like, and why they are mostly text.
 *
 * Eleven of the thirteen buttons are labelled with the **Markdown they produce** —
 * `H2`, `B`, `` ` ``, `-`, `1.`, `>`, ` ``` `, `---` — set in the admin's mono
 * face. Drawing thirteen glyphs as SVG would have meant inventing an icon for
 * "ordered list" that reads as clearly as `1.` does in a Markdown field, and the
 * text labels teach the syntax for the person who would rather type it. The two
 * exceptions are link and unlink, where the chain is genuinely the universal
 * icon and `[]` is not.
 *
 * Each button carries an `aria-label` (the real name — a screen reader must not
 * hear "backtick") and a `title` naming the shortcut. `title` rather than an
 * `InfoTip` per button: thirteen hand-rolled tooltips in a 30px-tall strip is a
 * hover minefield, and the `aria-label` already carries the name into the
 * accessible tree, which is the part `title` cannot be trusted for.
 *
 * Toggles get `aria-pressed`. Link and horizontal rule do not — they are
 * actions, not states, and a button that reports a state it does not have is
 * worse than one that reports none.
 */
type ToolButtonProps = {
  label: string;
  hint: string;
  glyph: ReactNode;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
  /** Set for actions rather than toggles: omits `aria-pressed` entirely. */
  action?: boolean;
};

function ToolButton({
  label,
  hint,
  glyph,
  onPress,
  active,
  disabled,
  action,
}: ToolButtonProps) {
  return (
    <button
      type="button"
      className="adm-rte-btn"
      data-active={active ? "true" : undefined}
      aria-label={label}
      aria-pressed={action ? undefined : Boolean(active)}
      title={hint}
      disabled={disabled}
      /* `onMouseDown` + `preventDefault` keeps the selection: a plain click
         blurs the editable first, so `toggleBold` would run with a collapsed
         cursor and mark nothing. The command still runs on `click` so that
         keyboard activation (Enter/Space, which fire click and not mousedown)
         works. */
      onMouseDown={(event) => event.preventDefault()}
      onClick={onPress}
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}

/**
 * Chain, horizontal: two stadium halves and the bar between them. 20×20 viewBox
 * and 13px rendered, matching the kit's other inline SVGs (see `InfoTip`).
 *
 * `off` adds the diagonal. A "broken chain" drawn as the same shape with the bar
 * removed was the first attempt and is indistinguishable from the linked state at
 * 13px, which is the size that matters.
 */
function LinkGlyph({ off }: Readonly<{ off?: boolean }>) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12.5 5.8H15a4.2 4.2 0 0 1 0 8.4h-2.5" />
      <path d="M7.5 14.2H5a4.2 4.2 0 0 1 0-8.4h2.5" />
      {off ? <path d="M4.6 15.4 15.4 4.6" /> : <path d="M6.7 10h6.6" />}
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * RichTextEditor
 * ------------------------------------------------------------------ */

export type RichTextEditorProps = {
  /** The current Markdown. */
  value: string;
  /** Receives the new Markdown on every edit. */
  onChange: (markdown: string) => void;
  /** Shown over an empty document. Not a `<input placeholder>` — see below. */
  placeholder?: string;
  /** Read-only. The toolbar disables with it. */
  disabled?: boolean;
  /** Minimum height of the writing area, in lines. Default 8. */
  minRows?: number;
  /**
   * The three below are the wiring `Field`'s render prop hands out, so the
   * editor can be dropped into one:
   *
   * ```tsx
   * <Field label="Body" error={failure?.message}>
   *   {({ id, describedBy, invalid }) => (
   *     <RichTextEditor
   *       id={id} describedBy={describedBy} invalid={invalid}
   *       ariaLabel="Body"
   *       value={body} onChange={setBody}
   *     />
   *   )}
   * </Field>
   * ```
   *
   * **`ariaLabel` is not optional in practice.** `Field` renders
   * `<label htmlFor>`, and `for` only associates with a *labelable* element — a
   * `contenteditable` div is not one, so the label is decoration to assistive
   * tech unless the name is repeated here (or `ariaLabelledBy` points at an
   * element that has it).
   */
  id?: string;
  describedBy?: string;
  invalid?: boolean;
  ariaLabel?: string;
  ariaLabelledBy?: string;
};

/** The toolbar's view of the editor. One object so one selector drives it all. */
type Snapshot = {
  h2: boolean;
  h3: boolean;
  h4: boolean;
  bold: boolean;
  italic: boolean;
  code: boolean;
  link: boolean;
  bulletList: boolean;
  orderedList: boolean;
  blockquote: boolean;
  codeBlock: boolean;
};

/**
 * What the toolbar shows before the editor's first transaction.
 *
 * It is reached more often than it looks. `useEditorState` caches its snapshot
 * against a transaction counter, and the editor being *created* is not a
 * transaction — so between mount and the first edit or selection change, the
 * selector still sees the `null` editor it was first called with. Every field
 * here is therefore "nothing is active", which is the truth for a document
 * nobody has put a caret in yet.
 *
 * It is also the reason the placeholder is **not** derived from
 * `editor.isEmpty`: it would report a seeded document as empty for exactly that
 * window and paint the placeholder over the first line of real content. (It did.
 * That is what the harness screenshot caught.) The controlled `value` is the
 * honest source for "is there anything in here", and React already tracks it.
 */
const IDLE: Snapshot = {
  h2: false,
  h3: false,
  h4: false,
  bold: false,
  italic: false,
  code: false,
  link: false,
  bulletList: false,
  orderedList: false,
  blockquote: false,
  codeBlock: false,
};

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  disabled = false,
  minRows = 8,
  id,
  describedBy,
  invalid = false,
  ariaLabel,
  ariaLabelledBy,
}: RichTextEditorProps) {
  /**
   * The value and the editable flag as they were at mount. `useState` with a
   * lazy initialiser rather than a ref, because this *is* read during render (it
   * is what `useEditor` is constructed with) and a ref read during render is
   * both a lint error under `react-hooks/refs` and a real hazard: a value React
   * cannot see cannot be a render input. Never updated — see the docblock on why
   * `content` must not follow the prop.
   */
  const [initial] = useState(() => ({ value, editable: !disabled }));

  /** The last Markdown this component emitted, so it can ignore the echo. */
  const emitted = useRef(value);

  /**
   * What the `update` subscription below calls. `useEffectEvent` (React 19.2) is
   * exactly the primitive this needs: a function that is *stable* — so the
   * listener is attached once per editor and not re-attached on every render
   * where the parent passed a fresh inline `onChange` — while still seeing the
   * *current* `onChange`. A ref would do the same job and is what this was
   * written as first; the effect event says why, and is not a ref read during
   * render.
   */
  const emitMarkdown = useEffectEvent((markdown: string) => {
    emitted.current = markdown;
    onChange(markdown);
  });

  /* Memoised so `useEditor`'s per-render options comparison keeps passing and it
     never calls `setOptions`. The extension list has no inputs at all. */
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        /* h1 is the page's own title and h5/h6 are a restructure waiting to
           happen. Note this constrains the *commands and input rules*, not the
           schema — see the docblock on what an existing `# One` does. */
        heading: { levels: [2, 3, 4] },
        /*
         * Underline off. It is the one StarterKit mark with no Markdown: this
         * version serialises it as `++text++`, which is a Pandoc-family
         * extension that neither the public site's renderer nor GitHub
         * understands, so Cmd+U would quietly write visible `++` into a body.
         * Strike stays on, because `~~text~~` is GFM and does round-trip.
         */
        underline: false,
        /* prosemirror-dropcursor writes its colour as an inline style, so this
           is the only way to theme it; its default is black, which on the
           admin's dark chrome is an invisible drop target. A `var()` in an
           inline style resolves against the element, and the cursor is inserted
           inside the `.hor` scope, so the token is in scope. */
        dropcursor: { color: "var(--hor-accent)", width: 2 },
        link: {
          /* An editor where clicking a link navigates away is an editor you
             cannot put the caret inside. */
          openOnClick: false,
          /*
           * Autolink **off**, which is not the default and was decided by
           * watching it misfire: typing after a numbered-list-like "3." made
           * "3.XYZ", which linkify recognises (`.xyz` is a real TLD) and silently
           * turned into a link mark, which then serialised as
           * `[3.XYZ](http://3.XYZ)` in the body. Quietly rewriting prose into
           * markup is the one thing this component must not do. Nothing is lost
           * by switching it off either: a bare URL left as text serialises as a
           * bare URL, and GFM renders that as a link anyway. (Note the asymmetry
           * — an existing bare URL in a *loaded* body still becomes a link mark,
           * because that comes from `marked`'s tokenizer rather than from this
           * option. See the fidelity table.)
           */
          autolink: false,
          /* Kept: pasting a URL over a selection is how anyone actually makes a
             link, and it is explicit rather than inferred. */
          linkOnPaste: true,
        },
      }),
      Markdown.configure({
        /* Two spaces is what the repo's existing bodies use and what `marked`
           reads back unambiguously; a tab inside a list item is a code block in
           some readers. `marked` already defaults to `gfm: true`, which is where
           `~~strike~~` and fenced code come from, so `markedOptions` is left
           alone rather than restated. */
        indentation: { style: "space", size: 2 },
      }),
    ],
    [],
  );

  /* Also memoised, and separate from the above because these *do* have inputs:
     a11y attributes have to be able to change (a validation error arriving sets
     `invalid`), and the only way onto the editable element is ProseMirror's
     `attributes` prop. */
  const editorProps = useMemo(
    () => ({
      attributes: {
        class: "adm-rte-content",
        /* A `contenteditable` div is announced as a textbox by most screen
           readers already; saying so explicitly, with `aria-multiline`, is the
           difference between "edit text" and "edit text, multiline" and costs
           nothing. */
        role: "textbox",
        "aria-multiline": "true",
        ...(id ? { id } : {}),
        ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
        ...(ariaLabelledBy ? { "aria-labelledby": ariaLabelledBy } : {}),
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
        ...(invalid ? { "aria-invalid": "true" } : {}),
      },
    }),
    [id, ariaLabel, ariaLabelledBy, describedBy, invalid],
  );

  const editor = useEditor({
    extensions,
    content: initial.value,
    /* REQUIRED. The default is `'json'`, and without this the Markdown string is
       parsed as HTML — `## Heading` becomes a paragraph reading "## Heading".
       Every other content path needs it too; see `setContent` below. */
    contentType: "markdown",
    editable: initial.editable,
    editorProps,
    /* ProseMirror needs a `document`; this defers creation to an effect so the
       server render and the first client render agree. */
    immediatelyRender: false,
    /* The toolbar re-renders through `useEditorState`, which only wakes when the
       selected booleans actually change. Re-rendering this whole subtree on
       every transaction is the legacy path and would re-render on every
       keypress. */
    shouldRerenderOnTransaction: false,
  });

  /*
   * Serialise and report on every edit.
   *
   * Subscribed here rather than passed as the `onUpdate` option, and the reason
   * is not cosmetic: the `Editor` registers its `update` listener once, in its
   * constructor, from the options it was constructed with, and a later
   * `setOptions` does **not** rebind it. An `onUpdate` in the options object is
   * therefore frozen at first render. Attaching it to the instance instead ties
   * the listener to the editor's lifetime, which is what it actually belongs to.
   */
  useEffect(() => {
    if (!editor) {
      return;
    }

    const onEdit = () => emitMarkdown(editor.getMarkdown());

    editor.on("update", onEdit);

    return () => {
      editor.off("update", onEdit);
    };
  }, [editor]);

  /*
   * External value changes only. Runs on every `value` change and does nothing
   * for the overwhelming majority of them, which are our own emissions coming
   * back through the parent's state.
   */
  useEffect(() => {
    if (!editor) {
      return;
    }

    if (value === emitted.current) {
      return;
    }

    /* Second guard, for the case the first cannot see: a remount or a re-fetch
       hands us a string equal to what the document already holds while
       `emitted` still remembers something older. Serialising to compare is only
       reached when the strings genuinely differ, so it is not on the typing
       path. */
    if (value === editor.getMarkdown()) {
      emitted.current = value;
      return;
    }

    emitted.current = value;

    /* A blank value takes the string path rather than the markdown one on
       purpose: `MarkdownManager.parse("")` yields `{type:'doc',content:[]}`,
       which violates the schema's `block+`, whereas core's `setContent("")`
       builds the empty paragraph a document needs. (Tiptap guards this at
       construction and not in the command, so the asymmetry is real.)

       `emitUpdate: false` in both branches: this *is* the parent's value, and
       echoing it back as a change would either loop or mark a pristine form
       dirty. Replacing the document does reset the selection to the top, which
       is correct for the cases that reach here — a load, a discard, a reset. */
    if (value.trim() === "") {
      editor.commands.clearContent(false);
      return;
    }

    editor.commands.setContent(value, {
      contentType: "markdown",
      emitUpdate: false,
    });
  }, [editor, value]);

  /* `disabled` is not driven through the options object because `useEditor`
     re-applies `editable` from `editor.isEditable` when it re-syncs, which would
     fight this. `setEditable` is the supported route. The condition reads oddly
     and is exactly right: `isEditable === disabled` is the out-of-sync case. */
  useEffect(() => {
    if (editor && editor.isEditable === disabled) {
      editor.setEditable(!disabled);
    }
  }, [editor, disabled]);

  const state =
    useEditorState({
      editor,
      selector: ({ editor: instance }): Snapshot =>
        instance
          ? {
              h2: instance.isActive("heading", { level: 2 }),
              h3: instance.isActive("heading", { level: 3 }),
              h4: instance.isActive("heading", { level: 4 }),
              bold: instance.isActive("bold"),
              italic: instance.isActive("italic"),
              code: instance.isActive("code"),
              link: instance.isActive("link"),
              bulletList: instance.isActive("bulletList"),
              orderedList: instance.isActive("orderedList"),
              blockquote: instance.isActive("blockquote"),
              codeBlock: instance.isActive("codeBlock"),
            }
          : IDLE,
    }) ?? IDLE;

  /**
   * The link prompt.
   *
   * `window.prompt`, and not apologetically: the alternative is a floating input
   * with its own focus management, escape handling and positioning — a modal
   * dialog in all but name, which §6 of the README declines for the same reason
   * it declines one for delete. The native prompt is keyboard-operable, screen
   * -reader-announced and dismissable for free.
   *
   * `extendMarkRange('link')` first, so with the caret merely *inside* a link the
   * whole link is the target — otherwise editing an existing href either splits
   * it or does nothing.
   */
  const promptForLink = useCallback(() => {
    if (!editor) {
      return;
    }

    const existing = (editor.getAttributes("link").href as string | undefined) ?? "";
    const answer = window.prompt("Link URL — empty to remove the link", existing);

    /* Cancel returns null and must not touch the document. An empty string is a
       deliberate "remove this link", which is a different answer. */
    if (answer === null) {
      return;
    }

    const href = answer.trim();

    if (href === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }

    /*
     * Bare hostnames get `https://`. Anything already carrying a scheme, and the
     * three shapes that are meaningful *without* one — a site-relative path, a
     * fragment, a query — are passed through untouched, because `/work/thing` is
     * a link this admin writes constantly and `https:///work/thing` is not.
     */
    const normalised =
      /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href) || /^[/#?]/.test(href)
        ? href
        : `https://${href}`;

    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: normalised })
      .run();
  }, [editor]);

  /* Only reachable from a client render (see the SSR note), so reading the
     platform here cannot desynchronise a hydration. */
  const mod = editor && isMacOS() ? "⌘" : "Ctrl+";
  const alt = editor && isMacOS() ? "⌥" : "Alt+";

  const lossy = findUnsupportedMarkdown(value);

  return (
    <div className="adm-rte-wrap">
      {lossy.length > 0 ? (
        /*
         * Inline and loud, not a tooltip. This is the same call as the ADR-009
         * publish blocker (README §2a): the reader has to know *before* they
         * type that saving from here deletes something, and a fact you must act
         * on cannot be behind a hover.
         */
        <AdminNotice tone="warn" title="This body will lose content if you edit it here">
          It contains {lossy.join(", ")}, which the rich-text editor cannot
          represent — saving from here drops it. Edit the Markdown directly
          instead, or move the content into a field that supports it.
        </AdminNotice>
      ) : null}

      <div
        className="adm-rte"
        data-disabled={disabled ? "true" : undefined}
        data-invalid={invalid ? "true" : undefined}
        /* Lines, not pixels: the writing area should be N lines of *this* type
           at *this* line-height, both of which live in the stylesheet. */
        style={{ "--adm-rte-rows": minRows } as CSSProperties}
      >
        {/*
         * `role="group"`, not `role="toolbar"`. Toolbar is APG's single-tab-stop
         * pattern and promises arrow-key navigation between the buttons; these
         * are thirteen ordinary buttons in the tab order, which is the honest
         * description and what every editor toolbar on the web actually does.
         * The role is there so the `aria-label` is not discarded — a name on a
         * roleless `div` is ignored.
         */}
        <div className="adm-rte-bar" role="group" aria-label="Formatting">
          {editor ? (
            <>
              <div className="adm-rte-group">
                <ToolButton
                  label="Heading 2"
                  hint={`Heading 2 (${mod}${alt}2)`}
                  glyph="H2"
                  active={state.h2}
                  disabled={disabled}
                  onPress={() =>
                    editor.chain().focus().toggleHeading({ level: 2 }).run()
                  }
                />
                <ToolButton
                  label="Heading 3"
                  hint={`Heading 3 (${mod}${alt}3)`}
                  glyph="H3"
                  active={state.h3}
                  disabled={disabled}
                  onPress={() =>
                    editor.chain().focus().toggleHeading({ level: 3 }).run()
                  }
                />
                <ToolButton
                  label="Heading 4"
                  hint={`Heading 4 (${mod}${alt}4)`}
                  glyph="H4"
                  active={state.h4}
                  disabled={disabled}
                  onPress={() =>
                    editor.chain().focus().toggleHeading({ level: 4 }).run()
                  }
                />
              </div>

              <div className="adm-rte-group">
                <ToolButton
                  label="Bold"
                  hint={`Bold (${mod}B)`}
                  glyph={<strong>B</strong>}
                  active={state.bold}
                  disabled={disabled}
                  onPress={() => editor.chain().focus().toggleBold().run()}
                />
                <ToolButton
                  label="Italic"
                  hint={`Italic (${mod}I)`}
                  glyph={<em>I</em>}
                  active={state.italic}
                  disabled={disabled}
                  onPress={() => editor.chain().focus().toggleItalic().run()}
                />
                <ToolButton
                  label="Inline code"
                  hint={`Inline code (${mod}E)`}
                  glyph="`"
                  active={state.code}
                  disabled={disabled}
                  onPress={() => editor.chain().focus().toggleCode().run()}
                />
              </div>

              <div className="adm-rte-group">
                <ToolButton
                  label={state.link ? "Edit link" : "Add link"}
                  hint={state.link ? "Edit link" : "Add link"}
                  glyph={<LinkGlyph />}
                  active={state.link}
                  disabled={disabled}
                  action
                  onPress={promptForLink}
                />
                <ToolButton
                  label="Remove link"
                  hint="Remove link"
                  glyph={<LinkGlyph off />}
                  disabled={disabled || !state.link}
                  action
                  onPress={() =>
                    editor
                      .chain()
                      .focus()
                      .extendMarkRange("link")
                      .unsetLink()
                      .run()
                  }
                />
              </div>

              <div className="adm-rte-group">
                <ToolButton
                  label="Bullet list"
                  hint={`Bullet list (${mod}Shift+8)`}
                  glyph="-"
                  active={state.bulletList}
                  disabled={disabled}
                  onPress={() => editor.chain().focus().toggleBulletList().run()}
                />
                <ToolButton
                  label="Numbered list"
                  hint={`Numbered list (${mod}Shift+7)`}
                  glyph="1."
                  active={state.orderedList}
                  disabled={disabled}
                  onPress={() => editor.chain().focus().toggleOrderedList().run()}
                />
                <ToolButton
                  label="Blockquote"
                  hint={`Blockquote (${mod}Shift+B)`}
                  glyph=">"
                  active={state.blockquote}
                  disabled={disabled}
                  onPress={() => editor.chain().focus().toggleBlockquote().run()}
                />
                <ToolButton
                  label="Code block"
                  hint={`Code block (${mod}${alt}C)`}
                  glyph="```"
                  active={state.codeBlock}
                  disabled={disabled}
                  onPress={() => editor.chain().focus().toggleCodeBlock().run()}
                />
                <ToolButton
                  label="Horizontal rule"
                  hint="Horizontal rule"
                  glyph="---"
                  disabled={disabled}
                  action
                  onPress={() => editor.chain().focus().setHorizontalRule().run()}
                />
              </div>
            </>
          ) : null}
        </div>

        <div className="adm-rte-body">
          {/*
           * The placeholder is ours rather than Tiptap's. `Placeholder` lives in
           * `@tiptap/extensions`, which is a *transitive* dependency of
           * StarterKit — present in the store, not linked into `apps/web`, so
           * `import { Placeholder } from '@tiptap/extensions'` does not resolve
           * (verified) and making it resolve means adding a sixth pinned Tiptap
           * package. An `aria-hidden` span over an empty document is cheaper
           * than that and does the same job; the accessible name comes from
           * `ariaLabel`, which is where a control's name belongs anyway.
           *
           * Shown from `value`, not from `editor.isEmpty` — see the note on
           * `IDLE` for the bug that decided this.
           */}
          {placeholder && value.trim() === "" ? (
            <span className="adm-rte-ph" aria-hidden="true">
              {placeholder}
            </span>
          ) : null}

          <EditorContent editor={editor} className="adm-rte-mount" />
        </div>
      </div>
    </div>
  );
}
