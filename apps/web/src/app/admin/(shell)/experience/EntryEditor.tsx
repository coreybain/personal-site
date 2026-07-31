"use client";

import { api } from "@home/convex/api";
import type { Doc, Id } from "@home/convex/dataModel";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  AdminButtonRow,
  AdminForm,
  AdminNotice,
  AdminPanel,
  DateField,
  FieldRow,
  SaveButton,
  TextAreaField,
  TextField,
  ToggleField,
} from "@/components/admin";
import { linesToList, listToLines } from "@/components/admin/profile/lines";

/**
 * One experience entry, created or edited.
 *
 * The same component serves `/admin/experience/new` and
 * `/admin/experience/[id]`, because the two forms differ in exactly three places —
 * which mutation is called, whether there is a document to seed from, and the label
 * on the button. Two components would be two copies of eleven fields, and the
 * second copy is the one that stops getting the new field.
 *
 * ── `endDate: null` is "current role", and the toggle is the truth ──────────
 *
 * The stored field is nullable rather than optional precisely so that "still there"
 * and "nobody filled it in" are different facts. A cleared date input would express
 * the first only by accident, so the form has an explicit **Current role** toggle:
 * on, and the date field is disabled and `null` is sent; off, and a date is
 * required. `create` requires the argument (there is no way to leave the question
 * unanswered) and `update` treats omission as unchanged — this form always sends it,
 * so the toggle is always authoritative.
 *
 * ── `sortOrder` is not on this form ─────────────────────────────────────────
 *
 * Deliberately. `create` defaults it to the top of the résumé and `update` does not
 * accept it at all; reordering is `setSortOrder`, which is what the ↑/↓ buttons on
 * the list screen call. A number field here would be a second, worse ordering UI
 * whose value is only meaningful relative to rows this form cannot see.
 *
 * ── Every save rebuilds the résumé ──────────────────────────────────────────
 *
 * `create` and `update` both end with `rebuildResumeExperience`, in the same
 * transaction, and return `resume: { synced, roles }`. `synced: false` means there
 * is no résumé document yet — a successful no-op, not a failure — and is reported as
 * "save the résumé" rather than as an error.
 */

/* ------------------------------------------------------------------ *
 * Draft
 * ------------------------------------------------------------------ */

type Draft = {
  company: string;
  title: string;
  /** `YYYY-MM-DD`, or `null` while the field is empty. */
  startDate: string | null;
  /** `YYYY-MM-DD`. Ignored — and sent as `null` — while `current` is on. */
  endDate: string | null;
  current: boolean;
  summary: string;
  /** All three are newline-delimited; `linesToList` converts on save. */
  highlights: string;
  skills: string;
  projectSlugs: string;
};

const EMPTY_DRAFT: Draft = {
  company: "",
  title: "",
  startDate: null,
  endDate: null,
  /* A role being added is almost always the one just started — the same assumption
     `create` makes when it defaults `sortOrder` to the top of the résumé. */
  current: true,
  summary: "",
  highlights: "",
  skills: "",
  projectSlugs: "",
};

function draftFrom(entry: Doc<"experienceEntries">): Draft {
  return {
    company: entry.company,
    title: entry.title,
    startDate: entry.startDate,
    endDate: entry.endDate,
    current: entry.endDate === null,
    summary: entry.summary,
    highlights: listToLines(entry.highlights),
    skills: listToLines(entry.skills),
    projectSlugs: listToLines(entry.projectSlugs ?? []),
  };
}

/* ------------------------------------------------------------------ *
 * Screen
 * ------------------------------------------------------------------ */

