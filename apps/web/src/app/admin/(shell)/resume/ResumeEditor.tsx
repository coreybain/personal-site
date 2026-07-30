"use client";

import { api } from "@home/convex/api";
import type { Doc } from "@home/convex/dataModel";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import {
  ActionButton,
  AdminButtonRow,
  AdminForm,
  AdminNotice,
  AdminPanel,
  FieldRow,
  InfoTip,
  SaveButton,
  TextAreaField,
  TextField,
  ToggleField,
  usePendingAction,
} from "@/components/admin";
import { linesToList, listToLines } from "@/components/admin/profile/lines";

/**
 * The Resume Document, as one form, plus the rebuild action.
 *
 * ── What this screen may and may not write ──────────────────────────────────
 *
 * `resume.upsert({ summary, capabilities, education, embedGitStats })` — and
 * that is the entire argument list. There is no `experience`: the projection is
 * rebuilt from `experienceEntries` *as part of* this write, which means saving this
 * form also repairs a projection that had drifted, and that no caller can author a
 * work history the source table disagrees with. See the header of
 * `packages/convex/convex/resume.ts`, which is the authority on the two-table flow.
 *
 * So the work-history panel below is **read-only**, and deliberately so. It renders
 * `document.experience` — the exact text both renderers print — next to a count of
 * the source rows, because the one failure this screen has to make visible is the
 * two numbers disagreeing.
 *
 * ── The draft does not follow the document ──────────────────────────────────
 *
 * Seeded from the first resolved read, then it stops listening. A live push that
 * re-seeded would delete whatever was being typed. The consequence: after a rebuild
 * or an experience edit, the *projection* panel updates (it reads the document
 * directly) while the summary and education fields stay as typed. That is the
 * intended split — one is derived, the other is being authored.
 */

/* ------------------------------------------------------------------ *
 * Draft
 * ------------------------------------------------------------------ */

/** One education row, as the form holds it. All four fields are free-form labels. */
type EducationRow = {
  institution: string;
  credential: string;
  start: string;
  end: string;
};

type Draft = {
  summary: string;
  /** Newline-delimited, converted by `linesToList` on save. */
  capabilities: string;
  education: EducationRow[];
  embedGitStats: boolean;
};

const EMPTY_ROW: EducationRow = {
  institution: "",
  credential: "",
  start: "",
  end: "",
};

/** `resume.upsert` refuses more than this. A layout bound, not a storage one. */
const MAX_EDUCATION = 10;

const EMPTY_DRAFT: Draft = {
  summary: "",
  capabilities: "",
  education: [],
  /* Defaults on, because the git block is the strongest single signal on the
     document (ADR 008 counts private contributions) and a fresh deployment that
     silently omitted it would be a worse résumé for no stated reason. */
  embedGitStats: true,
};

function draftFrom(resumeDoc: Doc<"resumeDocument"> | null): Draft {
  if (resumeDoc === null) {
    return EMPTY_DRAFT;
  }

  return {
    summary: resumeDoc.summary,
    capabilities: listToLines(resumeDoc.capabilities),
    education: resumeDoc.education.map((row) => ({
      institution: row.institution,
      credential: row.credential,
      start: row.start,
      end: row.end,
    })),
    embedGitStats: resumeDoc.embedGitStats,
  };
}

/* ------------------------------------------------------------------ *
 * Screen
 * ------------------------------------------------------------------ */

export function ResumeEditor() {
  const resumeDoc = useQuery(api.resume.get, {});
  const entries = useQuery(api.experienceEntries.list, {});

  if (resumeDoc === undefined) {
    return (
      <p className="adm-micro" role="status">
        Loading résumé…
      </p>
    );
  }

  /*
   * The form is a child component so its draft can be seeded by `useState`'s lazy
   * initialiser rather than by an effect: seeding in an effect is a setState in an
   * effect body, which `react-hooks/set-state-in-effect` refuses.
   *
   * No `key` on it, deliberately — `key={resumeDoc?._id}` would remount the form and
   * discard whatever was being typed the first time a live push arrived. Not
   * following the document is the intent; see the file header. `entries` is passed
   * through because only the (derived, always-live) projection panel reads it.
   */
  return <ResumeForm initial={resumeDoc} entries={entries} />;
}

