"use client";

import type { Doc } from "@home/convex/dataModel";
import type { FunEntryKind, FunLocation, MediaAsset } from "@home/types";
import {
  AdminNotice,
  FieldRow,
  ImageUpload,
  InstantField,
  NumberField,
  SelectField,
  TextAreaField,
  TextField,
  nowIso,
  type ActionFailure,
  type SelectOption,
} from "@/components/admin";

/**
 * The fields of a Fun Entry, and the four-kinds rule they have to live with.
 *
 * ── What makes this form different from every other one in the admin ─────────
 *
 * `funEntries` is a `z.discriminatedUnion` on `type` flattened into one Convex
 * table (see the header of `convex/funEntries.ts`). Which fields are required
 * depends on a field:
 *
 *   walk               `steps` and `km` required, `note` optional
 *   beer coffee pub    `note` required, `steps` and `km` **forbidden**
 *
 * Neither Convex's validators nor this form can express that, and only one place
 * enforces it: `assertKind`, which runs against the whole merged row inside the
 * mutation. So this file's job is to *show the right fields for the current kind*
 * and to build a patch that does not contradict the kind — not to validate. When a
 * combination is wrong the mutation refuses it by name (`'steps'`, `'note'`) with a
 * sentence written to be read, and `failure.field` puts that sentence under the
 * input. See `components/admin/README.md` §3.
 *
 * ── Location is four form fields and one optional object ────────────────────
 *
 * The stored shape is `{ name, suburb?, latitude?, longitude? }` and the whole
 * object is optional. A form cannot hold "absent", so it holds four strings and
 * numbers and `funLocationFrom` assembles them: no name means no location. The
 * backend additionally refuses one coordinate without the other, which is a rule
 * about the pair rather than about either field, so it is left to the backend and
 * reported at `location`.
 */

/** The four kinds, in the order the /fun page thinks about them. */
export const FUN_TYPE_OPTIONS: readonly SelectOption<FunEntryKind>[] = [
  { value: "beer", label: "Beer" },
  { value: "coffee", label: "Coffee" },
  { value: "walk", label: "Walk" },
  { value: "pub", label: "Pub" },
];

/** Title case, for a badge or a heading. */
export function funTypeLabel(type: FunEntryKind): string {
  return (
    FUN_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type
  );
}

export type FunDraft = {
  type: FunEntryKind;
  title: string;
  photo: MediaAsset | null;
  /** Required for beer/coffee/pub, optional on a walk. Blank means absent. */
  note: string;
  rating: number | null;
  /** Location, flattened. Blank `locationName` means there is no location. */
  locationName: string;
  locationSuburb: string;
  latitude: number | null;
  longitude: number | null;
  /** Walks only. Carried in state on other kinds but never sent — see `funPatch`. */
  steps: number | null;
  km: number | null;
  /** RFC-3339 UTC. `null` only while the input is empty, which blocks the save. */
  occurredAt: string | null;
};

/**
 * A blank entry.
 *
 * `occurredAt` defaults to now, which is right far more often than it is wrong: the
 * usual reason to type an entry into this form rather than let the phone post it is
 * that something just happened. It is editable, and the backend refuses anything
 * more than a day ahead of the server clock.
 *
 * `type: 'beer'` is a default rather than a guess at frequency — something has to
 * be selected, and a placeholder option would let an entry be created with no kind.
 */
export function emptyFunDraft(): FunDraft {
  return {
    type: "beer",
    title: "",
    photo: null,
    note: "",
    rating: null,
    locationName: "",
    locationSuburb: "",
    latitude: null,
    longitude: null,
    steps: null,
    km: null,
    occurredAt: nowIso(),
  };
}

