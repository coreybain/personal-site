"use client";

import { api } from "@home/convex/api";
import type { Doc } from "@home/convex/dataModel";
import type { MediaAsset } from "@home/types";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  ActionButton,
  AdminButtonRow,
  AdminForm,
  AdminNotice,
  AdminPanel,
  DeleteButton,
  FieldRow,
  formatInstant,
  ImageUpload,
  NumberField,
  SaveButton,
  SlugField,
  StatusBadge,
  TextAreaField,
  TextField,
  ToggleField,
  usePendingAction,
  ViewOnSite,
} from "@/components/admin";

/**
 * The Lab editor — the hand-written half of a `labs` row.
 *
 * One component for `/admin/labs/new` and `/admin/labs/[slug]`; `row === null` is
 * the create case. Same arrangement as `ProjectForm`, and for the same reason: the
 * two modes differ in the mutation, the extra panels and the redirect, and nothing
 * else.
 *
 * ── The allowlist, and what is missing from it ──────────────────────────────
 *
 * Every field on this form is editorial — a human decided it. `liveStats` (stars,
 * forks, commits, last push) is **not** on the form, and that is the single most
 * important thing about this file.
 *
 * `packages/convex/convex/labs.ts` states it plainly: `liveStats` is "the slice
 * the hourly cron overwrites from the GitHub API. Everything else on the row is
 * hand-written and must survive the refresh." Phase 4's cron owns it. So:
 *
 *   • `create` is called **without** `liveStats`, which writes zeros with no
 *     `syncedAt` — and that absence is the signal a reader needs: "0 stars, never
 *     synced" is "the cron has not run", not "this repo has no stars".
 *   • `update` is called **without** `liveStats`, so a save from this form cannot
 *     clobber what the cron last wrote. The mutation does accept the block (a
 *     wrong number should be fixable today), but a form that offered it would be a
 *     form whose values silently revert within the hour — which is a worse
 *     experience than not having the fields.
 *
 * They are displayed read-only instead, with the sync time next to them, because
 * "what does the site currently claim about this repo" is a fair question for this
 * screen to answer.
 *
 * ── No ADR 009 flag here, deliberately ─────────────────────────────────────
 *
 * `ImageUpload` is used **without** `requireSanitised`. ADR 009 is about
 * screenshots of client software; a Lab cover is a photo of your own terminal.
 * Leaving the prop off omits the `sanitised` key entirely rather than storing
 * `false` — "not applicable" and "not yet checked" are different facts, and
 * `labs.publish` has no gate precisely because only the second one is a question.
 *
 * ── There is no `/labs/[slug]` on the public site ───────────────────────────
 *
 * Worth knowing before reading the publish panel. `src/app/(site)` has
 * `labs/page.tsx` and nothing under it, so a Lab has no page of its own — the
 * grid is the whole public surface. This form used to link to `/labs/<slug>`,
 * which was a 404 for every Lab, published or not. It now points at `/labs` and
 * says so. `SlugField`'s `prefix="/labs/"` still implies a per-Lab route and is
 * left alone: the slug is a real identifier (it is this admin route's key and the
 * mutation asserts its uniqueness), and the prefix is the right hint for the day
 * that page lands.
 *
 * ── Where the prose that used to be on this screen went ────────────────────
 *
 * Six field hints and the "Cron-owned" notice became `InfoTip`s on the panel
 * headings that own those fields (README §2a). Three things stayed inline because
 * a reader has to act on them: the missing-cover blocker (it is why Save is
 * disabled), the delete warning, and the draft-404 line.
 */

/* ------------------------------------------------------------------ *
 * The draft
 * ------------------------------------------------------------------ */

export type LabDraft = {
  slug: string;
  title: string;
  summary: string;
  /** `owner/name`, GitHub's spelling. The cron's lookup key. */
  repoFullName: string;
  language: string;
  /** Required by the schema — `null` only while a new Lab is being filled in. */
  coverImage: MediaAsset | null;
  /** `links.repo`. Required. */
  repo: string;
  /** `links.live`, `""` = absent. */
  live: string;
  /** `links.docs`, `""` = absent. */
  docs: string;
  featured: boolean;
  /** `null` on create = "put it last". */
  sortOrder: number | null;
};