export function EntryEditor({
  /** `null` on the create route. A string from the URL on the edit route. */
  entryId,
}: {
  entryId: string | null;
}) {
  /**
   * `"skip"` is Convex's own way to not run a query, and the only correct one here:
   * hooks cannot be called conditionally, so the create route still reaches this
   * line. A skipped query stays `undefined` forever, which is why the branches below
   * test the id before the result.
   *
   * The cast is the one unavoidable lie. A path segment is a string and `Id<>` is a
   * branded string; there is no runtime validation worth doing here because the
   * *server* does it — a malformed id fails argument validation inside `get`, and a
   * well-formed id for a deleted row resolves to `null`, handled below.
   */
  const entry = useQuery(
    api.experienceEntries.get,
    entryId === null
      ? "skip"
      : { entryId: entryId as Id<"experienceEntries"> },
  );

  if (entryId === null) {
    /* No read to wait for. The create form starts populated. */
    return <EntryForm entryId={null} initial={EMPTY_DRAFT} initialRevision={0} />;
  }

  if (entry === undefined) {
    return (
      <p className="adm-micro" role="status">
        Loading role…
      </p>
    );
  }

  if (entry === null) {
    /* `get` returns `null` rather than throwing for an unknown id, because the
       likely cause is a stale tab pointing at a row that has since been deleted.
       That should read as "this is gone", not as a 500. */
    return (
      <AdminPanel title="That role is gone">
        <AdminNotice tone="warn">
          It was deleted, probably from another tab. The résumé has already been
          rebuilt without it.
        </AdminNotice>
        <AdminButtonRow>
          <Link href="/admin/experience" className="adm-btn">
            Back to the list
          </Link>
        </AdminButtonRow>
      </AdminPanel>
    );
  }

  /*
   * The form is a child component so its draft can be seeded by `useState`'s lazy
   * initialiser rather than by an effect — seeding in an effect is a setState in an
   * effect body, which `react-hooks/set-state-in-effect` refuses.
   *
   * No `key={entry._id}`: the id cannot change without a navigation (which remounts
   * anyway), and a key tied to the *document* would discard whatever was being typed
   * the moment a live push arrived.
   */
  return (
    <EntryForm
      entryId={entryId}
      initial={draftFrom(entry)}
      initialRevision={entry.revision ?? 0}
    />
  );
}

