"use client";

import { useId, type ReactNode } from "react";

import {
  inputToIsoDate,
  isoDateToInput,
  isoInstantToLocalInput,
  localInputToIsoInstant,
} from "./datetime";
import { InfoTip } from "./InfoTip";

/**
 * The admin's form primitives.
 *
 * ── The shape they all share ────────────────────────────────────────────────
 *
 * Every field is **controlled** and takes `value` + `onValueChange`, never a raw
 * `onChange`. The reason is that half of these fields do a conversion — a date
 * input's `YYYY-MM-DD` is not the string the schema stores, a number input's
 * value is a string and the schema wants a number — and a raw `onChange` pushes
 * that conversion into every caller, where it will be done four slightly
 * different ways by four different pages. `onValueChange` receives the value in
 * *the shape the Convex mutation wants*, which is the only shape a page should
 * ever hold.
 *
 * Every field also composes `<Field>`, which owns the label/hint/error furniture
 * and the id wiring. That is where accessibility lives:
 *
 *   - `htmlFor`/`id` from `useId()`, so a label is always clickable and always
 *     announced. Never hand-rolled ids: two instances of the same field on one
 *     page would collide, and the collision presents as "clicking the second
 *     label focuses the first input".
 *   - `aria-describedby` covering the hint *and* the error, so a screen reader
 *     hears why a value was rejected rather than only that it was.
 *   - `aria-invalid` on the control, which is also what styles the red border —
 *     one source of truth for "this is wrong", not a class plus an attribute.
 *
 * ── What they deliberately do not do ────────────────────────────────────────
 *
 * No validation. Nothing here decides whether a value is acceptable; the field
 * renders the `error` string it is given. Validation belongs to the Convex
 * mutation, which is the only place that can be authoritative (it holds the
 * uniqueness constraints and the ADR-009 gate), and the page's job is to show
 * what came back. A second, client-side copy of those rules would drift from the
 * real ones and be trusted more.
 *
 * No form element and no submit. A page composes `<form>` itself, or does not use
 * one — several admin screens are "edit this field, it saves" rather than a form
 * with a submit button, and a primitive that assumed a form would be in the way.
 */

/* ------------------------------------------------------------------ *
 * Field — the wrapper every control below composes
 * ------------------------------------------------------------------ */

export type FieldProps = {
  label: string;
  /** The rendered control. Receives the wiring it needs via `render`. */
  children: (wiring: {
    id: string;
    describedBy: string | undefined;
    invalid: boolean;
  }) => ReactNode;
  /**
   * Why this field matters, behind an info icon on the label's line. The `hint`
   * below is for the *format* ("Comma separated.", "One per line, at most
   * twelve"); this is for the consequence ("The blog index shows this instead of
   * the post"). One or two sentences — anything needing a list is an
   * `AdminNotice`, and anything the reader must act on before saving is not a
   * tooltip at all (README §2a).
   *
   * The icon is a **sibling** of the `<label>`, never a child of it. A `<button>`
   * inside a `<label>` is invalid HTML and gives a label click two things to hit —
   * the same reason `ToggleField` keeps a plain `description` instead of this.
   */
  info?: ReactNode;
  /**
   * Overrides the info trigger's accessible name, which is otherwise
   * `About {label}`. Worth passing where the derived name reads badly: a label of
   * "When it happened" gives "About When it happened", where
   * `infoLabel="About when it happened"` reads as a sentence. Ignored without
   * `info`.
   */
  infoLabel?: string;
  /** Small print under the control. Explain the *format*, not the field. */
  hint?: ReactNode;
  /** Set to show the error state. Falsy renders nothing. */
  error?: string | null;
  /** Marks the field visually and sets `required` on the control. */
  required?: boolean;
  /**
   * Renders an "optional" tag. Only worth using on a form where most fields are
   * required — marking every optional field on a form of mostly-optional fields
   * is noise.
   */
  optional?: boolean;
};