function blankDraft(): LabDraft {
  return {
    slug: "",
    title: "",
    summary: "",
    repoFullName: "",
    language: "",
    coverImage: null,
    repo: "",
    live: "",
    docs: "",
    featured: false,
    sortOrder: null,
  };
}

/** A stored document → the form's shape. `liveStats` is deliberately not read. */
function draftFromRow(row: Doc<"labs">): LabDraft {
  return {
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    repoFullName: row.repoFullName,
    language: row.language,
    coverImage: row.coverImage,
    repo: row.links.repo,
    live: row.links.live ?? "",
    docs: row.links.docs ?? "",
    featured: row.featured,
    sortOrder: row.sortOrder,
  };
}

/**
 * `owner/name` → the canonical GitHub URL.
 *
 * Used to prefill `links.repo` from `repoFullName` while the repo link is empty.
 * The mutation asserts the two agree (`assertRepoLinkAgrees`) — the cron refreshes
 * numbers from `repoFullName` while a visitor clicks `links.repo`, so a mismatch
 * shows one repo's stars under another repo's link with nothing reporting an
 * error. Prefilling is the cheapest way to make agreement the default.
 */
function repoUrlFor(repoFullName: string): string {
  const trimmed = repoFullName.trim();
  return trimmed.length > 0 ? `https://github.com/${trimmed}` : "";
}

/* ------------------------------------------------------------------ *
 * The form
 * ------------------------------------------------------------------ */

