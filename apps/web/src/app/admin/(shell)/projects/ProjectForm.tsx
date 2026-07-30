"use client";

import { api } from "@home/convex/api";
import type { Doc } from "@home/convex/dataModel";
import type { MediaAsset } from "@home/types";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  ActionButton,
  AdminButtonRow,
  AdminForm,
  AdminNotice,
  AdminPanel,
  DeleteButton,
  Field,
  FieldRow,
  findUnsupportedMarkdown,
  MediaListEditor,
  NumberField,
  RichTextEditor,
  SaveButton,
  SlugField,
  StatusBadge,
  TextAreaField,
  TextField,
  ToggleField,
  usePendingAction,
  ViewOnSite,
} from "@/components/admin";

import { linesToText, textToLines } from "./lines";

/**
 * The case-study editor — every writable field on `projects`, in one form.
 *
 * One component serves both `/admin/projects/new` and
 * `/admin/projects/[slug]`, because the two differ in exactly three ways and a
 * second copy of twenty fields would drift from the first within a week:
 *
 *   • which mutation the primary button calls (`create` vs `update`),
 *   • whether the publish / delete panels exist at all (a draft has to exist
 *     before it can be published or deleted),
 *   • where it navigates afterwards.
 *
 * `row === null` is the create case. Everything else is shared.
 *
 * ── The draft, and why it is flat strings ───────────────────────────────────
 *
 * `ProjectDraft` below is *not* `Doc<'projects'>`. It is the form's own shape:
 * every optional string field is a required `string` where `""` means absent,
 * and the two array fields are newline-separated text (see `lines.ts`). The
 * translation back to the mutation's shape happens once, in `submit`, and that
 * is deliberate — an editor whose state is "the document, but some fields might
 * be undefined" spends every field on `value={row.period ?? ""}` and every
 * change handler deciding whether to delete a key.
 *
 * The one exception is `media`, which stays as `MediaAsset[]` because
 * `MediaListEditor` owns that shape and the ADR-009 flag lives inside it.
 *
 * ── Validation lives in Convex, not here ───────────────────────────────────
 *
 * Nothing below checks a length, a URL or a slug's uniqueness. `create` and
 * `update` assert all of it (see `assertProjectFields` in
 * `packages/convex/convex/projects.ts`) and their messages are written to be
 * read by the person who caused them, so `usePendingAction` surfaces them
 * verbatim. The two client-side checks that *are* here are not validation:
 *
 *   • the ADR-009 report, which mirrors the gate so a refusal is not a surprise
 *     (`MediaListEditor` counts, and the publish panel names the offenders), and
 *   • `dirty`, which only decides whether the Save button is enabled.
 *
 * ── Which narrative field got the rich-text editor, and why only one ────────
 *
 * `body` is edited with `RichTextEditor`. `problem` and `approach` are not, and
 * that is a deliberate reading of the schema rather than an unfinished job:
 *
 *   • `projects.body` is documented in both `packages/types/src/content.ts` and
 *     `packages/convex/convex/schema.ts` as "long-form **Markdown** for anything
 *     outside problem/approach/outcomes". Markdown in, Markdown out is exactly
 *     `RichTextEditor`'s contract.
 *   • `problem` and `approach` are 2–3 sentences of prose, and
 *     `components/site/work/CaseNarrative.tsx` renders each one as
 *     `<p className="hor-lede">{body}</p>` — a text node. There is no Markdown
 *     renderer on the public site at all. A toolbar that writes `**bold**` into
 *     those fields would put four literal asterisks on the live page, and the
 *     asymmetry (a heading button on a field that renders as one paragraph)
 *     would be inviting structure the type does not have.
 *
 * If a Markdown renderer lands for the narrative trio, the swap is two `Field`
 * blocks below and nothing else.
 *
 * ── Where the prose that used to be on this screen went ────────────────────
 *
 * This form had a hint paragraph under nine fields and a notice above two
 * panels. Everything that merely *explained* — which ADR governs a field, what a
 * value is rendered as, where a number comes from — is now an `InfoTip` in the
 * panel heading that owns those fields, per README §2a. What stayed inline is
 * the text a reader has to act on: the ADR-009 blockers (twice, deliberately —
 * the draft's count while editing and the stored row's count on the publish
 * panel), the delete warning, and the one-line format rules the mutation will
 * refuse a save over.
 */