function ResumeForm({
  initial,
  entries,
}: {
  initial: Doc<"resumeDocument"> | null;
  entries: Doc<"experienceEntries">[] | undefined;
}) {
  const upsert = useMutation(api.resume.upsert);

  /**
   * The draft plus a serialised snapshot of it as last saved, which is what makes
   * `dirty` honest without a per-field comparison. One `useState` so the pair cannot
   * drift, lazily initialised so `draftFrom` runs once.
   */
  const [state, setState] = useState(() => {
    const draft = draftFrom(initial);
    return { draft, savedKey: JSON.stringify(draft) };
  });

  const { draft, savedKey } = state;
  const setDraft = (next: Draft) =>
    setState((current) => ({ ...current, draft: next }));

  const dirty = savedKey !== JSON.stringify(draft);

  const setEducation = (rows: EducationRow[]) =>
    setDraft({ ...draft, education: rows });

  const patchRow = (index: number, patch: Partial<EducationRow>) =>
    setEducation(
      draft.education.map((row, at) => (at === index ? { ...row, ...patch } : row)),
    );

  const save = async () => {
    await upsert({
      summary: draft.summary,
      capabilities: linesToList(draft.capabilities),
      /* Sent verbatim; `resume.upsert` trims and refuses blanks with a message
         naming the offending row, e.g. `education[2].institution cannot be empty`. */
      education: draft.education,
      embedGitStats: draft.embedGitStats,
    });

    setState({ draft, savedKey: JSON.stringify(draft) });
  };

  return (
    <>
      {initial === null ? (
        <AdminNotice tone="warn" title="No résumé document exists yet">
          <code>/resume</code> and the PDF route are rendering nothing. Saving this
          form creates the document — and builds its work history from the{" "}
          {entries === undefined ? "" : `${entries.length} `}
          experience {entries?.length === 1 ? "entry" : "entries"} in the same
          write.
        </AdminNotice>
      ) : null}

      <ProjectionPanel resumeDoc={initial} entries={entries} />

      {/* One tooltip for the panel rather than a hint under each field. Both
          hints were explaining *what the field is for*, which the label already
          says; what is left inline is only what the mutation does to the value —
          because a silent transformation the reader cannot predict is judgement
          text, not chrome (see the kit README §2a). */}
      <AdminPanel
        title="Summary"
        info={
          <>
            The summary is the first thing on <code>/resume</code> and the first
            thing in the PDF: long enough for three paragraphs, short enough to
            stay a summary. Capabilities print as the skills list beside it.
          </>
        }
        infoLabel="About the summary and capabilities"
      >
        <AdminForm>
          <TextAreaField
            label="Opening paragraph"
            value={draft.summary}
            onValueChange={(value) => setDraft({ ...draft, summary: value })}
            required
            rows={6}
            maxLength={4000}
          />

          <TextAreaField
            label="Capabilities"
            value={draft.capabilities}
            onValueChange={(value) => setDraft({ ...draft, capabilities: value })}
            rows={8}
            optional
            hint="One per line, in print order. Blanks are dropped, duplicates collapsed, and at most 40 are stored."
          />
        </AdminForm>
      </AdminPanel>

      <EducationPanel
        rows={draft.education}
        onPatch={patchRow}
        onReplace={setEducation}
      />

      {/* The privacy claim is the part worth keeping and the part nobody needs in
          front of them: ADR 008 counts private contributions without naming the
          repositories they are in, so the block reveals volume and not clients. */}
      <AdminPanel
        title="PDF"
        info={
          <>
            The totals include private contributions as a count and never as names
            (ADR 008), so this reveals volume, not clients.
          </>
        }
        infoLabel="About the contribution block"
      >
        <ToggleField
          label="Embed GitHub contribution stats"
          checked={draft.embedGitStats}
          onCheckedChange={(checked) =>
            setDraft({ ...draft, embedGitStats: checked })
          }
          description="Adds the contribution block to the generated document (ADR 011)."
        />
      </AdminPanel>

      <AdminPanel
        footer={
          <AdminButtonRow>
            <SaveButton
              label={initial === null ? "Create résumé" : "Save résumé"}
              dirty={dirty}
              onAction={save}
            />
          </AdminButtonRow>
        }
      >
        {/* Stays inline, shorter. The first half of this paragraph ("saving also
            rebuilds the work history") is chrome and is now in the page header's
            tooltip; the second half is a way to lose someone else's edit, which
            is exactly the kind of text a tooltip must not hold. */}
        <p className="adm-micro">
          This form seeded itself when it loaded and does not follow live changes —
          reload before saving if the document was edited elsewhere.
        </p>
      </AdminPanel>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * The projection
 * ------------------------------------------------------------------ */

/**
 * The work history: what is stored, where it came from, and the rebuild button.
 *
 * This panel is the whole reason the résumé is safe to edit from two screens. It
 * shows the count of source rows (`experienceEntries.list`) beside the count of
 * projected roles (`document.experience`) and says out loud when they differ,
 * because that difference is the only observable symptom of a projection that never
 * got rebuilt — and it is otherwise invisible until someone downloads the PDF.
 *
 * The rebuild calls `resume.syncFromEntries`, whose interesting response is
 * `synced: false`: that means there is no résumé document to project into, which is
 * a **successful no-op**, not a failure. Entries may legitimately be authored before
 * the singleton exists. The panel reports it as "save the résumé first", which is
 * the action it implies.
 */
function ProjectionPanel({
  resumeDoc,
  entries,
}: {
  resumeDoc: Doc<"resumeDocument"> | null;
  entries: Doc<"experienceEntries">[] | undefined;
}) {
  const syncFromEntries = useMutation(api.resume.syncFromEntries);
  const action = usePendingAction();

  /** The last rebuild's answer, so `synced: false` can be explained. */
  const [result, setResult] = useState<{ roles: number; synced: boolean } | null>(
    null,
  );

  const projected = resumeDoc?.experience.length ?? 0;
  const sourceRows = entries?.length;
  const drifted = sourceRows !== undefined && sourceRows !== projected;

  return (
    <AdminPanel
      title="Work history"
      headerEnd={
        <span className="adm-eyebrow">
          {sourceRows === undefined ? "…" : sourceRows} entries →{" "}
          {projected} roles
        </span>
      }
      footer={
        <AdminButtonRow>
          <ActionButton
            variant={drifted ? "primary" : "default"}
            action={action}
            pendingLabel="Rebuilding…"
            onAction={async () => {
              const answer = await syncFromEntries({});
              setResult({ roles: answer.roles, synced: answer.synced });
            }}
          >
            Rebuild from entries
          </ActionButton>

          <Link href="/admin/experience" className="adm-btn" data-variant="ghost">
            Edit roles
          </Link>

          {/*
            The paragraph that used to sit in this panel's body was five lines
            explaining a button that does nothing in normal operation. It is now
            one line plus the icon: the line so the reader knows whether to press
            it, the tooltip for the cases that answer "why does this button exist
            at all".

            The InfoTip is in the *button row*, beside the control it is about,
            rather than in the panel head — the question it answers is "should I
            press this", and that question is asked with the cursor down here. The
            nested `.adm-btn-row` keeps the line and its icon together when the
            footer wraps on a narrow window.
          */}
          <span className="adm-btn-row">
            <span className="adm-micro">
              Normally unnecessary — every experience save rebuilds this.
            </span>
            <InfoTip label="About rebuilding the work history">
              Roles are authored in <code>experienceEntries</code> and projected
              into this document as free-form period labels (<code>2022</code>,{" "}
              <code>Present</code>) — exactly the text the page and the PDF print.
              Every create, edit, reorder and delete rebuilds the projection in the
              same transaction, so this button is for the cases that chain never
              ran: a restored backup, rows imported straight into the table, or a
              projection edited by hand in the Convex dashboard.
            </InfoTip>
          </span>
        </AdminButtonRow>
      }
    >
      {drifted ? (
        <AdminNotice tone="warn" title="The projection is out of step">
          {sourceRows} entries in the table, {projected} roles in the document.
          Rebuild to bring them back together.
        </AdminNotice>
      ) : null}

      {result !== null && !result.synced ? (
        <AdminNotice tone="info" title="Nothing to rebuild into">
          There is no résumé document yet, so the rebuild was a no-op — not a
          failure. Save the résumé below and its work history is built from the{" "}
          {result.roles} {result.roles === 1 ? "entry" : "entries"} as part of that
          write.
        </AdminNotice>
      ) : null}

      {result !== null && result.synced ? (
        <p className="adm-micro" role="status">
          Rebuilt: {result.roles} {result.roles === 1 ? "role" : "roles"} projected.
        </p>
      ) : null}

      {/* Read-only, because it is derived. Rendering it at all is what makes
          "the PDF and the page cannot disagree" checkable rather than asserted. */}
      {projected === 0 ? (
        <p className="adm-micro">No roles projected yet.</p>
      ) : (
        /* No `marginTop` any more: the explanatory paragraph that used to sit
           above this is gone, so the list is usually the first thing in the panel
           body and a leading margin would be a gap against the panel's own
           padding. When a notice *is* above it, `.adm-notice + *` supplies the
           spacing — which is the rule the kit asks pages to lean on instead of
           one-off values. */
        <ol className="adm-form" style={{ paddingLeft: 0, listStyle: "none" }}>
          {resumeDoc?.experience.map((role, index) => (
            <li key={`${role.company}-${role.start}-${index}`}>
              <p>
                <strong>{role.title}</strong> — {role.company}{" "}
                <span className="adm-mono adm-micro">
                  {role.start} → {role.end}
                </span>
              </p>
              <p className="adm-micro">{role.summary}</p>
            </li>
          ))}
        </ol>
      )}
    </AdminPanel>
  );
}

/* ------------------------------------------------------------------ *
 * Education
 * ------------------------------------------------------------------ */

/**
 * The education rows: a repeater with move and remove, no drag-and-drop.
 *
 * The kit's position, and it is right: the keyboard implementation of
 * drag-and-drop *is* a pair of move buttons, so building only the buttons costs
 * nothing anyone can use.
 *
 * `start` and `end` are `TextField`s and **not** `DateField`s, which looks like an
 * oversight and is not. `resume.upsert` stores them as free-form labels printed
 * verbatim — `2011`, `Mar 2011`, `Present` — precisely because education periods on
 * a résumé are written the way a human writes them, and some of them predate
 * records precise enough to be a date at all. A date picker here would force a day
 * nobody knows and then print it.
 */
function EducationPanel({
  rows,
  onPatch,
  onReplace,
}: {
  rows: readonly EducationRow[];
  onPatch: (index: number, patch: Partial<EducationRow>) => void;
  onReplace: (rows: EducationRow[]) => void;
}) {
  const move = (index: number, delta: number) => {
    const to = index + delta;
    if (to < 0 || to >= rows.length) {
      return;
    }

    const next = [...rows];
    const [row] = next.splice(index, 1);
    next.splice(to, 0, row);
    onReplace(next);
  };

  return (
    <AdminPanel
      title="Education"
      /* Why the two period fields are not date pickers. The reader who wonders is
         the reader who is about to file it as a bug, and one hover is the whole
         answer. */
      info={
        <>
          <code>From</code> and <code>To</code> are free-form labels printed
          verbatim — <code>2011</code>, <code>Mar 2011</code>,{" "}
          <code>Present</code> — because that is how a résumé writes them, and
          some of them predate records precise enough to be a date at all.
        </>
      }
      infoLabel="About education periods"
      headerEnd={
        <span className="adm-eyebrow">
          {rows.length} of {MAX_EDUCATION}
        </span>
      }
      footer={
        <AdminButtonRow>
          <button
            type="button"
            className="adm-btn"
            disabled={rows.length >= MAX_EDUCATION}
            title={
              rows.length >= MAX_EDUCATION
                ? `A résumé may list at most ${MAX_EDUCATION} education entries.`
                : undefined
            }
            onClick={() => onReplace([...rows, { ...EMPTY_ROW }])}
          >
            Add a row
          </button>
        </AdminButtonRow>
      }
    >
      {rows.length === 0 ? (
        <p className="adm-micro">
          No education rows. The section is omitted from the page and the PDF when
          this list is empty.
        </p>
      ) : null}

      <div className="adm-form">
        {rows.map((row, index) => (
          <div
            // Index-keyed on purpose: these rows have no id, and the two operations
            // that reorder them (`move`) replace the whole array, so a content-derived
            // key would collide between two blank rows the moment "Add a row" is
            // pressed twice.
            key={index}
            style={{
              borderTop: index === 0 ? "none" : "1px solid var(--hor-line)",
              paddingTop: index === 0 ? 0 : "0.9rem",
            }}
          >
            <FieldRow>
              <TextField
                label="Institution"
                value={row.institution}
                onValueChange={(value) => onPatch(index, { institution: value })}
                required
                maxLength={160}
              />
              <TextField
                label="Credential"
                value={row.credential}
                onValueChange={(value) => onPatch(index, { credential: value })}
                required
                maxLength={200}
              />
            </FieldRow>

            <FieldRow>
              <TextField
                label="From"
                value={row.start}
                onValueChange={(value) => onPatch(index, { start: value })}
                required
                maxLength={40}
                placeholder="2008"
              />
              <TextField
                label="To"
                value={row.end}
                onValueChange={(value) => onPatch(index, { end: value })}
                required
                maxLength={40}
                /* The placeholders replace two hints saying the same thing the
                   panel's tooltip now says once: these are labels, not dates.
                   A placeholder is the cheaper carrier — it occupies no vertical
                   space and disappears the moment it is no longer true. */
                placeholder="Present"
              />
            </FieldRow>

            <AdminButtonRow>
              <button
                type="button"
                className="adm-btn"
                data-size="sm"
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                Move up
              </button>
              <button
                type="button"
                className="adm-btn"
                data-size="sm"
                disabled={index === rows.length - 1}
                onClick={() => move(index, 1)}
              >
                Move down
              </button>
              <button
                type="button"
                className="adm-btn"
                data-variant="danger"
                data-size="sm"
                onClick={() =>
                  onReplace(rows.filter((_, at) => at !== index))
                }
              >
                Remove row
              </button>
            </AdminButtonRow>
          </div>
        ))}
      </div>
    </AdminPanel>
  );
}