export function Field({
  label,
  children,
  info,
  infoLabel,
  hint,
  error,
  required,
  optional,
}: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  /* Both ids, space-separated, in reading order: what the field is for, then
     what is wrong with it. `undefined` rather than `""` when neither exists —
     an empty aria-describedby is a dangling reference. */
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div className="adm-field">
      {/* The label and its info icon share a row, and the icon is outside the
          `<label>` for the reason given on `FieldProps.info`. The row is rendered
          unconditionally so every field has one structure to reason about; with no
          `info` it is a single flex item and lays out exactly as the bare label
          did. */}
      <div className="adm-label-row">
        <label className="adm-label" htmlFor={id}>
          {label}
          {required ? (
            <span className="adm-required" aria-hidden="true">
              required
            </span>
          ) : null}
          {optional ? <span className="adm-optional">optional</span> : null}
        </label>

        {info ? (
          <InfoTip label={infoLabel ?? `About ${label}`}>{info}</InfoTip>
        ) : null}
      </div>

      {children({ id, describedBy, invalid: Boolean(error) })}

      {hint ? (
        <p className="adm-hint" id={hintId}>
          {hint}
        </p>
      ) : null}

      {error ? (
        <p className="adm-error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Wraps two or three fields into a responsive row. Stacks under ~240px each. */
export function FieldRow({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="adm-row">{children}</div>;
}

/* ------------------------------------------------------------------ *
 * Text
 * ------------------------------------------------------------------ */

type SharedFieldProps = Pick<
  FieldProps,
  "label" | "info" | "infoLabel" | "hint" | "error" | "required" | "optional"
>;

export type TextFieldProps = SharedFieldProps & {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  /**
   * Mirror the bound in the Zod schema and the Convex validator. It is a
   * courtesy, not a guard — the mutation enforces the real limit — but it stops
   * someone pasting 6000 characters into a 160-character summary and only
   * finding out on save.
   */
  maxLength?: number;
  disabled?: boolean;
  /** `email` and `url` get the right keyboard on iOS and the right autofill. */
  type?: "text" | "email" | "url";
  autoComplete?: string;
};

export function TextField({
  value,
  onValueChange,
  placeholder,
  maxLength,
  disabled,
  type = "text",
  autoComplete,
  ...field
}: TextFieldProps) {
  return (
    <Field {...field}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          className="adm-input"
          type={type}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          disabled={disabled}
          required={field.required}
          autoComplete={autoComplete}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          spellCheck={type === "text"}
        />
      )}
    </Field>
  );
}

export type TextAreaFieldProps = SharedFieldProps & {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  rows?: number;
  /**
   * Monospace, for fields whose content is Markdown or code. Not a style
   * preference: proportional type makes indentation and fenced blocks unreadable.
   */
  mono?: boolean;
};

export function TextAreaField({
  value,
  onValueChange,
  placeholder,
  maxLength,
  disabled,
  rows = 5,
  mono,
  ...field
}: TextAreaFieldProps) {
  return (
    <Field {...field}>
      {({ id, describedBy, invalid }) => (
        <textarea
          id={id}
          className="adm-textarea"
          data-mono={mono ? "true" : undefined}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          disabled={disabled}
          required={field.required}
          rows={rows}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
        />
      )}
    </Field>
  );
}

/* ------------------------------------------------------------------ *
 * Select
 * ------------------------------------------------------------------ */

export type SelectOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

export type SelectFieldProps<T extends string> = SharedFieldProps & {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly SelectOption<T>[];
  disabled?: boolean;
  /**
   * A leading empty option, for a field with no sensible default. Its label
   * shows while nothing is chosen; choosing it emits `""`, so the generic should
   * include `""` when this is used.
   */
  placeholder?: string;
};

/**
 * A native `<select>`, and it will stay one.
 *
 * A custom listbox would match the rest of the admin's type more exactly and
 * would cost: keyboard semantics, screen-reader semantics, mobile behaviour, and
 * the platform's own search-as-you-type. The chevron is drawn in CSS, which is
 * the only part worth restyling. Every option set in this admin is short and
 * closed (a status, a kind, an accent) — none of them need a combobox.
 *
 * The generic keeps the callback typed: `onValueChange` on a
 * `SelectField<ContactStatus>` hands back a `ContactStatus`, not a `string`, so a
 * mutation call cannot be given a value the union does not contain. The cast on
 * `event.target.value` is the one unavoidable lie — the DOM only has strings —
 * and it is safe because the option list is the only source of values.
 */
export function SelectField<T extends string>({
  value,
  onValueChange,
  options,
  disabled,
  placeholder,
  ...field
}: SelectFieldProps<T>) {
  return (
    <Field {...field}>
      {({ id, describedBy, invalid }) => (
        <select
          id={id}
          className="adm-select"
          value={value}
          onChange={(event) => onValueChange(event.target.value as T)}
          disabled={disabled}
          required={field.required}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
        >
          {placeholder ? <option value="">{placeholder}</option> : null}
          {options.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={option.disabled}
            >
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/* ------------------------------------------------------------------ *
 * Number
 * ------------------------------------------------------------------ */

export type NumberFieldProps = SharedFieldProps & {
  /** `null` means "empty", which is distinct from `0`. */
  value: number | null;
  onValueChange: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  placeholder?: string;
};

/**
 * A number, or nothing.
 *
 * `value: number | null` rather than `number` because the two are genuinely
 * different states for most of the schema's numeric fields: `sortOrder` absent
 * means "put it last", `sortOrder: 0` means "put it first". Collapsing empty to
 * `0` — which `Number("")` does — would make the first row of every list
 * unsettable.
 *
 * The input stays uncontrolled-ish in one narrow sense: while someone is typing
 * `-` or `1.` the value is not yet a number, and `Number()` gives `NaN`. Those
 * keystrokes emit `null`, so the field empties rather than freezing. Slightly
 * surprising for negative numbers; the alternative (holding a private string
 * state) means the field can disagree with the value its parent holds, which is
 * worse.
 */
export function NumberField({
  value,
  onValueChange,
  min,
  max,
  step,
  disabled,
  placeholder,
  ...field
}: NumberFieldProps) {
  return (
    <Field {...field}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          className="adm-input"
          type="number"
          value={value === null ? "" : String(value)}
          onChange={(event) => {
            const raw = event.target.value;

            if (raw === "") {
              onValueChange(null);
              return;
            }

            const parsed = Number(raw);
            onValueChange(Number.isFinite(parsed) ? parsed : null);
          }}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          required={field.required}
          placeholder={placeholder}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
        />
      )}
    </Field>
  );
}

/* ------------------------------------------------------------------ *
 * Dates
 * ------------------------------------------------------------------ */

export type DateFieldProps = SharedFieldProps & {
  /** A stored `YYYY-MM-DD`, or `null`. */
  value: string | null;
  onValueChange: (value: string | null) => void;
  disabled?: boolean;
  min?: string;
  max?: string;
};

/**
 * A calendar day — `experienceEntries.startDate` and `endDate`.
 *
 * Never touches `Date`: see the header of `datetime.ts` for the day-drift bug
 * that avoids. Clearing the input emits `null`, which is meaningful for `endDate`
 * ("Present") and is why the callback is nullable.
 */
export function DateField({
  value,
  onValueChange,
  disabled,
  min,
  max,
  ...field
}: DateFieldProps) {
  return (
    <Field {...field}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          className="adm-input"
          type="date"
          value={isoDateToInput(value)}
          onChange={(event) => onValueChange(inputToIsoDate(event.target.value))}
          disabled={disabled}
          required={field.required}
          min={min}
          max={max}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
        />
      )}
    </Field>
  );
}

export type InstantFieldProps = SharedFieldProps & {
  /** A stored RFC-3339 UTC instant, or `null`. */
  value: string | null;
  onValueChange: (value: string | null) => void;
  disabled?: boolean;
};

/**
 * A moment in time — anything the schema names `*At`, such as
 * `funEntries.occurredAt`.
 *
 * Shows and accepts the viewer's local wall clock; stores UTC. The conversion is
 * in `datetime.ts` and is the only correct way round: the person entering "7pm"
 * means 7pm where they are.
 *
 * Most `*At` fields are **not** edited here — `createdAt`, `publishedAt`,
 * `syncedAt`, `lastUsedAt` are all written by the server or by a cron, and a
 * field that let a human retype them would be a way to make the record lie. Use
 * this only where the timestamp is genuinely editorial.
 */
export function InstantField({
  value,
  onValueChange,
  disabled,
  ...field
}: InstantFieldProps) {
  return (
    <Field {...field}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          className="adm-input"
          type="datetime-local"
          value={isoInstantToLocalInput(value)}
          onChange={(event) =>
            onValueChange(localInputToIsoInstant(event.target.value))
          }
          disabled={disabled}
          required={field.required}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
        />
      )}
    </Field>
  );
}

/* ------------------------------------------------------------------ *
 * Toggle
 * ------------------------------------------------------------------ */

export type ToggleFieldProps = {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** One line under the label. Say what turning it *on* does. */
  description?: ReactNode;
  disabled?: boolean;
};

/**
 * A boolean.
 *
 * A real `<input type="checkbox">` with the native control visually hidden and a
 * track/thumb drawn beside it — not a `<div role="switch">`. The checkbox brings
 * Space to toggle, form participation, `:checked` styling (so the visual state is
 * CSS, not React state, and is correct on the first painted frame) and the
 * correct screen-reader announcement, for free and without a keydown handler.
 *
 * The whole thing is a `<label>`, so the label text and the track are one click
 * target rather than two.
 *
 * **Not for `published`.** Publishing is a mutation with preconditions — ADR
 * 009's gate lives inside `projects.publish` and can refuse — so it needs a
 * button that can report failure, not a toggle that appears to have succeeded.
 * Use `ActionButton` for it.
 */
export function ToggleField({
  label,
  checked,
  onCheckedChange,
  description,
  disabled,
}: ToggleFieldProps) {
  return (
    <label className="adm-toggle" data-disabled={disabled ? "true" : undefined}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onCheckedChange(event.target.checked)}
        disabled={disabled}
      />
      <span className="adm-toggle-track" aria-hidden="true">
        <span className="adm-toggle-thumb" />
      </span>
      <span className="adm-toggle-copy">
        <span className="adm-toggle-label">{label}</span>
        {description ? <span className="adm-hint">{description}</span> : null}
      </span>
    </label>
  );
}
