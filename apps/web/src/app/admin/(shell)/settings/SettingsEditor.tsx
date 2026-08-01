"use client";

import { api } from "@home/convex/api";
import type { Doc } from "@home/convex/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import {
  AdminButtonRow,
  AdminForm,
  AdminNotice,
  AdminPanel,
  FieldRow,
  SaveButton,
  TextAreaField,
  TextField,
  ToggleField,
  formatInstant,
  usePendingAction,
  type PendingAction,
} from "@/components/admin";
import { linesToList, listToLines } from "@/components/admin/profile/lines";

/**
 * The `siteSettings` singleton, as one form.
 *
 * ── Singleton, and therefore `upsert` ───────────────────────────────────────
 *
 * `siteSettings.get` returns one document or `null`, and there is no `create`/
 * `update` pair — the write is `siteSettings.upsert`, a **whole-record** write. So
 * this screen holds every field, always sends every field, and the Save button is
 * "Create site settings" until a row exists. That is the backend's design rather
 * than this screen's convenience: with optional arguments, "the caller omitted
 * `nav`" and "the caller wants `nav` unchanged" would be the same request.
 *
 * The consequence to know: **a field left blank here is saved as blank.** There is
 * no partial save and no merge with what is already stored.
 *
 * ── `availability` is stored twice and this form must not know that ──────────
 *
 * The row carries `availability` at the top level *and* inside `identity`, as the
 * same string (schema.ts and `SiteSettingsSchema` both explain the inherited
 * duplication). The resolution is that `siteSettings.upsert` and
 * `siteSettings.setAvailability` are the only writers and both derive the top-level
 * copy from `identity.availability`. So there is deliberately **one** field on this
 * form, and `upsert` has no top-level `availability` argument to send it to. Do not
 * add one.
 *
 * ── The draft does not follow the document ──────────────────────────────────
 *
 * The form seeds itself from the first resolved read and then stops listening. A
 * Convex subscription pushes changes live, and re-seeding on every push would
 * delete whatever was being typed the moment the iOS app changed the availability
 * line. The cost is that an edit made elsewhere while this form is open is not
 * visible here until a reload. The form retains the revision it loaded, so a save
 * after that change is rejected as stale instead of overwriting it; the existing
 * Save button error is the prompt to reload and reconcile.
 */

/* ------------------------------------------------------------------ *
 * Draft
 * ------------------------------------------------------------------ */

/**
 * The form's state.
 *
 * Two shape differences from the stored document, both because a text input holds
 * a string and nothing else:
 *
 *   • `identity.x` is `""` for absent. The stored field is `v.optional()`, so the
 *     key is omitted rather than written empty on save — an empty string would be
 *     a link to nowhere on the public site, and `assertUrl` would refuse it.
 *   • the three `featured.*Slugs` are newline-delimited text, converted by
 *     `linesToList` on save.
 */
type Draft = {
  headline: string;
  availabilityVisible: boolean;
  identity: {
    name: string;
    role: string;
    company: string;
    location: string;
    availability: string;
    github: string;
    linkedin: string;
    x: string;
    email: string;
  };
  featured: { projectSlugs: string; labSlugs: string; postSlugs: string };
  nav: {
    work: boolean;
    labs: boolean;
    blog: boolean;
    fun: boolean;
    resume: boolean;
    ask: boolean;
    contact: boolean;
  };
};

/**
 * What a site with no settings row starts from.
 *
 * Every string is empty on purpose — inventing a name and a headline here would
 * put placeholder copy on the public homepage the moment someone pressed Save to
 * see what happened. The nav flags are the exception, because a nav with
 * everything off is not a plausible starting point: `blog: false` is ADR 018 (the
 * writing section ships hidden), everything else is on.
 */
const EMPTY_DRAFT: Draft = {
  headline: "",
  availabilityVisible: true,
  identity: {
    name: "",
    role: "",
    company: "",
    location: "",
    availability: "",
    github: "",
    linkedin: "",
    x: "",
    email: "",
  },
  featured: { projectSlugs: "", labSlugs: "", postSlugs: "" },
  nav: {
    work: true,
    labs: true,
    blog: false,
    fun: true,
    resume: true,
    ask: true,
    contact: true,
  },
};