/* ------------------------------------------------------------------ *
 * The draft
 * ------------------------------------------------------------------ */

export type ProjectDraft = {
  slug: string;
  title: string;

  client: string;
  attribution: string;
  role: string;
  /** `""` = absent. */
  period: string;

  summary: string;
  /** `""` = absent. */
  problem: string;
  /** `""` = absent. */
  approach: string;
  /** One outcome per line. See `lines.ts`. */
  outcomes: string;
  /** `""` = absent. */
  body: string;

  /** One technology per line. See `lines.ts`. */
  stack: string;
  media: MediaAsset[];
  /** `links.live`, `""` = absent. */
  live: string;
  /** `links.press`, `""` = absent. */
  press: string;
  accent: string;
  /**
   * Required by the schema, so this is a plain `number` and not `number | null`:
   * there is no "absent hue" to model. Emptying the input therefore reads as
   * `0` (red) rather than as blank, which is honest about what would be saved.
   */
  accentHue: number;

  /** `aiBuildStats.sessions`. `null` = the block is absent. */
  aiSessions: number | null;
  /** `aiBuildStats.hours`. `null` = the block is absent. */
  aiHours: number | null;

  featured: boolean;
  /** `null` on create = "put it last". `sortOrder: 0` is a real position. */
  sortOrder: number | null;
};

/**
 * A blank case study.
 *
 * The accent defaults to a real colour rather than to `""`, because `accent` and
 * `accentHue` are required design tokens (the variants derive gradients from
 * them and the procedural placeholder art depends on them), and a form that
 * opens with an invalid required field teaches you to ignore the error state.
 * The two agree: hue 212 is the blue below.
 */
function blankDraft(): ProjectDraft {
  return {
    slug: "",
    title: "",
    client: "",
    attribution: "",
    role: "",
    period: "",
    summary: "",
    problem: "",
    approach: "",
    outcomes: "",
    body: "",
    stack: "",
    media: [],
    live: "",
    press: "",
    accent: "hsl(212 88% 58%)",
    accentHue: 212,
    aiSessions: null,
    aiHours: null,
    featured: false,
    sortOrder: null,
  };
}

/** A stored document → the form's shape. The inverse of `submit` below. */
function draftFromRow(row: Doc<"projects">): ProjectDraft {
  return {
    slug: row.slug,
    title: row.title,
    client: row.client,
    attribution: row.attribution,
    role: row.role,
    period: row.period ?? "",
    summary: row.summary,
    problem: row.problem ?? "",
    approach: row.approach ?? "",
    outcomes: linesToText(row.outcomes),
    body: row.body ?? "",
    stack: linesToText(row.stack),
    /* Copied, not aliased: `MediaListEditor` replaces the array on every edit,
       but the assets inside are shared with `row` until one is edited, which is
       what keeps the `dirty` comparison below cheap and accurate. */
    media: [...row.media],
    live: row.links.live ?? "",
    press: row.links.press ?? "",
    accent: row.accent,
    accentHue: row.accentHue,
    aiSessions: row.aiBuildStats?.sessions ?? null,
    aiHours: row.aiBuildStats?.hours ?? null,
    featured: row.featured,
    sortOrder: row.sortOrder,
  };
}

/**
 * `aiBuildStats`, or `null` when neither number was given.
 *
 * The block is all-or-nothing in the schema — `{ sessions, hours }` with both
 * required — so one field filled in means the other counts as zero rather than
 * as a reason to refuse the save. Phase 4's collector overwrites the whole block
 * anyway; see the panel's note.
 */
function aiBuildStatsFrom(
  draft: ProjectDraft,
): { sessions: number; hours: number } | null {
  if (draft.aiSessions === null && draft.aiHours === null) {
    return null;
  }

  return { sessions: draft.aiSessions ?? 0, hours: draft.aiHours ?? 0 };
}