function EntryForm({
  entryId,
  initial,
  initialRevision,
}: {
  entryId: string | null;
  initial: Draft;
  initialRevision: number;
}) {
  const router = useRouter();
  const create = useMutation(api.experienceEntries.create);
  const update = useMutation(api.experienceEntries.update);

  /** The draft plus a snapshot of it as last saved, so `dirty` needs no per-field compare. */
  const [state, setState] = useState(() => ({
    draft: initial,
    savedKey: JSON.stringify(initial),
    expectedRevision: initialRevision,
  }));

  const { draft, savedKey, expectedRevision } = state;
  const setDraft = (next: Draft) =>
    setState((current) => ({ ...current, draft: next }));

  /** The last write's projection report. See the file header on `synced`. */
  const [echo, setEcho] = useState<{ synced: boolean; roles: number } | null>(null);

  const dirty = savedKey !== JSON.stringify(draft);

  /**
   * Can this form be sent at all?
   *
   * Not validation — the mutation owns that, and its messages name the field. These
   * are the two states the *argument types* cannot express: `startDate` is a
   * required `string` and the field holds `string | null`, and an ended role with no
   * end date would be sent as `endDate: null`, which means the opposite of what the
   * toggle says.
   */
  const answerable =
    draft.startDate !== null && (draft.current || draft.endDate !== null);

  const save = async () => {
    if (draft.startDate === null) {
      return;
    }

    const endDate = draft.current ? null : draft.endDate;
    const highlights = linesToList(draft.highlights);
    const skills = linesToList(draft.skills);
    const projectSlugs = linesToList(draft.projectSlugs);

    if (entryId === null) {
      const answer = await create({
        company: draft.company,
        title: draft.title,
        startDate: draft.startDate,
        endDate,
        summary: draft.summary,
        highlights,
        skills,
        /* Omitted rather than `[]` on a create, so the key is absent on a row that
           has never had links — "no case studies" and "the links were cleared" read
           the same to every consumer, and an absent key is the honest one. `update`
           below always sends the array, because there `[]` is how you clear. */
        ...(projectSlugs.length > 0 ? { projectSlugs } : {}),
      });

      setEcho(answer.resume);
      /* Straight to the edit route for the row that now exists, so a second Save
         does not create a second copy. `replace` rather than `push`: the "new" URL
         should not be a back-button destination that would do exactly that. */
      router.replace(`/admin/experience/${answer.entryId}`);
      return;
    }

    const answer = await update({
      entryId: entryId as Id<"experienceEntries">,
      expectedRevision,
      company: draft.company,
      title: draft.title,
      startDate: draft.startDate,
      endDate,
      summary: draft.summary,
      highlights,
      skills,
      projectSlugs,
    });

    setEcho(answer.resume);
    setState((current) => ({
      ...current,
      savedKey: JSON.stringify(draft),
      expectedRevision: answer.revision,
    }));
  };

  return (
    <>
      {echo !== null && !echo.synced ? (
        <AdminNotice tone="warn" title="The résumé document does not exist yet">
          Saved, and nothing to project it into. Save the résumé at{" "}
          <Link href="/admin/resume">/admin/resume</Link> and its work history is
          built from these entries as part of that write.
        </AdminNotice>
      ) : null}

      {/* One tooltip for the panel instead of a hint under each of four fields.
          What is left inline is only what a reader has to act on: the end date's
          rule, which changes as the toggle changes. */}
      <AdminPanel
        title="Role"
        info={
          <>
            Only the year of each date is printed on the résumé — the day is stored
            so durations and sorting have something to work with. The summary is the
            role&rsquo;s paragraph, printed verbatim; two or three sentences.
          </>
        }
        infoLabel="About the role fields"
      >
        <AdminForm>
          <FieldRow>
            <TextField
              label="Title"
              value={draft.title}
              onValueChange={(value) => setDraft({ ...draft, title: value })}
              required
              maxLength={160}
              placeholder="Principal Engineer"
            />
            <TextField
              label="Company"
              value={draft.company}
              onValueChange={(value) => setDraft({ ...draft, company: value })}
              required
              maxLength={160}
            />
          </FieldRow>

          <FieldRow>
            <DateField
              label="Started"
              value={draft.startDate}
              onValueChange={(value) => setDraft({ ...draft, startDate: value })}
              required
            />
            <DateField
              label="Ended"
              value={draft.endDate}
              onValueChange={(value) => setDraft({ ...draft, endDate: value })}
              disabled={draft.current}
              required={!draft.current}
              /* Stays a hint, both branches. The disabled state needs a reason —
                 a greyed-out required field with no explanation reads as a
                 broken form — and the enabled branch is a rule the mutation
                 will refuse, which the kit reserves for inline text. */
              hint={
                draft.current
                  ? "Not asked while this is the current role."
                  : "Must be on or after the start date."
              }
            />
          </FieldRow>

          <ToggleField
            label="Current role"
            checked={draft.current}
            onCheckedChange={(checked) => setDraft({ ...draft, current: checked })}
            description="Stores no end date and prints as “Present”. Turning it off asks for one."
          />

          <TextAreaField
            label="Summary"
            value={draft.summary}
            onValueChange={(value) => setDraft({ ...draft, summary: value })}
            required
            rows={4}
            maxLength={2000}
          />
        </AdminForm>
      </AdminPanel>

      <AdminPanel
        title="Highlights and skills"
        info={
          <>
            All three are one item per line, in print order. Highlights cap at 20 —
            forty bullets on one role is a broken document rather than a thorough
            one. Case study slugs are stored and carried through the projection but
            the public résumé does not render them yet.
          </>
        }
        infoLabel="About highlights, skills and slugs"
      >
        <AdminForm>
          <TextAreaField
            label="Highlights"
            value={draft.highlights}
            onValueChange={(value) => setDraft({ ...draft, highlights: value })}
            rows={8}
            optional
            hint="One achievement per line. At most 20."
          />

          <TextAreaField
            label="Skills"
            value={draft.skills}
            onValueChange={(value) => setDraft({ ...draft, skills: value })}
            rows={6}
            optional
            hint="One per line."
          />

          <TextAreaField
            label="Case study slugs"
            value={draft.projectSlugs}
            onValueChange={(value) => setDraft({ ...draft, projectSlugs: value })}
            rows={4}
            mono
            optional
            hint="One slug per line."
          />
        </AdminForm>
      </AdminPanel>

      <AdminPanel
        footer={
          <AdminButtonRow>
            <SaveButton
              label={entryId === null ? "Create role" : "Save role"}
              dirty={dirty && answerable}
              title={
                answerable
                  ? undefined
                  : "A start date is required, and an ended role needs an end date."
              }
              onAction={save}
            />

            {/* "Back to the list" is gone from here: the header now carries a
                `BackLink` to the same place, at the top of the column where the
                eye already is, and two return paths on one screen is furniture.
                The panel keeps only the write. */}

            {/* The echo, in the row that caused it. It was a sentence prefixed by
                a standing explanation of what saving does — which is the page
                header's tooltip now — leaving just the fact that changes with each
                save. Same class and same wording as the list screen's echo in
                `ExperienceTable`, because it is the same fact and the two screens
                should not have two dialects for it. */}
            {echo !== null && echo.synced ? (
              <span className="adm-eyebrow" role="status">
                résumé rebuilt · {echo.roles}{" "}
                {echo.roles === 1 ? "role" : "roles"}
              </span>
            ) : null}
          </AdminButtonRow>
        }
      >
        {/* One line, and it always says something the reader has to act on: what
            is stopping the save, or what the save is about to do. The standing
            explanation that used to be here ("saving rebuilds the work history")
            is chrome and lives in the page header's tooltip. */}
        <p className="adm-micro">
          {answerable
            ? "There is no draft state — saving puts this straight on the résumé."
            : "A start date is required, and an ended role needs an end date."}
        </p>
      </AdminPanel>
    </>
  );
}
