"use client";

import { useEffect, useState } from "react";

import { Field, type FieldProps } from "./Field";

/**
 * The slug field, and the rule it enforces.
 *
 * ── Why slugs get their own component ───────────────────────────────────────
 *
 * A slug is not a text field that happens to be lowercase. It is the join key
 * across the whole system: `projects.slug` is what the AI-usage collector maps a
 * repo path onto, what `knowledgeDocs.sourceSlug` points at, what
 * `siteSettings.featuredSelections` lists, and what `/work/[slug]` resolves. It
 * is unique per table, and — the part that makes this component worth writing —
 * **it is never reused.** Renaming a published slug breaks every inbound link and
 * silently orphans every reference to the old one.
 *
 * So the component does two things a plain input cannot:
 *
 *   1. Derives from the title while the two are *linked*, which is what you want
 *      while creating something, and stops deriving the moment you touch it,
 *      which is what you want ever after.
 *   2. Says out loud, in the hint, that changing this on a published document
 *      breaks links. Not a confirmation dialog — a confirmation dialog on a field
 *      you edit is unusable — but the warning is where the decision is made.
 *
 * ── Format ─────────────────────────────────────────────────────────────────
 *
 * `^[a-z0-9]+(?:-[a-z0-9]+)*$`, 1–96 characters, per `SlugSchema`. `slugify`
 * below produces exactly that or the empty string, and the field reports a
 * mismatch rather than silently rewriting what someone typed: a field that
 * rewrites keystrokes is impossible to type a hyphen into.
 */

/**
 * Title → slug.
 *
 * Exported because pages sometimes need it outside a field — a bulk import, a
 * "duplicate this project" action. Total: every input maps to a valid slug or to
 * `""`, and `""` is the only invalid output.
 *
 * The `normalize("NFD")` pass matters more than it looks: "Café" would otherwise
 * become `caf` (the é is dropped as non-matching) rather than `cafe`. Decomposing
 * first turns é into `e` + a combining accent, and the accent is in the Unicode
 * mark range stripped on the next line.
 */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    /* Unicode combining marks — written as escapes because the literal
       characters are invisible in an editor and get mangled by every tool that
       touches the file. */
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96)
    /* The slice can leave a trailing dash if the 96th character was one. */
    .replace(/-+$/g, "");
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** `true` for a string the schema will accept. `""` is not valid — it is empty. */
export function isValidSlug(value: string): boolean {
  return value.length > 0 && value.length <= 96 && SLUG_PATTERN.test(value);
}

export type SlugFieldProps = Pick<FieldProps, "error" | "required"> & {
  value: string;
  onValueChange: (value: string) => void;
  /**
   * The title (or whatever names the thing). While linked, the slug follows it.
   * Pass `""` to disable derivation entirely — the lock still renders, so the
   * behaviour stays legible, but there is nothing to derive from.
   */
  source?: string;
  /**
   * The public URL prefix, shown as an inline prefix: `/work/`, `/labs/`,
   * `/blog/`. Purely informational — it tells you what you are naming.
   */
  prefix?: string;
  label?: string;
  disabled?: boolean;
  /**
   * `true` when the document is already published. Switches the hint to the
   * "this breaks links" wording, and unlinks by default.
   */
  published?: boolean;
};

export function SlugField({
  value,
  onValueChange,
  source = "",
  prefix,
  label = "Slug",
  disabled,
  published,
  error,
  required,
}: SlugFieldProps) {
  /**
   * Linked at first only when there is nothing to lose.
   *
   * A lazy initialiser, so this is computed once on mount and never again: an
   * empty slug means a new document, where following the title is what anyone
   * would want. A slug that already exists means an edit, where silently
   * rewriting it from the title would be the exact link-breaking accident the
   * hint warns about.
   */
  const [linked, setLinked] = useState(() => value === "" && !published);

  /**
   * Derive, while linked.
   *
   * An effect, not a render-time computation, because the value lives in the
   * parent: this component cannot return a different value than it was given, it
   * can only ask for one. The `next !== value` guard is what makes it terminate —
   * without it, every parent re-render would schedule another identical update.
   *
   * `onValueChange` is in the dependency list for correctness even though most
   * callers pass an unstable inline arrow. That costs a re-run of the effect per
   * render, and the guard makes a re-run free.
   */
  useEffect(() => {
    if (!linked) {
      return;
    }

    const next = slugify(source);

    if (next !== value) {
      onValueChange(next);
    }
  }, [linked, source, value, onValueChange]);

  const invalidFormat = value.length > 0 && !isValidSlug(value);

  const hint = published ? (
    <>
      This document is published. Changing its slug breaks every existing link to{" "}
      <code>
        {prefix}
        {value}
      </code>{" "}
      and orphans anything referencing the old one — featured selections, the
      knowledge index, the collector&rsquo;s project mapping. Prefer leaving it.
    </>
  ) : (
    <>Lowercase, digits and single hyphens. Permanent once published.</>
  );

  return (
    <Field
      label={label}
      hint={hint}
      error={error ?? (invalidFormat ? "Lowercase kebab-case only, e.g. quotecloud-rebuild." : null)}
      required={required}
    >
      {({ id, describedBy, invalid }) => (
        <div
          className="adm-slug"
          data-invalid={invalid || invalidFormat ? "true" : undefined}
        >
          {prefix ? (
            <span className="adm-slug-prefix" aria-hidden="true">
              {prefix}
            </span>
          ) : null}

          <input
            id={id}
            type="text"
            value={value}
            onChange={(event) => {
              /* Typing unlinks. Not a separate gesture to remember — editing the
                 field *is* the statement that you want to control it. */
              setLinked(false);
              onValueChange(event.target.value);
            }}
            disabled={disabled}
            required={required}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={describedBy}
            aria-invalid={invalid || invalidFormat || undefined}
          />

          <button
            type="button"
            className="adm-slug-lock"
            data-linked={linked ? "true" : undefined}
            onClick={() => setLinked((current) => !current)}
            disabled={disabled}
            /* The label states what clicking does, not what the state is —
               "Linked to title" as a button name reads as a broken toggle. */
            aria-label={
              linked
                ? "Stop deriving the slug from the title"
                : "Derive the slug from the title"
            }
            title={
              linked
                ? "Following the title. Click to edit freely."
                : "Edited by hand. Click to follow the title again."
            }
          >
            {linked ? "auto" : "manual"}
          </button>
        </div>
      )}
    </Field>
  );
}