/** The assets that would make `publish` refuse. Mirrors `assertSanitisedMedia`. */
function unsanitised(media: readonly MediaAsset[]): MediaAsset[] {
  return media.filter((asset) => asset.sanitised !== true);
}

/**
 * `["a table", "an image"]` → `"a table and an image"`.
 *
 * `findUnsupportedMarkdown` returns its findings already phrased to drop into a
 * sentence, so all that is left is the conjunction. Used once, for the notice
 * that explains why a body is being offered as raw Markdown.
 */
function listPhrase(items: readonly string[]): string {
  if (items.length <= 1) {
    return items[0] ?? "";
  }

  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/* ------------------------------------------------------------------ *
 * The form
 * ------------------------------------------------------------------ */

export function ProjectForm({
  /** The stored document, or `null` to create a new one. */
  row,
}: Readonly<{ row: Doc<"projects"> | null }>) {
  const router = useRouter();

  const create = useMutation(api.projects.create);
  const update = useMutation(api.projects.update);
  const publish = useMutation(api.projects.publish);
  const unpublish = useMutation(api.projects.unpublish);
  const remove = useMutation(api.projects.remove);

  /**
   * One pending state for every write that keeps you on this page, and a second
   * one for the delete that does not.
   *
   * Sharing matters: Save and Publish disable each other, because publishing
   * reads the stored row and a save landing mid-publish would decide which
   * version went public by whichever request the server handled first. Delete is
   * separate only so that its success does not flash "Saved" on the Save button.
   */
  const write = usePendingAction();
  const destroy = usePendingAction();

  /**
   * Initialised once. The parent keys this component on `row._id`, so switching
   * documents remounts rather than mutating state — and a live update to the row
   * from another tab (or the iOS app) does *not* overwrite what is being typed.
   */
  const [draft, setDraft] = useState<ProjectDraft>(() =>
    row === null ? blankDraft() : draftFromRow(row),
  );

  /** Patch one field. Every control below is `patch({ … })`. */
  const patch = (fields: Partial<ProjectDraft>) =>
    setDraft((current) => ({ ...current, ...fields }));

  /**
   * Whether this body can be edited as rich text, decided **once** from the
   * stored document.
   *
   * `RichTextEditor` destroys a handful of Markdown constructs silently — a GFM
   * table becomes the empty string, an image becomes its alt text — and the kit
   * exports `findUnsupportedMarkdown` precisely so a form can refuse to offer the
   * editor rather than warn after the fact (README §4b).
   *
   * Read from `row` at mount rather than from `draft.body` on every render, and
   * that is the whole point of the `useState` initialiser: recomputing it live
   * would swap the control out from under someone the moment they typed a pipe
   * table's second row, and swap it back when they deleted it. The choice has to
   * be stable for as long as the form is mounted — which is per document, since
   * `ProjectEditor` keys this component on `row._id`.
   */
  const [bodyLossy] = useState<readonly string[]>(() =>
    findUnsupportedMarkdown(row?.body ?? ""),
  );

  /**
   * Has anything changed?
   *
   * Compared against the *live* row rather than a snapshot taken at mount, which
   * gives the behaviour for free: after a successful save the subscription pushes
   * the new document, the comparison matches, and the Save button disables
   * itself. `JSON.stringify` is honest enough for the job — both sides are built
   * by `draftFromRow`, so key order agrees, and the only way to get a false
   * positive is an asset whose keys were reordered by an edit, which would
   * merely leave Save enabled.
   */
  const stored = useMemo(() => (row === null ? null : draftFromRow(row)), [row]);
  const dirty = stored === null || JSON.stringify(draft) !== JSON.stringify(stored);

  /* The gate, mirrored twice over. The draft's count is immediate feedback while
     editing (MediaListEditor shows it too); the stored row's count is what
     `publish` will actually assert, because it reads the document and not the
     form. */
  const draftOffenders = unsanitised(draft.media);
  const storedOffenders = row === null ? [] : unsanitised(row.media);
  const publishBlocked = storedOffenders.length > 0;

  /* ---- writes ---- */

  async function submit(): Promise<void> {
    const outcomes = textToLines(draft.outcomes);
    const stack = textToLines(draft.stack);
    const aiBuildStats = aiBuildStatsFrom(draft);

    /* `links` is replaced whole by both mutations, so an empty string means the
       key is simply not sent — there is no `null` to clear a nested field with. */
    const links = {
      ...(draft.live.trim().length > 0 ? { live: draft.live.trim() } : {}),
      ...(draft.press.trim().length > 0 ? { press: draft.press.trim() } : {}),
    };

    if (row === null) {
      /* No `published` argument exists on `create` — everything is inserted as a
         draft and reaches the public site only through `publish`, which is where
         the ADR-009 gate lives. Optional fields are omitted rather than sent
         empty: `assertText` refuses an empty string. */
      const created = await create({
        slug: draft.slug,
        title: draft.title,
        client: draft.client,
        attribution: draft.attribution,
        role: draft.role,
        ...(draft.period.trim().length > 0 ? { period: draft.period } : {}),
        summary: draft.summary,
        ...(draft.problem.trim().length > 0 ? { problem: draft.problem } : {}),
        ...(draft.approach.trim().length > 0 ? { approach: draft.approach } : {}),
        ...(outcomes.length > 0 ? { outcomes } : {}),
        ...(draft.body.trim().length > 0 ? { body: draft.body } : {}),
        stack,
        media: draft.media,
        links,
        accent: draft.accent,
        accentHue: draft.accentHue,
        ...(aiBuildStats !== null ? { aiBuildStats } : {}),
        featured: draft.featured,
        ...(draft.sortOrder !== null ? { sortOrder: draft.sortOrder } : {}),
      });

      /* `replace`, not `push`: the "new" URL should not be a back-button target
         now that the document exists, or Back re-opens a blank form that would
         create a second copy. */
      router.replace(`/admin/projects/${created.slug}`);
      return;
    }

    /**
     * Every field, every time.
     *
     * `update` is a patch API, so sending only what changed would be smaller —
     * and would need a diff, which is a second source of truth for "what is in
     * this form". Sending the whole form makes the request describe the document
     * as the person editing it believes it to be. Optional fields go as `null`
     * when empty, which is how the API distinguishes "clear this" from "leave it
     * alone" (omission).
     *
     * ⚠️ Because `media` is always sent, saving an already-published row runs the
     * ADR-009 assertion in `update` as well. That is the point of it being there —
     * publishing clean and then editing dirty screenshots in would otherwise
     * bypass the gate — and it is why the publish panel names the offenders.
     */
    const saved = await update({
      projectId: row._id,
      slug: draft.slug,
      title: draft.title,
      client: draft.client,
      attribution: draft.attribution,
      role: draft.role,
      period: draft.period.trim().length > 0 ? draft.period : null,
      summary: draft.summary,
      problem: draft.problem.trim().length > 0 ? draft.problem : null,
      approach: draft.approach.trim().length > 0 ? draft.approach : null,
      outcomes: outcomes.length > 0 ? outcomes : null,
      body: draft.body.trim().length > 0 ? draft.body : null,
      stack,
      media: draft.media,
      links,
      accent: draft.accent,
      accentHue: draft.accentHue,
      aiBuildStats,
      featured: draft.featured,
      ...(draft.sortOrder !== null ? { sortOrder: draft.sortOrder } : {}),
    });

    /* A slug rename moves the page it is being edited on. `replace` keeps the
       history sane and the subscription re-resolves against the new slug. */
    if (saved.slug !== row.slug) {
      router.replace(`/admin/projects/${saved.slug}`);
    }
  }

  /* ---- render ---- */

  return (
    <AdminForm>
      {/* ── Identity ─────────────────────────────────────────────────── */}

      {/* Every panel below puts its explanation in `AdminPanel`'s `info` prop,
          which renders the tip beside the title in `.adm-panel-title-row` — the
          reader finds the icon next to the words it explains. `headerEnd` is
          reserved for controls and status (here, the `StatusBadge`), never for
          tips. */}
      <AdminPanel
        title="Identity"
        info={
          <>
            <strong>Attribution</strong> is the credit line on the card, stored
            rather than derived so the wording can be agreed per client without
            a deploy (ADR 008: attribution is not ownership).{" "}
            <strong>Period</strong> is free text rendered verbatim, not a date
            range — some of this work predates precise records.
          </>
        }
        infoLabel="About a case study's identity fields"
        headerEnd={
          row === null ? null : (
            <StatusBadge published={row.published} featured={row.featured} />
          )
        }
      >
        <AdminForm>
          <TextField
            label="Title"
            value={draft.title}
            onValueChange={(title) => patch({ title })}
            placeholder="QuoteCloud"
            maxLength={160}
            required
          />

          <SlugField
            value={draft.slug}
            onValueChange={(slug) => patch({ slug })}
            source={draft.title}
            prefix="/work/"
            published={row?.published ?? false}
            required
          />

          <FieldRow>
            <TextField
              label="Client"
              value={draft.client}
              onValueChange={(client) => patch({ client })}
              placeholder="Corporate Interactive"
              maxLength={160}
              required
            />
            <TextField
              label="Role"
              value={draft.role}
              onValueChange={(role) => patch({ role })}
              placeholder="Principal Engineer"
              maxLength={120}
              required
            />
          </FieldRow>

          <FieldRow>
            <TextField
              label="Attribution"
              value={draft.attribution}
              onValueChange={(attribution) => patch({ attribution })}
              placeholder="Built at Corporate Interactive — client-owned"
              maxLength={200}
              required
            />
            <TextField
              label="Period"
              value={draft.period}
              onValueChange={(period) => patch({ period })}
              placeholder="2022 — Present"
              maxLength={60}
              optional
            />
          </FieldRow>
        </AdminForm>
      </AdminPanel>

      {/* ── Narrative ────────────────────────────────────────────────── */}

      <AdminPanel
        title="Narrative"
        info={
          <>
            <strong>Summary</strong> is the card copy and the meta description.{" "}
            <strong>Problem</strong> and <strong>approach</strong> are the two
            chapters <code>/work/[slug]</code> renders, each as a single plain
            paragraph — Markdown is <em>not</em> parsed there, so write prose.{" "}
            <strong>Body</strong> is the one Markdown field, for anything the trio
            has no room for.
          </>
        }
        infoLabel="About a case study's narrative fields"
      >
        <AdminForm>
          <TextAreaField
            label="Summary"
            value={draft.summary}
            onValueChange={(summary) => patch({ summary })}
            placeholder="One or two sentences."
            maxLength={400}
            rows={3}
            required
          />

          <FieldRow>
            <TextAreaField
              label="Problem"
              value={draft.problem}
              onValueChange={(problem) => patch({ problem })}
              placeholder="What was broken before. Two or three sentences."
              maxLength={4000}
              rows={5}
              optional
            />
            <TextAreaField
              label="Approach"
              value={draft.approach}
              onValueChange={(approach) => patch({ approach })}
              placeholder="How it was solved — architecture, delivery, the shape of the team."
              maxLength={4000}
              rows={5}
              optional
            />
          </FieldRow>

          <TextAreaField
            label="Outcomes"
            value={draft.outcomes}
            onValueChange={(outcomes) => patch({ outcomes })}
            placeholder={"Deploys went from fortnightly to hourly\nTime-to-quote cut by 60%"}
            rows={4}
            optional
            /* Kept inline: these are the bounds `assertProjectFields` refuses a
               save over, and "one per line" is the format of the control itself.
               Neither is something to discover from a tooltip after a rejection. */
            hint="One per line, at most twelve, 280 characters each. Blank lines are dropped."
          />

          {/* ── Body ──────────────────────────────────────────────────────
              Two controls for one field, chosen once at mount. The editor is
              the default; a body carrying something the Markdown round-trip
              would destroy gets the raw textarea and a notice saying which
              construct cost it the editor. That inline notice is judgement text
              by §2a — the alternative is silent data loss on the next save — so
              it does not go in a tooltip. */}
          {bodyLossy.length > 0 ? (
            <>
              <AdminNotice tone="warn" title="Body opened as raw Markdown">
                This body contains {listPhrase(bodyLossy)}, which the rich-text
                editor cannot represent — opening it there would drop{" "}
                {bodyLossy.length === 1 ? "it" : "them"} the next time this form
                saved. So the raw Markdown is offered instead, with no toolbar.
                Remove the construct and reload the page to get the editor back.
              </AdminNotice>

              <TextAreaField
                label="Body"
                value={draft.body}
                onValueChange={(body) => patch({ body })}
                placeholder="Markdown, for anything that does not fit problem / approach / outcomes."
                maxLength={40000}
                rows={12}
                mono
                optional
              />
            </>
          ) : (
            /* `Field`'s render prop is what wires the editor's `id`,
               `describedBy` and `invalid` for it. `ariaLabel` is not optional
               here and the kit says so: `<label for>` only binds to a labelable
               element, and the writing area is a contenteditable div. */
            <Field label="Body" optional>
              {({ id, describedBy, invalid }) => (
                <RichTextEditor
                  id={id}
                  describedBy={describedBy}
                  invalid={invalid}
                  ariaLabel="Body"
                  value={draft.body}
                  onChange={(body) => patch({ body })}
                  placeholder="Anything that does not fit problem / approach / outcomes."
                  minRows={10}
                />
              )}
            </Field>
          )}
        </AdminForm>
      </AdminPanel>

      {/* ── Media (ADR 009) ──────────────────────────────────────────── */}

      <AdminPanel
        title="Media"
        info={
          <>
            Screenshots of client software. <strong>Sanitised</strong> means the
            client data is scrubbed and the identifiers are gone; ADR 009 makes it
            a precondition of publishing, and <code>projects.media</code> is the
            only field in the admin that carries the flag. Order is the order they
            render in.
          </>
        }
        infoLabel="About case-study media and ADR 009"
      >
        <AdminForm>
          {draftOffenders.length > 0 ? (
            <AdminNotice tone="warn" title="Publishing is blocked">
              ADR 009 requires every case-study screenshot to be sanitised —
              client data scrubbed, identifiers removed — before it can go public.{" "}
              {draftOffenders.length} of {draft.media.length}{" "}
              {draftOffenders.length === 1 ? "image is" : "images are"} not marked:{" "}
              {draftOffenders
                .map(
                  (asset) =>
                    `#${draft.media.indexOf(asset) + 1} ${asset.alt || "(no alt text)"}`,
                )
                .join("; ")}
              . Tick <strong>Sanitised</strong> on each once it has actually been
              checked; the publish mutation refuses either way, so ticking it here
              without doing the work only moves where the mistake happens.
            </AdminNotice>
          ) : null}

          <MediaListEditor
            value={draft.media}
            onValueChange={(media) => patch({ media })}
            /* ADR 009: `projects.media` is the only field this flag belongs on.
               It also seeds a fresh upload with `sanitised: false` rather than
               omitting the key — "not yet checked" is a fact worth storing. */
            requireSanitised
            withCaption
          />
        </AdminForm>
      </AdminPanel>

      {/* ── Presentation ─────────────────────────────────────────────── */}

      <AdminPanel
        title="Presentation"
        info={
          <>
            <strong>Accent</strong> and <strong>accent hue</strong> are required
            design tokens: the variants derive gradients from the colour and the
            procedural placeholder art derives its ramp from the bare hue, so the
            two have to describe the same colour. <strong>Live</strong> is the
            public product, where the client is happy to be named;{" "}
            <strong>press</strong> is a writeup or award page hosted elsewhere.
            There is no repo link on a case study, by design (ADR 008).
          </>
        }
        infoLabel="About a case study's presentation fields"
      >
        <AdminForm>
          <TextAreaField
            label="Stack"
            value={draft.stack}
            onValueChange={(stack) => patch({ stack })}
            placeholder={"TypeScript\nNext.js\nPostgres"}
            rows={4}
            /* Kept inline: a bound the mutation refuses a save over, plus the
               format of the control. */
            hint="One per line, at most forty. Order is the render order."
          />

          <FieldRow>
            <TextField
              label="Accent"
              value={draft.accent}
              onValueChange={(accent) => patch({ accent })}
              placeholder="hsl(212 88% 58%)"
              maxLength={64}
              required
              /* The only hint on this panel that is not text: a live swatch of
                 the value is worth more than any sentence about it, and it is
                 the one thing a tooltip could not carry. */
              hint={
                <>
                  <span
                    aria-hidden="true"
                    /* The one inline style on this screen. A swatch cannot be
                       expressed as a class — the colour is the field's value —
                       and `admin.css` belongs to the kit. */
                    style={{
                      display: "inline-block",
                      width: "0.75em",
                      height: "0.75em",
                      borderRadius: "2px",
                      verticalAlign: "-0.05em",
                      background: draft.accent,
                    }}
                  />{" "}
                  Any CSS colour.
                </>
              }
            />
            <NumberField
              label="Accent hue"
              value={draft.accentHue}
              /* Required in the schema, so an empty input has to mean *something*
                 — and `0` (red) is the honest reading of what would be saved. */
              onValueChange={(accentHue) => patch({ accentHue: accentHue ?? 0 })}
              min={0}
              max={360}
              step={1}
              required
              /* Kept inline, short: nothing validates this, so a hue that has
                 drifted from the accent is a silent visual bug on the live page
                 and the warning has to be where the number is typed. */
              hint="Keep in agreement with the accent."
            />
          </FieldRow>

          <FieldRow>
            <TextField
              label="Live URL"
              value={draft.live}
              onValueChange={(live) => patch({ live })}
              type="url"
              placeholder="https://example.com"
              optional
            />
            <TextField
              label="Press URL"
              value={draft.press}
              onValueChange={(press) => patch({ press })}
              type="url"
              placeholder="https://example.com/case-study"
              optional
            />
          </FieldRow>

          <FieldRow>
            <NumberField
              label="Sort order"
              value={draft.sortOrder}
              onValueChange={(sortOrder) => patch({ sortOrder })}
              min={0}
              step={1}
              optional
              hint={
                row === null
                  ? "Empty adds it last."
                  : "Lower sorts first; the list's arrows are easier."
              }
            />
            {/* The toggle is not a `Field`, so it needs the wrapper to line up
                with the number input in the other grid cell. */}
            <div className="adm-field">
              <ToggleField
                label="Featured"
                checked={draft.featured}
                onCheckedChange={(featured) => patch({ featured })}
                description="Eligible for the dashboard's hero row."
              />
            </div>
          </FieldRow>
        </AdminForm>
      </AdminPanel>

      {/* ── Agent instrumentation (ADR 016) ──────────────────────────── */}

      {/* The "Collector-owned" notice that used to sit above these two numbers is
          now the panel's tip. It is chrome by §2a's test: it says where the values
          come from, and nothing a reader does with it is irreversible — a manual
          override that a later ingest replaces is the documented behaviour, not a
          mistake to be warned off. */}
      <AdminPanel
        title="Agent build stats"
        info={
          <>
            Per-project agent effort (ADR 016), meant to arrive from the AI-usage
            collector, which maps a repo path onto this project&rsquo;s slug.
            Editable here as a manual override and for work the collector never
            saw — expect a later ingest to replace what you type. Hours are
            wall-clock across those sessions and may be fractional. Clear both to
            remove the block entirely.
          </>
        }
        infoLabel="About agent build stats"
      >
        <AdminForm>
          <FieldRow>
            <NumberField
              label="Sessions"
              value={draft.aiSessions}
              onValueChange={(aiSessions) => patch({ aiSessions })}
              min={0}
              step={1}
              optional
            />
            <NumberField
              label="Hours"
              value={draft.aiHours}
              onValueChange={(aiHours) => patch({ aiHours })}
              min={0}
              step={0.1}
              optional
            />
          </FieldRow>
        </AdminForm>
      </AdminPanel>

      {/* ── Save ─────────────────────────────────────────────────────── */}

      {/* Not a panel any more. This was a bordered box whose body said "There are
          unsaved changes on this form" above a footer holding one button — a
          border and two paddings to restate what the Save button's own enabled
          state already says. The row keeps the one sentence that is not derivable
          from the button (what pressing it *creates*, in create mode) and drops
          the furniture. */}
      <AdminButtonRow>
        <SaveButton
          action={write}
          onAction={submit}
          label={row === null ? "Create draft" : "Save"}
          dirty={dirty}
        />

        <span className="adm-micro">
          {row === null
            ? "Nothing is written until you press Create, and a new case study is always a draft — publishing is a separate step on the next screen."
            : dirty
              ? "Unsaved changes."
              : "Saved — this form matches the stored document."}
        </span>
      </AdminButtonRow>

      {/* ── Publish / delete — edit mode only ────────────────────────── */}

      {row !== null ? (
        <>
          <AdminPanel
            title="Publish"
            info={
              <>
                Unpublishing is immediate and keeps the sort order and the
                featured flag, so re-publishing puts the case study back where
                it was. <code>projects.publish</code> asserts ADR 009 against
                the <em>saved</em> document, not against this form.
              </>
            }
            infoLabel="About publishing a case study"
            headerEnd={<StatusBadge published={row.published} />}
          >
            <AdminForm>
              {publishBlocked ? (
                <AdminNotice tone="warn" title="The publish gate will refuse this">
                  {storedOffenders.length} of {row.media.length} saved{" "}
                  {storedOffenders.length === 1 ? "image is" : "images are"} not
                  marked sanitised:{" "}
                  {storedOffenders
                    .map(
                      (asset) =>
                        `#${row.media.indexOf(asset) + 1} ${asset.alt || "(no alt text)"}`,
                    )
                    .join("; ")}
                  . <code>projects.publish</code> asserts ADR 009 against the{" "}
                  <em>saved</em> document, so tick the boxes above and save before
                  trying.
                </AdminNotice>
              ) : null}

              {dirty ? (
                <p className="adm-micro">
                  Publishing acts on the last saved version, not on what is in
                  this form. Save first if the change matters.
                </p>
              ) : null}

              <AdminButtonRow>
                {row.published ? (
                  <ActionButton
                    action={write}
                    onAction={() => unpublish({ projectId: row._id })}
                    pendingLabel="Withdrawing…"
                  >
                    Unpublish
                  </ActionButton>
                ) : (
                  <ActionButton
                    action={write}
                    variant="primary"
                    onAction={() => publish({ projectId: row._id })}
                    pendingLabel="Publishing…"
                    disabled={publishBlocked}
                    title={
                      publishBlocked
                        ? "Blocked by ADR 009 — some saved images are not marked sanitised."
                        : undefined
                    }
                  >
                    Publish
                  </ActionButton>
                )}

                {/* Was a hand-rolled `<a className="adm-btn">` that linked to
                    `/work/<slug>` unconditionally — i.e. to a 404 for every
                    draft, which is the exact failure `ViewOnSite` exists to
                    stop. It renders the muted "Draft — not public yet" state
                    instead, from the `published` flag already on the row. */}
                <ViewOnSite
                  href={`/work/${row.slug}`}
                  published={row.published}
                />
              </AdminButtonRow>

              {/* Kept inline, and only while it applies: this is the answer to
                  "why does my URL 404", which is a zero-state notice by §2a and
                  not something to find by hovering. */}
              {row.published ? null : (
                <p className="adm-micro">
                  A draft is readable only with an admin session — its public URL
                  404s.
                </p>
              )}
            </AdminForm>
          </AdminPanel>

          <AdminPanel title="Delete">
            <AdminForm>
              <AdminNotice tone="danger" title="Irreversible">
                There is no undo and no trash. Uploaded images stay on the CDN as
                orphans (a Convex mutation cannot reach UploadThing), and anything
                referencing this slug — featured selections, the knowledge index —
                keeps naming a document that no longer exists.{" "}
                <strong>Unpublish instead</strong> if the intent is just to take it
                off the site.
              </AdminNotice>

              <AdminButtonRow>
                <DeleteButton
                  action={destroy}
                  name={row.title}
                  size="md"
                  onAction={async () => {
                    await remove({ projectId: row._id });
                    router.replace("/admin/projects");
                  }}
                />
              </AdminButtonRow>
            </AdminForm>
          </AdminPanel>
        </>
      ) : null}
    </AdminForm>
  );
}