function draftFrom(stored: Doc<"siteSettings"> | null): Draft {
  if (stored === null) {
    return EMPTY_DRAFT;
  }

  return {
    headline: stored.headline,
    availabilityVisible: stored.availabilityVisible ?? true,
    identity: {
      name: stored.identity.name,
      role: stored.identity.role,
      company: stored.identity.company,
      location: stored.identity.location,
      /* From `identity`, not from the top-level copy. They are always equal — see
         the file header — and reading the one `upsert` writes from keeps that
         obvious. */
      availability: stored.identity.availability,
      github: stored.identity.github,
      linkedin: stored.identity.linkedin,
      x: stored.identity.x ?? "",
      email: stored.identity.email,
    },
    featured: {
      projectSlugs: listToLines(stored.featured.projectSlugs),
      labSlugs: listToLines(stored.featured.labSlugs),
      postSlugs: listToLines(stored.featured.postSlugs),
    },
    nav: {
      work: stored.nav.work,
      labs: stored.nav.labs,
      blog: stored.nav.blog,
      fun: stored.nav.fun,
      resume: stored.nav.resume,
      ask: stored.nav.ask,
      contact: stored.nav.contact,
    },
  };
}

/**
 * The routes of `navVisibility` that still have a key in the public nav, in the
 * order it renders them.
 *
 * Enumerated rather than iterated over the object's keys, because the *labels* and
 * the routes are the information — a `Object.entries(draft.nav)` loop would render
 * `fun` as "fun" and leave the reader to guess which page that is. Adding a route
 * to the schema without adding a line here is a typecheck failure at `NAV_ITEMS`'
 * `satisfies`.
 *
 * ⚠️ `nav.ask` is deliberately **absent**, and its absence is not a bug to fix by
 * adding the row back. Ask Corey stopped being a route: it is a launcher fixed to
 * the bottom-right of every public page, mounted in the `(site)` layout, and it
 * has no nav key left to hide. The field stays in the schema and keeps
 * round-tripping through `draftFrom`/`upsert` untouched — it is stored data and
 * deleting stored data to tidy a form is how a rollback becomes a migration — but
 * a toggle that controls nothing is worse than no toggle, so it is not offered.
 */
const NAV_ITEMS = [
  { key: "work", label: "Work", route: "/work" },
  { key: "labs", label: "Labs", route: "/labs" },
  { key: "blog", label: "Writing", route: "/blog" },
  { key: "fun", label: "Fun", route: "/fun" },
  { key: "resume", label: "Résumé", route: "/resume" },
  { key: "contact", label: "Contact", route: "/contact" },
] as const satisfies readonly { key: keyof Draft["nav"]; label: string; route: string }[];

/* ------------------------------------------------------------------ *
 * Screen
 * ------------------------------------------------------------------ */

export function SettingsEditor() {
  const settings = useQuery(api.siteSettings.get, {});

  if (settings === undefined) {
    return (
      <p className="adm-micro" role="status">
        Loading settings…
      </p>
    );
  }

  /*
   * The form is a separate component so that its draft can be seeded by
   * `useState`'s lazy initialiser instead of by an effect. That is not a style
   * preference: seeding in an effect means a setState in an effect body, which
   * `react-hooks/set-state-in-effect` refuses (cascading renders), and the
   * work-arounds are all worse than moving the mount one level down.
   *
   * There is deliberately **no `key`** on it. A `key={settings?._id}` would remount
   * the form — and discard what was being typed — the first time a live push
   * arrived. Not following the document is the intended behaviour; see the file
   * header.
   */
  return <SettingsForm initial={settings} />;
}