export function LabForm({
  /** The stored document, or `null` to create a new one. */
  row,
}: Readonly<{ row: Doc<"labs"> | null }>) {
  const router = useRouter();

  const create = useMutation(api.labs.create);
  const update = useMutation(api.labs.update);
  const publish = useMutation(api.labs.publish);
  const unpublish = useMutation(api.labs.unpublish);
  const remove = useMutation(api.labs.remove);

  /* Shared by every write that stays on this page, so Save and Publish disable
     each other — publishing reads the stored row, and a save landing mid-publish
     would let request order decide what went public. Delete gets its own so its
     success does not flash "Saved". */
  const write = usePendingAction();
  const destroy = usePendingAction();

  const [form, setForm] = useState(() => {
    const draft = row === null ? blankDraft() : draftFromRow(row);
    return {
      draft,
      savedKey: JSON.stringify(draft),
      expectedRevision: row?.revision ?? 0,
    };
  });
  const { draft, savedKey, expectedRevision } = form;

  const patch = (fields: Partial<LabDraft>) =>
    setForm((current) => ({
      ...current,
      draft: { ...current.draft, ...fields },
    }));

  /* Keep the draft tied to the revision it actually loaded. A newer live row is
     not a safe baseline for fields that still contain the older values. */
  const dirty = row === null || JSON.stringify(draft) !== savedKey;

  /**
   * A Lab must have a cover image.
   *
   * Not client-side validation of a rule the server also holds — it is the shape
   * of the mutation: `coverImage` is a required argument, so with `null` there is
   * no call to make. Disabling Save with a reason is the honest version of that,
   * and it is also why removing the cover of an existing Lab blocks the save
   * rather than silently leaving the old one in place.
   */
  const missingCover = draft.coverImage === null;

  async function submit(): Promise<void> {
    const cover = draft.coverImage;

    if (cover === null) {
      /* Unreachable while the button is disabled; kept because it is also what
         narrows `MediaAsset | null` for the calls below. */
      return;
    }

    const links = {
      repo: draft.repo.trim(),
      ...(draft.live.trim().length > 0 ? { live: draft.live.trim() } : {}),
      ...(draft.docs.trim().length > 0 ? { docs: draft.docs.trim() } : {}),
    };

    if (row === null) {
      /* No `published` and no `liveStats`: a Lab is created as a draft, and the
         stats block is written as zeros with no `syncedAt` for the cron to
         replace. See the file header. */
      const created = await create({
        slug: draft.slug,
        title: draft.title,
        summary: draft.summary,
        repoFullName: draft.repoFullName,
        language: draft.language,
        coverImage: cover,
        links,
        featured: draft.featured,
        ...(draft.sortOrder !== null ? { sortOrder: draft.sortOrder } : {}),
      });

      router.replace(`/admin/labs/${created.slug}`);
      return;
    }

    /* Every editorial field, every time — the request describes the document as
       the person editing it believes it to be, with no diff to keep in step. There
       is nothing to clear with `null` on this table: every field except the two
       optional timestamps inside `liveStats` is required by `LabSchema`. */
    const saved = await update({
      labId: row._id,
      expectedRevision,
      slug: draft.slug,
      title: draft.title,
      summary: draft.summary,
      repoFullName: draft.repoFullName,
      language: draft.language,
      coverImage: cover,
      links,
      featured: draft.featured,
      ...(draft.sortOrder !== null ? { sortOrder: draft.sortOrder } : {}),
    });

    setForm((current) => ({
      ...current,
      savedKey: JSON.stringify(draft),
      expectedRevision: saved.revision,
    }));

    if (saved.slug !== row.slug) {
      router.replace(`/admin/labs/${saved.slug}`);
    }
  }

  async function setPublished(next: boolean): Promise<unknown> {
    if (row === null) return;

    const result = next
      ? await publish({ labId: row._id, expectedRevision })
      : await unpublish({ labId: row._id, expectedRevision });

    setForm((current) => ({
      ...current,
      expectedRevision: result.revision,
    }));

    return result;
  }

  return (
    <AdminForm>
      {/* ── Identity ─────────────────────────────────────────────────── */}

      {/* As in `ProjectForm`: each panel's explanation goes in `AdminPanel`'s
          `info` prop, rendered beside the title — `headerEnd` carries the
          `StatusBadge` only, never a tip. */}
      <AdminPanel
        title="Identity"
        info={
          <>
            <strong>Summary</strong> is the card copy and the meta description.{" "}
            <strong>Repo</strong> is GitHub&rsquo;s own <code>owner/name</code>{" "}
            and is unique across Labs — it is the hourly cron&rsquo;s lookup
            key, so two rows naming one repo would both be refreshed from it.{" "}
            <strong>Language</strong> is GitHub&rsquo;s primary-language label,
            rendered as a badge, so it is content rather than a lookup.
          </>
        }
        infoLabel="About a Lab's identity fields"
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
            placeholder="Horizon"
            maxLength={160}
            required
          />

          <SlugField
            value={draft.slug}
            onValueChange={(slug) => patch({ slug })}
            source={draft.title}
            prefix="/labs/"
            published={row?.published ?? false}
            required
          />

          <TextAreaField
            label="Summary"
            value={draft.summary}
            onValueChange={(summary) => patch({ summary })}
            placeholder="One or two sentences on what it is and why it exists."
            maxLength={400}
            rows={3}
            required
          />

          <FieldRow>
            <TextField
              label="Repo"
              value={draft.repoFullName}
              onValueChange={(repoFullName) =>
                patch({
                  repoFullName,
                  /* Prefill the link while it is still the derived value or
                     empty. Once it has been edited by hand it is left alone —
                     a Lab may legitimately link a GitLab mirror. */
                  ...(draft.repo === "" ||
                  draft.repo === repoUrlFor(draft.repoFullName)
                    ? { repo: repoUrlFor(repoFullName) }
                    : {}),
                })
              }
              placeholder="coreybaines/horizon"
              maxLength={140}
              required
              /* Kept inline, short: the spelling has to match GitHub's exactly or
                 the cron looks up the wrong repo, and the placeholder alone does
                 not say that the case matters. */
              hint="Exactly as GitHub spells it."
            />
            <TextField
              label="Language"
              value={draft.language}
              onValueChange={(language) => patch({ language })}
              placeholder="TypeScript"
              maxLength={60}
              required
            />
          </FieldRow>
        </AdminForm>
      </AdminPanel>

      {/* ── Links ────────────────────────────────────────────────────── */}

      <AdminPanel
        title="Links"
        info={
          <>
            The repository URL is required — a Lab without a repo is a case study.
            It is prefilled from the repo field above and left alone once you edit
            it by hand, since a Lab may legitimately link a GitLab mirror; when it
            <em> is</em> a github.com URL the mutation asserts it names the same{" "}
            <code>owner/name</code>, because the cron refreshes numbers from one
            and a visitor clicks the other.
          </>
        }
        infoLabel="About the Lab's links"
      >
        <AdminForm>
          <TextField
            label="Repository URL"
            value={draft.repo}
            onValueChange={(repo) => patch({ repo })}
            type="url"
            placeholder="https://github.com/coreybaines/horizon"
            required
          />

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
              label="Docs URL"
              value={draft.docs}
              onValueChange={(docs) => patch({ docs })}
              type="url"
              placeholder="https://example.com/docs"
              optional
            />
          </FieldRow>
        </AdminForm>
      </AdminPanel>

      {/* ── Cover ────────────────────────────────────────────────────── */}

      <AdminPanel
        title="Cover image"
        info={
          <>
            Rendered on the <code>/labs</code> grid. There is no sanitised
            checkbox here on purpose: ADR 009 is about screenshots of client
            software, so the flag is omitted rather than stored as{" "}
            <code>false</code> — &ldquo;not applicable&rdquo; and &ldquo;not yet
            checked&rdquo; are different facts, and <code>labs.publish</code> has
            no gate.
          </>
        }
        infoLabel="About the Lab cover"
      >
        <AdminForm>
          {/* Stays inline and loud: this is the reason the Save button is
              disabled, which is judgement text by README §2a. */}
          {missingCover ? (
            <AdminNotice tone="warn" title="A Lab needs a cover">
              <code>coverImage</code> is required by the schema, deliberately:
              Labs and Fun entries are the site&rsquo;s main image source outside
              the case studies. Saving is disabled until one is here.
            </AdminNotice>
          ) : null}

          {/* No `requireSanitised` — see the file header. */}
          <ImageUpload
            label="Cover"
            value={draft.coverImage}
            onValueChange={(coverImage) => patch({ coverImage })}
          />
        </AdminForm>
      </AdminPanel>

      {/* ── Presentation ─────────────────────────────────────────────── */}

      <AdminPanel
        title="Presentation"
        info={
          <>
            Sort order is what <code>/labs</code> renders in; the list
            screen&rsquo;s arrows renumber everything densely and are the easier
            way to change it. Featuring a draft is allowed and does nothing until
            the Lab is published.
          </>
        }
        infoLabel="About a Lab's presentation fields"
      >
        <AdminForm>
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

      {/* ── liveStats — read-only ────────────────────────────────────── */}

      {/* The "Cron-owned — not editable here" notice is now this panel's tip.
          It reads as an exception to §2a and is not one: the panel has no
          controls, so there is nothing here a reader can get wrong. The notice
          was explaining an *absence* — why five values are printed rather than
          offered — and the panel already demonstrates that by having no inputs
          in it. What the tip adds is the reason, for whoever comes looking. */}
      <AdminPanel
        title="GitHub stats"
        info={
          <>
            Cron-owned, and read-only for that reason. The hourly git cron (build
            phase 4) overwrites this whole block from the GitHub API, keyed on{" "}
            <code>{draft.repoFullName || "owner/name"}</code>; everything else on
            this form is hand-written and survives the refresh. A value edited by
            hand would not — it would last until the next tick — so these are
            shown rather than offered. A new Lab starts at zero with no sync time,
            which is how a reader tells &ldquo;not synced yet&rdquo; from &ldquo;no
            stars&rdquo;.
          </>
        }
        infoLabel="About the GitHub stats block"
      >
        <AdminForm>
          {row === null ? (
            <p className="adm-micro">
              Nothing to show yet — the block is written when the Lab is created.
            </p>
          ) : (
            /* Laid out with the form's own two classes — a label and a
               tabular-figures value per cell — rather than a `<dl>`: `admin.css`
               belongs to the kit and styles no description list, and a `<dd>`
               carries a 40px indent by default that would have to be undone with
               an inline style on every row. */
            <div className="adm-row">
              <div className="adm-field">
                <p className="adm-label">Stars</p>
                <p className="adm-mono">{row.liveStats.stars}</p>
              </div>
              <div className="adm-field">
                <p className="adm-label">Forks</p>
                <p className="adm-mono">{row.liveStats.forks}</p>
              </div>
              <div className="adm-field">
                <p className="adm-label">Commits, 12 months</p>
                <p className="adm-mono">{row.liveStats.commitsYear}</p>
              </div>
              <div className="adm-field">
                <p className="adm-label">Last push</p>
                <p className="adm-mono">
                  {/* `lastPushedAt` is the durable fact; `lastPushDaysAgo` is a
                      precomputed display value that only means anything relative
                      to the snapshot's `computedAt`, so the absolute one wins
                      whenever it exists. */}
                  {row.liveStats.lastPushedAt
                    ? formatInstant(row.liveStats.lastPushedAt)
                    : `${row.liveStats.lastPushDaysAgo} days ago`}
                </p>
              </div>
              <div className="adm-field">
                <p className="adm-label">Synced</p>
                <p className="adm-mono">
                  {/* No `syncedAt` is the cron's "has not run" signal, so it is
                      said in those words rather than shown as an em dash. */}
                  {row.liveStats.syncedAt
                    ? formatInstant(row.liveStats.syncedAt)
                    : "never — cron has not run"}
                </p>
              </div>
            </div>
          )}
        </AdminForm>
      </AdminPanel>

      {/* ── Save ─────────────────────────────────────────────────────── */}

      {/* Not a panel any more — same reasoning as `ProjectForm`: a border and two
          paddings around one button and a sentence restating the button's own
          enabled state. */}
      <AdminButtonRow>
        <SaveButton
          action={write}
          onAction={submit}
          label={row === null ? "Create draft" : "Save"}
          dirty={dirty}
          disabled={missingCover}
          title={
            missingCover
              ? "A Lab needs a cover image before it can be saved."
              : undefined
          }
        />

        <span className="adm-micro">
          {row === null
            ? "Nothing is written until you press Create, and a new Lab is always a draft — publishing is a separate step on the next screen."
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
                There is no media gate on a Lab — ADR 009 is about screenshots
                of client software, and a Lab cover is not one. Unpublishing is
                immediate and keeps the sort order and the featured flag, so
                re-publishing puts the Lab back where it was.
              </>
            }
            infoLabel="About publishing a Lab"
            headerEnd={<StatusBadge published={row.published} />}
          >
            <AdminForm>
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
                    onAction={() => setPublished(false)}
                    pendingLabel="Withdrawing…"
                  >
                    Unpublish
                  </ActionButton>
                ) : (
                  <ActionButton
                    action={write}
                    variant="primary"
                    onAction={() => setPublished(true)}
                    pendingLabel="Publishing…"
                  >
                    Publish
                  </ActionButton>
                )}

                {/* Was a hand-rolled `<a>` to `/labs/<slug>`, which is a 404 —
                    that route does not exist (see the file header). `/labs` is
                    the Lab's public home, and `published` gets the honest
                    "Draft — not public yet" state for a draft, which would not
                    appear in the grid. */}
                <ViewOnSite
                  href="/labs"
                  published={row.published}
                  label="View on Labs"
                />
              </AdminButtonRow>

              {/* Kept inline, and only while it applies — the answer to "why is
                  my URL 404ing" is a zero-state notice, not a tooltip. */}
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
                There is no undo and no trash. The cover image stays on the CDN as
                an orphan (a Convex mutation cannot reach UploadThing), and the
                repo becomes available for another Lab to claim.{" "}
                <strong>Unpublish instead</strong> if the intent is just to take it
                off the site.
              </AdminNotice>

              <AdminButtonRow>
                <DeleteButton
                  action={destroy}
                  name={row.title}
                  size="md"
                  onAction={async () => {
                    await remove({
                      labId: row._id,
                      expectedRevision,
                    });
                    router.replace("/admin/labs");
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