/** A stored entry, as the form holds it. */
export function funDraftFromRow(row: Doc<"funEntries">): FunDraft {
  return {
    type: row.type,
    title: row.title,
    photo: row.photo,
    note: row.note ?? "",
    rating: row.rating ?? null,
    locationName: row.location?.name ?? "",
    locationSuburb: row.location?.suburb ?? "",
    latitude: row.location?.latitude ?? null,
    longitude: row.location?.longitude ?? null,
    steps: row.steps ?? null,
    km: row.km ?? null,
    occurredAt: row.occurredAt,
  };
}

/**
 * The four location fields → the optional stored object, or `null` for "none".
 *
 * A blank name means no location, because `name` is the only required member: an
 * entry with a suburb and no venue is not a place. `suburb` and the coordinates are
 * omitted rather than sent empty — `undefined` keeps the field off the document,
 * where `''` would render an empty line under the photo and `0` would be a point in
 * the Gulf of Guinea.
 */
export function funLocationFrom(draft: FunDraft): FunLocation | null {
  const name = draft.locationName.trim();

  if (name.length === 0) {
    return null;
  }

  const suburb = draft.locationSuburb.trim();

  return {
    name,
    ...(suburb.length > 0 ? { suburb } : {}),
    ...(draft.latitude !== null ? { latitude: draft.latitude } : {}),
    ...(draft.longitude !== null ? { longitude: draft.longitude } : {}),
  };
}

/**
 * The arguments `funEntries.update` should be called with. **Absent ⇒ unchanged,
 * `null` ⇒ cleared** — the mutation's own contract, mirrored here.
 */
export type FunPatch = {
  type?: FunEntryKind;
  title?: string;
  photo?: MediaAsset;
  note?: string | null;
  rating?: number | null;
  location?: FunLocation | null;
  steps?: number | null;
  km?: number | null;
  occurredAt?: string;
};

/**
 * Build the patch, with the one piece of kind-awareness a client has to have.
 *
 * Everything here is a straight "did it change" comparison except `steps` and `km`,
 * and those need care because of how `funEntries.update` handles a kind change. It
 * merges the arguments over the stored row, validates the merged row with
 * `assertKind`, and writes with `replace` — and it drops `steps`/`km` itself when
 * the merged `type` is not `walk`. So:
 *
 *   • **Target is not a walk** → send neither, whatever they hold. Passing them
 *     explicitly on a non-walk is a `precondition-failed` ("steps and km belong to
 *     a walk"), and a walk→beer edit would otherwise fail on values the mutation
 *     was about to discard.
 *
 *   • **Target is a walk that was not one** → send both regardless of whether they
 *     changed, because the stored row has neither and `assertKind` requires both.
 *     If they are empty the mutation refuses by name, which is the correct outcome:
 *     no value could be invented here.
 *
 * `photo` is sent only when non-null. It has no `null` in the mutation's validator
 * because a Fun Entry without a photo is a hole in the /fun grid, so the editor
 * holds the save instead of trying to clear it.
 */
export function funPatch(initial: FunDraft, draft: FunDraft): FunPatch {
  const patch: FunPatch = {};

  if (draft.type !== initial.type) patch.type = draft.type;
  if (draft.title !== initial.title) patch.title = draft.title;

  if (
    draft.photo !== null &&
    JSON.stringify(draft.photo) !== JSON.stringify(initial.photo)
  ) {
    patch.photo = draft.photo;
  }

  /* The blank string is passed through as-is: `patchText` in the mutation turns a
     whitespace-only note into a clear, which is the right reading of an emptied
     textarea. Sending `null` explicitly would say the same thing in a second way. */
  if (draft.note !== initial.note) patch.note = draft.note;

  if (draft.rating !== initial.rating) patch.rating = draft.rating;

  if (draft.occurredAt !== null && draft.occurredAt !== initial.occurredAt) {
    patch.occurredAt = draft.occurredAt;
  }

  const location = funLocationFrom(draft);
  const initialLocation = funLocationFrom(initial);
  if (JSON.stringify(location) !== JSON.stringify(initialLocation)) {
    patch.location = location;
  }

  if (draft.type === "walk") {
    const becomingAWalk = initial.type !== "walk";
    if (becomingAWalk || draft.steps !== initial.steps) {
      patch.steps = draft.steps;
    }
    if (becomingAWalk || draft.km !== initial.km) {
      patch.km = draft.km;
    }
  }

  return patch;
}