function SettingsForm({ initial }: { initial: Doc<"siteSettings"> | null }) {
  const upsert = useMutation(api.siteSettings.upsert);
  const write = usePendingAction();

  /**
   * The draft, plus the copy of it as last saved — which is what makes
   * the Save button's `dirty` honest. A field-by-field comparison against the
   * document would need one branch per field and would still miss the two shape
   * conversions; comparing the draft to a snapshot of itself needs neither.
   *
   * One `useState` rather than two so the pair cannot be updated out of step, and a
   * lazy initialiser so `draftFrom` runs exactly once.
   */
  const [state, setState] = useState(() => {
    const draft = draftFrom(initial);
    return {
      draft,
      savedDraft: draft,
      expectedRevision: initial?.revision ?? 0,
    };
  });

  const { draft, savedDraft, expectedRevision } = state;
  const setDraft = (next: Draft) =>
    setState((current) => ({ ...current, draft: next }));

  const dirty = JSON.stringify(savedDraft) !== JSON.stringify(draft);

  /** Narrow, typed field updaters. Each one replaces its nested object. */
  const setIdentity = <K extends keyof Draft["identity"]>(
    key: K,
    value: Draft["identity"][K],
  ) => setDraft({ ...draft, identity: { ...draft.identity, [key]: value } });

  const setFeatured = <K extends keyof Draft["featured"]>(key: K, value: string) =>
    setDraft({ ...draft, featured: { ...draft.featured, [key]: value } });

  const setNav = (key: keyof Draft["nav"], value: boolean) =>
    setDraft({ ...draft, nav: { ...draft.nav, [key]: value } });

  const save = async () => {
    /* `x` is destructured out so that a blank one is *absent* rather than `""`.
       `assertUrl` refuses an empty string, and a stored empty string would render
       as a social link to nowhere. */
    const { x, ...identity } = draft.identity;

    const result = await upsert({
      expectedRevision,
      headline: draft.headline,
      availabilityVisible: draft.availabilityVisible,
      identity: {
        ...identity,
        ...(x.trim().length > 0 ? { x: x.trim() } : {}),
      },
      featured: {
        projectSlugs: linesToList(draft.featured.projectSlugs),
        labSlugs: linesToList(draft.featured.labSlugs),
        postSlugs: linesToList(draft.featured.postSlugs),
      },
      nav: draft.nav,
    });

    /* The draft is now what is stored, so the button goes clean. Snapshotting the
       draft rather than re-reading the document keeps this correct even though the
       subscription has not pushed yet. */
    setState((current) => ({
      ...current,
      savedDraft: draft,
      expectedRevision: result.revision,
    }));
  };

  return (
    <>
      {initial === null ? (
        <AdminNotice tone="warn" title="No settings row exists yet">
          The public site cannot render live content until this row exists. Saving
          this form creates it — every field below is written, including the blank
          ones.
        </AdminNotice>
      ) : null}

      <AvailabilityPanel
        value={draft.identity.availability}
        onValueChange={(value) => setIdentity("availability", value)}
        visible={draft.availabilityVisible}
        onVisibleChange={(availabilityVisible) =>
          setDraft({ ...draft, availabilityVisible })
        }
        settingsExist={initial !== null}
        expectedRevision={expectedRevision}
        action={write}
        onSaved={(submitted, submittedVisible, availability, availabilityVisible, revision) =>
          setState((current) => {
            const draftStillMatches =
              current.draft.identity.availability === submitted &&
              current.draft.availabilityVisible === submittedVisible;
            return {
              ...current,
              draft: draftStillMatches
                ? {
                    ...current.draft,
                    availabilityVisible,
                    identity: { ...current.draft.identity, availability },
                  }
                : current.draft,
              savedDraft: {
                ...current.savedDraft,
                availabilityVisible,
                identity: { ...current.savedDraft.identity, availability },
              },
              expectedRevision: revision,
            };
          })
        }
      />

      {/*
        ── One Identity block, not two ──────────────────────────────────────────
        Identity and Links were separate panels, and the split did not match
        anything: `siteSettings.identity` is a single object holding the name, the
        role, the company, the location *and* the four contact links, so two
        bordered boxes were drawing a line the data does not have. They are one
        panel now, with the links as their own labelled sub-row — grouping by
        heading rather than by border, which is a border and ~40px less on a screen
        that has five panels.

        The tooltip carries what four field hints used to say, plus the whole-record
        rule that used to be in the page description. What is left under a field is
        only what its value is refused for.
      */}
      <AdminPanel
        title="Identity"
        info={
          <>
            The headline is the hero line on the homepage, not the page title. This
            is a whole-record write, so <strong>a field left blank here is saved
            blank</strong> — there is no partial save and no merge with what is
            stored. The GitHub value is a bare username because every repo link and
            the git-stats cron are built from it; a pasted profile URL breaks the
            ingest rather than merely looking wrong.
          </>
        }
        infoLabel="About the identity fields"
      >
        <AdminForm>
          <TextField
            label="Headline"
            value={draft.headline}
            onValueChange={(value) => setDraft({ ...draft, headline: value })}
            required
            maxLength={180}
            placeholder="Principal engineer, Sydney"
          />

          <FieldRow>
            <TextField
              label="Name"
              value={draft.identity.name}
              onValueChange={(value) => setIdentity("name", value)}
              required
              maxLength={120}
              autoComplete="off"
            />
            <TextField
              label="Role"
              value={draft.identity.role}
              onValueChange={(value) => setIdentity("role", value)}
              required
              maxLength={120}
              placeholder="Principal Engineer"
            />
          </FieldRow>

          <FieldRow>
            <TextField
              label="Company"
              value={draft.identity.company}
              onValueChange={(value) => setIdentity("company", value)}
              required
              maxLength={160}
            />
            <TextField
              label="Location"
              value={draft.identity.location}
              onValueChange={(value) => setIdentity("location", value)}
              required
              maxLength={160}
            />
          </FieldRow>

          {/* The links, as a labelled group rather than a second panel. An
              `.adm-eyebrow` is the admin's smallest heading and needs no new
              class; it is not an `<h3>` because it labels a row of fields that
              already have labels, and a heading level here would insert a rung
              into the page outline that means nothing. */}
          <p className="adm-eyebrow">Links</p>

          <FieldRow>
            <TextField
              label="GitHub username"
              value={draft.identity.github}
              onValueChange={(value) => setIdentity("github", value)}
              required
              /* 39 is GitHub's own username limit. The *shape* rule stays inline
                 rather than moving into the tooltip because `siteSettings.upsert`
                 refuses a value containing `/` or `:` — a hint that predicts a
                 rejection is validation, and the kit keeps validation visible. */
              maxLength={39}
              hint="A bare username, not a URL."
            />
            <TextField
              label="Email"
              type="email"
              value={draft.identity.email}
              onValueChange={(value) => setIdentity("email", value)}
              required
              maxLength={254}
            />
          </FieldRow>

          <FieldRow>
            <TextField
              label="LinkedIn"
              type="url"
              value={draft.identity.linkedin}
              onValueChange={(value) => setIdentity("linkedin", value)}
              required
              hint="Full URL, including https://."
            />
            <TextField
              label="X"
              type="url"
              value={draft.identity.x}
              onValueChange={(value) => setIdentity("x", value)}
              optional
              /* Also a refusal rather than a preference: `assertUrl` rejects an
                 empty string, so this field is *omitted* when blank rather than
                 stored empty. Worth a reader knowing before they clear it. */
              hint="Blank means the field is omitted and no link is rendered."
            />
          </FieldRow>
        </AdminForm>
      </AdminPanel>

      {/* The `AdminNotice` that used to open this panel is now the tooltip. It was
          a four-line `info` notice — the tone the kit reserves for "worth knowing"
          — restating a rule that has never once bitten anyone, above the seven
          controls it was about. Nothing here is irreversible or hidden, which is
          the test §2a sets, so the box goes and the icon stays. */}
      <AdminPanel
        title="Navigation"
        info={
          <>
            These hide <em>links</em>, not routes: a hidden section still resolves
            for anyone with the URL, so this is curation and never access control.
            Writing ships hidden by ADR 018 — turn it on when there is something
            worth linking to. <code>/</code> and <code>/admin</code> are absent
            because one is always shown and the other never is.
          </>
        }
        infoLabel="About the navigation flags"
        headerEnd={
          <span className="adm-eyebrow">
            {NAV_ITEMS.filter((item) => draft.nav[item.key]).length} of{" "}
            {NAV_ITEMS.length} shown
          </span>
        }
      >
        <div className="adm-form">
          {NAV_ITEMS.map((item) => (
            <ToggleField
              key={item.key}
              label={item.label}
              checked={draft.nav[item.key]}
              onCheckedChange={(checked) => setNav(item.key, checked)}
              /* Every row now says the same kind of thing — the route it
                 controls. The ADR-018 sentence that used to hang off `blog` alone
                 made one row three lines tall and the other six one, which read as
                 a warning about that route rather than as an explanation of the
                 default; it is in the panel's tooltip with the rest of the model.
                 A tooltip cannot go *here*: `ToggleField` renders its description
                 inside the `<label>`, and a `<button>` in there is both invalid
                 HTML and a second thing for a label click to hit. */
              description={<code>{item.route}</code>}
            />
          ))}
        </div>
      </AdminPanel>

      <AdminPanel
        title="Featured on the homepage"
        info={
          <>
            One slug per line, in render order. Slugs are format-checked but
            <strong> not</strong> existence-checked, deliberately — the homepage can
            be curated before the content is written, and a slug that resolves to
            nothing simply is not featured yet.
          </>
        }
        infoLabel="About featured slugs"
      >
        <div className="adm-form">
          <TextAreaField
            label="Case study slugs"
            value={draft.featured.projectSlugs}
            onValueChange={(value) => setFeatured("projectSlugs", value)}
            rows={4}
            mono
            optional
            placeholder={"quotecloud\nascender-payroll"}
          />
          <TextAreaField
            label="Lab slugs"
            value={draft.featured.labSlugs}
            onValueChange={(value) => setFeatured("labSlugs", value)}
            rows={4}
            mono
            optional
          />
          <TextAreaField
            label="Post slugs"
            value={draft.featured.postSlugs}
            onValueChange={(value) => setFeatured("postSlugs", value)}
            rows={4}
            mono
            optional
          />
        </div>
      </AdminPanel>

      <AdminPanel
        footer={
          <AdminButtonRow>
            <SaveButton
              action={write}
              label={initial === null ? "Create site settings" : "Save settings"}
              dirty={dirty}
              onAction={save}
            />
          </AdminButtonRow>
        }
      >
        <dl className="adm-status">
          <div>
            <dt>last saved</dt>
            <dd>
              {initial === null ? "never" : formatInstant(initial.updatedAt)}
            </dd>
          </div>
          <div>
            <dt>unsaved</dt>
            <dd data-ok={dirty ? undefined : "true"}>
              {dirty ? "yes — this form has changes" : "no"}
            </dd>
          </div>
        </dl>

        {/* Stays inline: this is the one way to lose someone else's edit from this
            screen, and a way to lose data cannot be behind a hover. Two sentences
            rather than three. */}
        <p className="adm-micro" style={{ marginTop: "0.7rem" }}>
          This form does not follow live changes. If it was edited from the phone
          since loading, Save refuses the stale draft — reload before trying again.
        </p>
      </AdminPanel>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * The availability quick-save
 * ------------------------------------------------------------------ */

/**
 * The availability line, savable on its own.
 *
 * `siteSettings.setAvailability` exists for exactly this: it is the single most
 * load-bearing string on the site, the one that goes stale in a way that costs
 * something, and "I just accepted an offer, take the banner down" should not be a
 * round trip through a form that also wants a nav configuration. It writes both
 * copies of the field, like `upsert`.
 *
 * It refuses when there is no settings row — creating the singleton from a
 * one-field mutation would leave every other field to be invented — so the button
 * is disabled and explained in that state rather than left to fail.
 *
 * The field is the *same* draft value the Identity panel would have held, so the
 * two cannot disagree; it is lifted up here because this panel is at the top of the
 * screen and the identity block is not.
 */
function AvailabilityPanel({
  value,
  onValueChange,
  visible,
  onVisibleChange,
  settingsExist,
  expectedRevision,
  action,
  onSaved,
}: {
  value: string;
  onValueChange: (value: string) => void;
  visible: boolean;
  onVisibleChange: (visible: boolean) => void;
  settingsExist: boolean;
  expectedRevision: number;
  action: PendingAction;
  onSaved: (
    submitted: string,
    submittedVisible: boolean,
    availability: string,
    availabilityVisible: boolean,
    revision: number,
  ) => void;
}) {
  const setAvailability = useMutation(api.siteSettings.setAvailability);

  return (
    <AdminPanel
      title="Availability"
      info={
        <>
          The hiring signal, rendered on the homepage, <code>/contact</code>, the
          résumé and the generated PDF. Its wording stays stored when visibility is
          switched off, so publishing or removing the signal is one focused save
          rather than a trip through the rest of the site configuration.
        </>
      }
      infoLabel="About the availability line"
    >
      <AdminForm>
        <TextField
          label="Availability line"
          value={value}
          onValueChange={onValueChange}
          required
          maxLength={200}
          placeholder="Open to Principal Engineer roles"
        />

        <ToggleField
          label="Show availability across the public site"
          checked={visible}
          onCheckedChange={onVisibleChange}
          description="Switch this off to hide the hiring signal without deleting its wording."
        />

        <AdminButtonRow>
          <SaveButton
            action={action}
            label="Save availability only"
            size="sm"
            disabled={!settingsExist}
            title={
              settingsExist
                ? undefined
                : "There is no settings row yet — use “Create site settings” at the bottom first."
            }
            onAction={async () => {
              const result = await setAvailability({
                availability: value,
                availabilityVisible: visible,
                expectedRevision,
              });
              onSaved(
                value,
                visible,
                result.availability,
                result.availabilityVisible,
                result.revision,
              );
              return result;
            }}
          />
          {/* Why the button is dead, said out loud rather than only in a `title`.
              `setAvailability` refuses when there is no row to patch, and a
              disabled control whose explanation is hover-only is the pattern this
              pass is removing — a `title` is not reachable by keyboard or touch. */}
          {settingsExist ? null : (
            <span className="adm-btn-note">
              No settings row yet — create one at the bottom of this page first.
            </span>
          )}
        </AdminButtonRow>
      </AdminForm>
    </AdminPanel>
  );
}