/** See the identical helper in `posts/PostFields.tsx` for what this is for. */
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

export type FunFieldsProps = {
  draft: FunDraft;
  onDraftChange: (draft: FunDraft) => void;
  failure?: ActionFailure | null;
  disabled?: boolean;
};

export function FunFields({
  draft,
  onDraftChange,
  failure = null,
  disabled,
}: FunFieldsProps) {
  const set = <K extends keyof FunDraft>(key: K, value: FunDraft[K]) => {
    onDraftChange({ ...draft, [key]: value });
  };

  const isWalk = draft.type === "walk";

  return (
    <>
      {/* Kind and date first, because kind decides which fields exist below it and
          the date is nearly always right already. Both hints moved into tips: the
          form *shows* the per-kind rule (steps and distance appear, the note's
          required tag flips), so a sentence restating it under the picker was the
          same information twice.

          The icons now sit against the end of their own label text rather than at
          the end of the column, so the "which label does this belong to" problem
          the local shim had is gone and tipping both columns is a choice rather
          than a workaround. Both are still tipped here because both facts are worth
          having. */}
      <FieldRow>
        <SelectField<FunEntryKind>
          label="Kind"
          value={draft.type}
          onValueChange={(type) => set("type", type)}
          options={FUN_TYPE_OPTIONS}
          info={
            isWalk ? (
              <>
                A walk carries steps and distance and its note is optional. Changing
                it to any other kind drops both metrics in the same write.
              </>
            ) : (
              <>
                Beer, coffee and pub entries need a note and carry no metrics —{" "}
                <code>assertKind</code> refuses steps or distance on them. Only a
                walk has those, and needs both.
              </>
            )
          }
          infoLabel="About the four kinds"
          required
          disabled={disabled}
          error={errorFor(failure, "type")}
        />
        <InstantField
          label="When it happened"
          value={draft.occurredAt}
          onValueChange={(occurredAt) => set("occurredAt", occurredAt)}
          info={
            <>
              Entered as your local time and stored as UTC. It is the only thing{" "}
              <code>/fun</code> sorts on — not when the entry was typed — and the
              backend refuses anything more than a day ahead of its own clock.
            </>
          }
          infoLabel="About when it happened"
          required
          disabled={disabled}
          error={errorFor(failure, "occurredAt")}
        />
      </FieldRow>

      <TextField
        label="Title"
        value={draft.title}
        onValueChange={(title) => set("title", title)}
        placeholder={isWalk ? "Bay Run, early" : "Grifter Pale Ale"}
        /* Mirrors MAX_TITLE in convex/funEntries.ts. */
        maxLength={160}
        required
        disabled={disabled}
        error={errorFor(failure, "title")}
      />

      <ImageUpload
        label="Photo"
        value={draft.photo}
        onValueChange={(photo) => set("photo", photo)}
        /* No `requireSanitised` (ADR 009 is about client screenshots in
           `projects.media`, and a photo of a beer is not client work) and no
           `withCaption` — the `note` below is this entry's caption, and offering
           both invites the same sentence twice.

           The hint stays inline and got shorter. That the photo is required is the
           reason the save button is disabled, which is validation rather than
           explanation — and `ImageUpload` could not take a tip anyway, its `label`
           being a `string` too. */
        hint="Required — the /fun grid is images."
        disabled={disabled}
      />
      {errorFor(failure, "photo") ? (
        <p className="adm-error" role="alert">
          {errorFor(failure, "photo")}
        </p>
      ) : null}

      {/* No hint. The `required`/`optional` tag on the label already says the only
          thing the old sentence said, per kind, and says it in two words. */}
      <TextAreaField
        label="Note"
        value={draft.note}
        onValueChange={(note) => set("note", note)}
        placeholder={
          isWalk ? "Anything worth saying about it" : "A sentence or two"
        }
        rows={4}
        /* Mirrors MAX_NOTE in convex/funEntries.ts. A caption, not a blog post. */
        maxLength={2_000}
        required={!isWalk}
        optional={isWalk}
        disabled={disabled}
        error={errorFor(failure, "note")}
      />

      {/* Both hints are now in the labels and the placeholders, which is where a
          unit belongs: "Distance" with "Kilometres" underneath was a label split
          across two lines. `step` already says fractions are expected. */}
      {isWalk ? (
        <FieldRow>
          <NumberField
            label="Steps"
            value={draft.steps}
            onValueChange={(steps) => set("steps", steps)}
            placeholder="As HealthKit reports them"
            min={0}
            max={250_000}
            step={1}
            required
            disabled={disabled}
            error={errorFor(failure, "steps")}
          />

          <NumberField
            label="Distance (km)"
            value={draft.km}
            onValueChange={(km) => set("km", km)}
            min={0}
            max={1_000}
            step={0.01}
            required
            disabled={disabled}
            error={errorFor(failure, "km")}
          />
        </FieldRow>
      ) : null}

      {/* Paired into one row: both are optional, both are one line, and a lone
          number input on a full-width row was the widest empty space on the form.
          They also belong together — `describe()` in `FunTable` renders exactly
          this pair, in exactly this order: "4/5 · The Old Fitz".

          The order used to matter for a second reason — the local shim this row
          once used put its icon at the end of the *field*, so a tipped field in
          the first column left its icon beside the second column's label. The
          kit's `info` puts it against its own label text, so that constraint is
          gone; the order stays because `describe()` uses it. */}
      <FieldRow>
        <NumberField
          label="Rating"
          value={draft.rating}
          onValueChange={(rating) => set("rating", rating)}
          /* The range is the placeholder rather than a hint: `min`/`max` already
             enforce it, and "leave it empty where it was not worth scoring" is
             what the `optional` tag means. */
          placeholder="1–5"
          min={1}
          max={5}
          step={1}
          optional
          disabled={disabled}
          error={errorFor(failure, "rating")}
        />

        <TextField
          label="Place"
          value={draft.locationName}
          onValueChange={(locationName) => set("locationName", locationName)}
          info={
            <>
              A venue or a route. It is the only required part of a location, so
              clearing it removes the suburb and the coordinates from the entry
              along with it.
            </>
          }
          infoLabel="About the place"
          placeholder="The Old Fitz"
          maxLength={160}
          optional
          disabled={disabled}
          error={errorFor(failure, "location")}
        />
      </FieldRow>

      {draft.locationName.trim().length > 0 ? (
        <>
          <FieldRow>
            <TextField
              label="Suburb"
              value={draft.locationSuburb}
              onValueChange={(locationSuburb) =>
                set("locationSuburb", locationSuburb)
              }
              placeholder="Woolloomooloo"
              maxLength={120}
              optional
              disabled={disabled}
            />

            <NumberField
              label="Latitude"
              value={draft.latitude}
              onValueChange={(latitude) => set("latitude", latitude)}
              min={-90}
              max={90}
              step={0.000001}
              optional
              disabled={disabled}
            />

            <NumberField
              label="Longitude"
              value={draft.longitude}
              onValueChange={(longitude) => set("longitude", longitude)}
              min={-180}
              max={180}
              step={0.000001}
              optional
              disabled={disabled}
            />
          </FieldRow>

          {(draft.latitude === null) !== (draft.longitude === null) ? (
            <AdminNotice tone="warn" title="Half a coordinate">
              Latitude and longitude are stored together or not at all — the save
              will be refused with one of them. One coordinate on its own puts a pin
              on the equator or the prime meridian, which the map treatments would
              happily draw.
            </AdminNotice>
          ) : null}
        </>
      ) : null}
    </>
  );
}
