# The admin kit

Shared components for every screen under `/admin`. Import from the barrel:

```tsx
import { AdminPage, AdminPageHeader, ConvexGate, EntityTable } from "@/components/admin";
```

Two files are not in the barrel because only one caller each should ever touch
them: `DashboardGrid.tsx` (the `/admin` overview) and `uploadthing.ts` (used by
`ImageUpload`).

> **Nothing under `src/app/(site)` may import from this directory.** The kit pulls
> in `@clerk/nextjs`, `convex/react` and `@uploadthing/react`. Those three are
> ~76 KB gzip in whatever route's client graph they land in, against a < 100 KB
> homepage budget that phase 3 enforces in CI — which is the entire reason
> `ConvexClientProvider` was moved out of the root layout and into
> `src/app/admin/layout.tsx`. See the docblock in `src/app/layout.tsx`.

---

## 1. Where a page file goes

```
src/app/admin/
  layout.tsx                  ConvexClientProvider + ThemeScope + admin.css   ← the only mount
  admin.css                   every .adm-* class in the kit
  sign-in/[[...rest]]/        Clerk <SignIn />. Outside (shell) so it renders signed-out.
  (shell)/
    layout.tsx                the auth gate + sidebar + topbar
    page.tsx                  /admin           (the dashboard)
    projects/page.tsx         /admin/projects  ← your screen goes here
    projects/[id]/page.tsx    /admin/projects/<id>
```

`(shell)` is a route group: the parentheses contribute nothing to the URL. A page
at `src/app/admin/projects/page.tsx` (outside the group) still resolves to
`/admin/projects` but **silently skips the auth gate and renders with no
sidebar**. If your screen appears bare, that is why.

Add your section to `sections.ts` — it drives the sidebar link, the dashboard
card and the topbar breadcrumb from one place. The nine sections already exist;
their `href`s are the routes you must create.

---

## 2. The composition every screen uses

Page furniture **outside** the Convex gate, hooks **inside** it:

```tsx
// src/app/admin/(shell)/projects/page.tsx   (server component)
import { AdminPage, AdminPageHeader, ConvexGate, ViewOnSite } from "@/components/admin";
import { ProjectsTable } from "./ProjectsTable";   // "use client"

export const metadata = { title: "Case studies — admin" };

export default function ProjectsPage() {
  return (
    <AdminPage>
      <AdminPageHeader
        eyebrow="Content"
        title="Case studies"
        info="Publishing is blocked until every image is marked sanitised (ADR 009)."
        actions={
          <>
            <ViewOnSite href="/work" />
            <Link href="/admin/projects/new" className="adm-btn" data-variant="primary">New</Link>
          </>
        }
      />

      <ConvexGate>
        <ProjectsTable />
      </ConvexGate>
    </AdminPage>
  );
}
```

And a detail screen, which adds `back`:

```tsx
// src/app/admin/(shell)/projects/[slug]/page.tsx
<AdminPageHeader
  eyebrow="Content"
  title={title}
  info="Editing media on a published case study is also gated on ADR 009."
  back={{ href: "/admin/projects", label: "Case studies" }}
  actions={<ViewOnSite href={`/work/${slug}`} published={published} />}
/>
```

Why that order: the header renders on a deployment with no Convex and no Clerk,
so a zero-env clone shows a page with a title and working navigation instead of a
blank rectangle. That is a hard requirement — the repo must build and render with
**zero** environment variables set.

### `<ConvexGate>` is mandatory around every hook

If a component calls `useQuery` or `useMutation`, a `<ConvexGate>` must be above
it. It guards two separate crashes:

1. **No client at all.** With no `NEXT_PUBLIC_CONVEX_URL` /
   `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `ConvexClientProvider` mounts no
   provider, and `useQuery` throws for want of a client. Hooks cannot be called
   conditionally, so the only fix is to not mount the component — which is what
   the gate does.
2. **A client that is not authenticated yet.** Nearly every admin query is
   admin-only and throws `ConvexError({ code: 'unauthenticated' })` without an
   identity. The `(shell)` layout proved there is a server-side session, but the
   browser's Convex client fetches its Clerk JWT *asynchronously*; a query issued
   in that window throws. The gate wraps children in Convex's `<Authenticated>`,
   and handles `<AuthLoading>` and `<Unauthenticated>` too.

`useConvexReady()` / `CONVEX_READY` exist for the cases where you need the answer
without changing structure (a disabled button, a status line). Never use them to
decide whether to *call* a hook.

---

## 2a. Compact headers: what goes in a tooltip and what stays on the page

The admin used to print two or three sentences under every page title and a hint
under every field. All of it was true, and it cost 60–80px above the fold on every
screen to say something that the one person who uses the admin reads once. That
prose now lives behind an `InfoTip` — a circled "i" beside the title whose content
is in the accessible description, so it is one keystroke (or one hover) away
rather than permanently in the way.

**The test is not length, it is whether the reader has to act on it.**

| | Goes in `info` / an `InfoTip` | Stays inline and loud |
| --- | --- | --- |
| What it is | *Chrome* — what this screen edits, where the data comes from, which cron touches it, which ADR governs it | *Judgement* — something the reader must see before they act, or a consequence they cannot undo |
| Example | "Stars and language refresh from a cron; everything else is editorial." | The ADR-009 publish blocker naming each unsanitised asset |
| Renders as | `info=` on `AdminPageHeader`, `AdminPanel` or any field | `AdminNotice`, an `AdminPanel`, or the button's own confirm |

Four things **must never** move into a tooltip. This is not a style preference —
each one is a case where hiding the text turns a safe screen into an unsafe one:

1. **The ADR-009 unsanitised-media publish blocker.** It names the specific assets
   that are blocking a publish. It is the reason the button did not work.
2. **The ingest-token plaintext panel.** `ingestTokens.issue` returns the token
   once and stores it nowhere. "You will not see this again" behind a hover is a
   lost token.
3. **Destructive-action confirms.** `DeleteButton` arms in place and says what it
   is about to delete; that text is the whole safety mechanism.
4. **Zero-env and auth-state notices.** "Nothing here can read or write data" is
   the answer to "why is this screen empty", and a reader who does not know to
   hover will file it as a bug.

### There are three places a tip can attach, and they are all the same shape

`info` (plus `infoLabel`, which overrides the trigger's accessible name) is on
`AdminPageHeader`, on `AdminPanel` and on **every field**. In all three the icon is
rendered as a *sibling* of the heading or `<label>`, never a child of it:

| Scale | Prop | Row class |
| --- | --- | --- |
| Page | `AdminPageHeader info=` | `.adm-page-title-row` |
| Panel | `AdminPanel info=` | `.adm-panel-title-row` |
| Field | `TextField info=` &c. | `.adm-label-row` |
| Column | `EntityColumn.label` is a `ReactNode` — put an `<InfoTip>` in it | — |

Two things follow from "sibling, not child", and both are the reason it is not
optional. A `<button>` inside a heading contributes its accessible name to the
heading, so a nested tip makes the page announce as "Case studies, About case
studies" — and the `<h1>` is how a screen-reader user knows where they are. A
`<button>` inside a `<label>` is invalid HTML *and* gives a label click two targets,
which is why `ToggleField` keeps a plain `description` string and cannot take
`info`.

**Do not put an `InfoTip` in `AdminPanel`'s `headerEnd`.** It is the right-hand
cluster: on a 1040px column the icon lands most of a screen-width from the heading
it explains and reads as belonging to whatever badge it sits beside. `headerEnd` is
for status and controls, `info` is for explanation. (Every panel in the admin was
built the first way and then moved; the gap is closed, so there is no reason to
reach for a local shim.)

Everything else about a header:

- Title, optional `info`, right-aligned `actions` — **one line**. Do not add your
  own sub-heading row. There is no `description` prop; it existed as a migration
  shim and is gone.
- **Every detail, edit and `new` screen sets `back`**, pointing at its list. List
  screens do not (their parent is the dashboard, which the sidebar covers).
- **`eyebrow` is for list screens only**, and it names the *group* ("Content",
  "Profile", "Operations") — not the section. A detail screen already renders
  `back`, whose label *is* the section name, so an eyebrow there prints the same
  word twice in two type styles one line apart. The topbar breadcrumb covers the
  rest.
- **Every list screen gets a `ViewOnSite`** in `actions` where a public route
  exists. See §4a for the routes that are and are not live.
- For a **single record**, the affordance goes in the highest component that knows
  enough to tell the truth about it. A server page knows the slug and not
  `row.published`, so it can only offer a link that 404s on a draft: `projects` and
  `labs` therefore render `ViewOnSite` inside the form's publish panel, where
  `published` is in hand, while `posts` (route not live at all — `routeLive={false}`
  answers regardless) and `fun` (no draft state on the table) render it in the page
  header. Same rule, three different amounts of knowledge.

---

## 3. Reading and writing

```tsx
"use client";
import { api } from "@home/convex/api";
import { useMutation, useQuery } from "convex/react";
import { EntityTable, RowActions, SaveButton, StatusBadge, usePendingAction } from "@/components/admin";

export function ProjectsTable() {
  const rows = useQuery(api.projects.list, { includeDrafts: true, limit: 500 });
  const publish = useMutation(api.projects.publish);
  const action = usePendingAction();

  return (
    <EntityTable
      columns={[
        { key: "title", label: "Title" },
        { key: "status", label: "Status" },
        { key: "actions", label: "", align: "right" },
      ]}
      loading={rows === undefined}
      empty={rows?.length === 0}
      emptyTitle="No case studies yet"
    >
      {rows?.map((row) => (
        <tr key={row._id}>
          <td><Link href={`/admin/projects/${row._id}`} className="adm-cell-primary">{row.title}</Link></td>
          <td><StatusBadge published={row.published} featured={row.featured} /></td>
          <td data-align="right">
            <RowActions>
              <ActionButton action={action} onAction={() => publish({ projectId: row._id })}>
                Publish
              </ActionButton>
            </RowActions>
          </td>
        </tr>
      ))}
    </EntityTable>
  );
}
```

`api.*` paths **are** typechecked — a live Convex dev deployment has regenerated
`packages/convex/convex/_generated/api.d.ts`, so `tsc --noEmit` catches a wrong
function name or a wrong argument shape. Verified: `api.projects.notAThing` fails
the build.

`useQuery` returns `undefined` while resolving and the data afterwards. Keep those
distinguishable all the way to the render — `loading` and `empty` are separate
props on `EntityTable` because a table that shows "nothing here" while loading
gets a duplicate record created.

### Errors

Never write your own `try/catch` around a mutation. `usePendingAction()` and the
buttons that consume it read a rejected `ConvexError` correctly:

```ts
const { pending, failure, succeeded, run, reset } = usePendingAction();
await run(() => publish({ projectId }));
// failure = { code: 'precondition-failed', field: 'media', message: '…names each unsanitised asset…' }
```

`failure.message` is written by the backend to be shown to the person who caused
it — surface it verbatim. `failure.code` is for structural reactions (highlight
`failure.field`, offer a sign-in link on `'unauthenticated'`). `run()` never
throws; it resolves `undefined` on failure.

Share one `PendingAction` between sibling buttons (a form footer's Save and
Publish) so either one running disables both — the second write would race the
first.

---

## 4. Exports

### Page furniture — `AdminPage.tsx`

| Export | Signature | Notes |
| --- | --- | --- |
| `AdminPage` | `{ children }` | The content column, max 1040px. One per page. |
| `AdminPageHeader` | `{ title, info?, infoLabel?, actions?, back?, eyebrow? }` | Renders the page's only `<h1>`. See §2a. `info` becomes an `InfoTip`; `back` becomes a `BackLink`. |
| `AdminPanel` | `{ children, title?, info?, infoLabel?, headerEnd?, footer? }` | Bordered group. Use one per concern on a form. `info` sits beside the title; `headerEnd` is the right-hand cluster. |
| `AdminNotice` | `{ children, title?, tone?: 'info'\|'warn'\|'danger' }` | In-page note. `danger` announces as an alert. |
| `AdminForm` | `{ children }` | Vertical field rhythm. No `<form>`, no submit. |
| `AdminButtonRow` | `{ children }` | Wrapping button cluster. |

`AdminPageHeader` in full:

```ts
type AdminPageHeaderProps = {
  title: string;
  info?: ReactNode;                        // → InfoTip beside the title
  infoLabel?: string;                      // trigger's name; default `About {title}`
  actions?: ReactNode;                     // right-aligned, baseline-aligned to the title
  back?: { href: string; label: string };  // → BackLink above the title
  eyebrow?: string;                        // list screens only, and the *group* name
};
```

### Orientation — `InfoTip.tsx`, `BackLink.tsx`, `ViewOnSite.tsx`

| Export | Signature | Notes |
| --- | --- | --- |
| `InfoTip` | `{ children, label?, className? }` | The circled "i". `children` is the explanation — one or two sentences. `label` is the trigger's accessible name; **pass one** ("About slugs"), because six triggers all named "More information" are six identical rows in a screen reader's element list. `AdminPageHeader` sets it from the title. |
| `BackLink` | `{ href, label }` | Chevron + label. `label` names the *destination* ("Case studies"), not the action — the chevron already says back. Normally you get this via `AdminPageHeader back=`; use it directly only outside a header. |
| `ViewOnSite` | `{ href, published?, routeLive?, label? }` | Link to the public page, or a muted state saying why there isn't one. See §4a. |
| `ViewSiteLink` | — | The shell's persistent "View site" in the topbar. **Already mounted by `AdminShell`** — do not add a second one. |

`InfoTip` is the kit's only hand-rolled overlay and there is no tooltip
dependency. What it guarantees, so you do not have to re-check it per screen: the
trigger is a real focusable `<button>`; `aria-describedby` points at the panel
permanently, so the text is in the accessible description whether or not the panel
is visible; it opens on hover, on keyboard focus and on tap (tap toggles);
**Escape dismisses it from anywhere**, which is WCAG 1.4.13 and the reason hover
state is JS rather than a CSS `:hover` rule; and the panel is `position: fixed`, so
it is not clipped by `.adm-table-wrap`'s `overflow-x` and is clamped inside the
viewport at both edges. It carries no `aria-expanded` on purpose — APG is explicit
that a tooltip is not a disclosure.

Safe to put an `InfoTip` in a `<th>`, a field label, a panel heading or a table
cell. The panel resets the font, weight, case and letter-spacing it would
otherwise inherit from a mono uppercase `<th>`. Prefer the `info` prop where one
exists (page header, panel, field) — it places the trigger and derives its
accessible name for you; reach for a bare `<InfoTip>` for a `<th>` or a cell.

One caveat, because it fails silently: the panel is positioned against the
viewport, so an **ancestor** carrying `transform`, `filter`, `backdrop-filter`,
`perspective`, `contain` or `will-change` becomes its containing block and the
tooltip lands in the wrong place. No page-level container in `admin.css` does this
today (only `.adm-topbar`, which holds no tooltips). If you wrap page content in a
`<div>` with a Tailwind `transform`/`blur`/`backdrop-*` utility, that is the cause.

### 4a. Public routes, for `ViewOnSite`

| Section | `href` | State |
| --- | --- | --- |
| Case studies (list) | `/work` | live |
| Case studies (one) | `/work/${slug}` | live — pass `published={row.published}` |
| Labs | `/labs` | live |
| Fun | `/fun` | live |
| Résumé | `/resume` | live |
| Contact | `/contact` | live |
| **Writing** | `/blog` | **not built — pass `routeLive={false}`** |

Three states, and the component picks between them:

```tsx
<ViewOnSite href="/labs" />                              // → link, new tab
<ViewOnSite href={`/work/${slug}`} published={false} />  // → "Draft — not public yet"
<ViewOnSite href="/blog" routeLive={false} />            // → "Not on the site yet /blog"
```

`published` is read off the row you already have; there is no `published` field to
write anywhere (§7). Omit it on a list-level link — a route cannot be a draft.

Both of these render a plain `<a target="_blank">`, never `next/link`. A soft
navigation to the public site keeps Clerk, the Convex socket and UploadThing alive
in memory on a page that has no business holding them, which is what ADR 006 and
the root layout's docblock exist to prevent. A new tab is also just correct here:
you open the live page to check a change and come back to the form.

### Form primitives — `Field.tsx`

Every field is **controlled** and takes `value` + `onValueChange`, where the
callback receives the value *in the shape the Convex mutation wants* — the
date/number conversions are done here, not by you. All of them accept
`label`, `info?`, `infoLabel?`, `hint?`, `error?`, `required?`, `optional?`,
`disabled?`.

`hint` and `info` are not interchangeable and the split is the one from §2a:
**`hint` is the format, `info` is the consequence.** "Comma separated.", "One per
line, at most twelve" and a live colour swatch are hints — small print the reader
needs while typing, and a bound the mutation will refuse a save over belongs in
front of them, not behind a hover. "The blog index shows this instead of the post"
is `info`. A field can carry both; several do.

`label` stays a `string` on purpose. It is what the info trigger's accessible name
is derived from (`About {label}`), and a `ReactNode` label would have nothing to
build that from — which is also why the tip is a separate prop rather than something
you compose into the label yourself.

| Export | Value type | Notes |
| --- | --- | --- |
| `Field` | — | The wrapper. `children` is a render prop receiving `{ id, describedBy, invalid }`. Use it to wrap a control the kit does not have. |
| `FieldRow` | — | Responsive two/three-up row. |
| `TextField` | `string` | `type?: 'text'\|'email'\|'url'`, `maxLength`, `placeholder`, `autoComplete`. |
| `TextAreaField` | `string` | `rows`, `mono` (for Markdown/code bodies). |
| `SelectField<T extends string>` | `T` | `options: {value,label,disabled?}[]`, `placeholder?`. Callback is typed to `T`. |
| `NumberField` | `number \| null` | `null` is "empty", distinct from `0`. `min`/`max`/`step`. |
| `DateField` | `string \| null` | Calendar day, `YYYY-MM-DD` (`experienceEntries.startDate`). Never touches `Date`. |
| `InstantField` | `string \| null` | RFC-3339 UTC instant. Shows local wall clock. Only for *editorial* timestamps — never `createdAt`, `publishedAt`, `syncedAt`. |
| `ToggleField` | `checked` / `onCheckedChange` | Real checkbox. **Not for `published`** — publishing can be refused, so it needs `ActionButton`. |

**No field validates anything.** The Convex mutation is the authority (it holds
uniqueness and the ADR-009 gate); pass its `failure.message` down as `error`.

### Slugs — `SlugField.tsx`

| Export | Notes |
| --- | --- |
| `SlugField` | `{ value, onValueChange, source?, prefix?, published?, label?, error?, required?, disabled? }`. Derives from `source` (the title) until you type in it; the `auto`/`manual` button re-links. `published` switches the hint to the "this breaks every inbound link" wording and starts unlinked. |
| `slugify(s)` | `string → valid slug or `""`. NFD-normalises, so "Café" → `cafe`. |
| `isValidSlug(s)` | Matches `SlugSchema`: `^[a-z0-9]+(?:-[a-z0-9]+)*$`, 1–96 chars. |

### Actions — `Buttons.tsx`, `usePendingAction.ts`

| Export | Notes |
| --- | --- |
| `ActionButton` | `{ children, onAction, action?, pendingLabel?, variant?, size?, disabled?, quiet?, title? }`. The general case: publish, unpublish, revoke, re-order. |
| `SaveButton` | `{ onAction, action?, label?, dirty?, ... }`. Primary variant, "Saving…", then "Saved" for 2.2s. `dirty={false}` disables. |
| `DeleteButton` | `{ onAction, action?, label?, name?, size?, disabled? }`. Two-click confirm in place, self-disarming after 4s. No modal. |
| `usePendingAction()` | `{ pending, failure, succeeded, run, reset }`. |
| `describeFailure(e)` | `unknown → ActionFailure`. For a mutation called outside a button. |

### Lists — `EntityTable.tsx`, `StatusBadge.tsx`

| Export | Notes |
| --- | --- |
| `EntityTable` | `{ columns, children, toolbar?, loading?, empty?, emptyTitle?, emptyBody?, emptyAction? }`. Owns the sticky header, the `overflow-x` container and the two non-row states. Rows are yours. `EntityColumn.label` is a `ReactNode`, so a column whose meaning is not obvious in one word can carry an `<InfoTip>`; `""` still renders the visually-hidden "Actions" fallback. |
| `RowActions` | Right-aligned cluster for the last `<td>`. |
| `ToolbarEnd` | Pushes toolbar content right. |
| `StatusBadge` | `{ published, featured? }`. The one vocabulary for live/draft. |
| `Badge` | `{ children, tone?: 'neutral'\|'published'\|'featured'\|'revoked' }`. For contact status, revoked tokens. |

Cell attributes available in `admin.css`: `data-align="right"`,
`data-numeric="true"` (tabular mono), and `.adm-cell-primary` for the row's title
link.

### Media — `ImageUpload.tsx`, `MediaListEditor.tsx`

| Export | Notes |
| --- | --- |
| `ImageUpload` | `{ label, value: MediaAsset \| null, onValueChange, requireSanitised?, withCaption?, hint?, disabled?, assetActions? }`. One asset: upload, thumbnail, alt text, optional caption, optional sanitised toggle. |
| `MediaListEditor` | `{ value: readonly MediaAsset[], onValueChange, requireSanitised?, withCaption?, label?, disabled? }`. **Use this for `projects.media`.** Add/remove/reorder plus a running count of unsanitised assets. |

`requireSanitised` is ADR 009 and belongs on **`projects.media` only**. It
renders the sanitised checkbox and gives a fresh upload `sanitised: false`.
Everywhere else (`labs.coverImage`, `posts.coverImage`, `funEntries.photo`) leave
it unset so the field is *omitted* rather than `false` — "not applicable" and
"not yet checked" are different facts, and `projects.publish` only asks about the
second.

`width`/`height` are measured in the browser before upload; the server never
decodes an image. With no `UPLOADTHING_TOKEN` the dropzone renders a disabled,
explained state, while alt/caption/sanitised stay editable for assets that already
exist (iOS uploads, existing documents).

### 4b. Rich text — `RichTextEditor.tsx`

| Export | Signature | Notes |
| --- | --- | --- |
| `RichTextEditor` | `{ value, onChange, placeholder?, disabled?, minRows?, id?, describedBy?, invalid?, ariaLabel?, ariaLabelledBy? }` | Markdown string in, Markdown string out. `minRows` defaults to 8. |
| `findUnsupportedMarkdown` | `(md: string) => string[]` | Names the constructs in `md` this editor would destroy, phrased for a sentence: `["a table", "an image"]`. `[]` means safe. |

Use it for the long-form bodies — `posts.body`, a case study's narrative. **Not for
every string that happens to allow Markdown**: `TextAreaField` with `mono` still
exists and is the right control for a short one.

```tsx
<Field label="Body" error={failure?.field === "body" ? failure.message : undefined}>
  {({ id, describedBy, invalid }) => (
    <RichTextEditor
      id={id}
      describedBy={describedBy}
      invalid={invalid}
      ariaLabel="Body"          {/* not optional in practice — see below */}
      value={body}
      onChange={setBody}
      placeholder="Write the post…"
      disabled={pending}
    />
  )}
</Field>
```

**Pass `ariaLabel`.** `Field` renders `<label htmlFor>`, and `for` only associates
with a *labelable* element; the writing area is a `contenteditable` div, which is
not one. Without `ariaLabel` (or an `ariaLabelledBy` pointing at something that
has the text) the visible label is decoration as far as a screen reader is
concerned. Everything else `Field` hands out — `id`, `describedBy`, `invalid` —
lands on the editable as you would expect, `aria-invalid` included.

**The value contract is Markdown in, Markdown out, and round-trip fidelity is not
total.** Before writing the component the parse → serialize path was driven
headlessly over 33 constructs; the table of what survives, what gets rewritten
(escaping, tightened lists) and what is *destroyed* is in the file's docblock and
is worth reading once. The short version:

| | |
| --- | --- |
| **Survives byte-identical** | headings, paragraphs, bold/italic/code/strike, links (incl. titles and relative hrefs), tight and nested lists, ordered lists, blockquotes, fenced code, `---`, hard breaks |
| **Rewritten, renders the same** | `5 * 3` → `5 \* 3` (and `_`), a bare URL in a loaded body → `[url](url)`, loose lists tightened |
| **Destroyed** | **GFM tables** (to the empty string), **images** (to their alt text), task-list checkboxes, footnotes, raw inline HTML |

The component does not stay quiet about the last row: it calls
`findUnsupportedMarkdown` on its own `value` and renders an `AdminNotice` above
the toolbar naming what will be lost — the ADR-009 rule from §2a applied to a
different irreversible consequence. **A screen that can predict the problem should
do better than warn**: call `findUnsupportedMarkdown` yourself and render
`TextAreaField mono` instead of the editor when it returns anything.

There is deliberately **no image button**. Every image here is a `MediaAsset` —
URL, alt, measured `width`/`height`, and for `projects.media` the `sanitised`
flag `projects.publish` asserts on. A markdown `![alt](src)` can carry two of
those five, so an image pasted into a body is an asset that bypasses the ADR-009
gate. Media goes through `ImageUpload` / `MediaListEditor`.

Three smaller behaviours, so they are not read as bugs:

- **Headings are 2–4.** h1 is the page title; h5 is a restructure. An existing
  `# One` still round-trips as `#` (ProseMirror does not validate the `level`
  attribute) but *displays* as an h2. `findUnsupportedMarkdown` flags it.
- **Autolink is off.** It was on, and typing after a `3.` produced
  `[3.XYZ](http://3.XYZ)` in the saved body, because `.xyz` is a real TLD.
  Pasting a URL over a selection still makes a link.
- **Underline is off.** It is the one StarterKit mark with no Markdown — this
  version serialises it as `++text++`, which nothing downstream reads.

Markdown input rules and every StarterKit shortcut are live (`## `, `- `, `> `,
` ``` `, ⌘B, ⌘⌥2, ⌘Z…), which is most of the point of using Tiptap. The toolbar's
thirteen buttons are labelled with the Markdown they produce rather than icons,
except link/unlink; each has an `aria-label` and a `title` naming its shortcut.

#### The Tiptap decision, and the traps

Installed in `apps/web`, all **pinned exactly** (no caret):

```
@tiptap/core        3.29.2
@tiptap/pm          3.29.2
@tiptap/react       3.29.2
@tiptap/starter-kit 3.29.2
@tiptap/markdown    3.29.2
```

**Markdown route: `@tiptap/markdown`, the first-party package.** This is the part
worth reading, because the answer changed recently and most of what is written
about Tiptap + Markdown is now wrong. The long-standing community package
`tiptap-markdown` (aguingand) is what every older guide and answer recommends; it
is still on 0.9.0, last published September 2025, and it is a third-party bridge
onto ProseMirror's serializer. Tiptap has since shipped **bidirectional Markdown
support in core** as `@tiptap/markdown`, versioned and released in lockstep with
the rest of Tiptap (its peer range on `@tiptap/core` and `@tiptap/pm` is the exact
string `3.29.2`, not a caret). For a repo whose long-form fields are Markdown in
Convex and rendered as Markdown on the public site, the maintained first-party
serializer is the one to depend on.

Why exact pins rather than `^`: `@tiptap/react` and `@tiptap/markdown` both declare
their peers on `@tiptap/core`/`@tiptap/pm` as an exact version. A caret range would
let `@tiptap/core` float to 3.30 while two packages pin 3.29.2, which is a peer
conflict that presents as a duplicated ProseMirror schema and a runtime
`RangeError` rather than an install error. Bump all five together or none.

The API, from the shipped `.d.ts` rather than from memory — `@tiptap/markdown`
augments `@tiptap/core`, so `getMarkdown()` only typechecks where the extension is
imported:

```tsx
"use client";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";

const editor = useEditor({
  extensions: [StarterKit, Markdown],
  content: value,             // the Markdown string from Convex
  contentType: "markdown",    // REQUIRED — the default is 'json', and without
                              // this the Markdown is parsed as HTML
  onUpdate: ({ editor }) => onValueChange(editor.getMarkdown()),
});
```

Things that bite, all of them hit while building `RichTextEditor` and all of them
verified against the installed source rather than remembered:

- **`contentType: 'markdown'` is required on every content path**, not just at
  init: `setContent(md, { contentType: 'markdown' })`,
  `insertContent(md, { contentType: 'markdown' })`. The default is `'json'`, and
  a Markdown string parsed as HTML gives you a paragraph reading `## Heading`.
- **`setContent('', { contentType: 'markdown' })` is not safe.** Parsing an empty
  string yields `{type:'doc',content:[]}`, which violates the schema's `block+`.
  Tiptap guards this at *construction* (`onBeforeCreate` keeps the raw string when
  the parse is empty) and **not** in the command. Use `clearContent(false)` for a
  blank value; that is what `RichTextEditor` does.
- **Serialisation is only as complete as the extension list**, which is why tables
  and task lists come back mangled or empty. Adding them means adding pinned
  packages.
- **Only the five declared packages are importable.** `@tiptap/extensions` (which
  is where `Placeholder`, `CharacterCount` and `Focus` live) is a *transitive*
  dependency of StarterKit: present in bun's store, not linked into
  `apps/web/node_modules`, so importing it fails to resolve. Verified. That is why
  `RichTextEditor` hand-rolls its placeholder.
- **`useEditor`'s options are re-applied on every render.** It shallow-compares
  them and calls `setOptions` on any mismatch, so an inline `editorProps` or
  `extensions` array means `view.setProps()` + `updateState()` on every keystroke.
  Memoise them. Callbacks are exempt from the comparison — and *frozen*: the
  `Editor` binds its listeners in its constructor and `setOptions` does not rebind
  them, so `onUpdate` in the options object cannot see a later `onChange`. Attach
  `editor.on('update', …)` in an effect instead.
- **`useEditorState` is stale until the first transaction.** Its snapshot is
  cached against a transaction counter and *creating* the editor is not a
  transaction, so between mount and the first edit the selector still sees the
  `null` editor. Anything that must be right at rest (a placeholder, an empty
  state) has to come from props, not from `editor.isEmpty`.
- `Markdown.configure({ indentation: { style: 'space', size: 2 }, markedOptions })`
  are the knobs. It is `marked@17` underneath, whose `gfm: true` is already the
  default — hence `~~strike~~` and fenced code, and hence tables being *tokenised*
  (and then dropped) rather than left as text.
- Tiptap is a browser editor: the component is `"use client"`, uses
  `immediatelyRender: false`, and must not end up in a public route's graph — the
  same rule as the rest of this directory.

### Dates — `datetime.ts`

`nowIso()`, `isIsoDate(s)`, `isIsoInstant(s)`, `isoDateToInput`,
`inputToIsoDate`, `isoInstantToLocalInput`, `localInputToIsoInstant`,
`formatInstant(iso)` (→ `30 Jul 2026, 14:05`), `formatMonth(isoDate)` (→
`Jul 2026`).

Rule from the file header: **a calendar day never goes through `Date`.**
`new Date("2026-07-30").toLocaleDateString()` renders 29 July in Los Angeles, so
round-tripping a `YYYY-MM-DD` through `Date` drifts a day per save. The helpers
slice strings for days and use `Date` only for instants.

### Deployment facts

| Export | Notes |
| --- | --- |
| `useConvexReady()` / `CONVEX_READY` | Both public Convex/Clerk keys present. Mirrors `ConvexClientProvider`'s gate exactly. |
| `ConvexGate` | See §2. |
| `ConvexNotConfigured` | The standard notice, if you need it somewhere else. |
| `useAdminConfig()` | `{ uploadsEnabled }` — whether `UPLOADTHING_TOKEN` is set on the server. `UPLOADTHING_TOKEN` is a secret, so this is read server-side by the admin layout and passed down; there is no public mirror variable. |
| `AdminConfigProvider` | Mounted by `src/app/admin/layout.tsx`. Do not mount a second one. |

### Chrome (the shell layout's, not yours)

`AdminShell`, `AdminNav`, `AdminBreadcrumb`, `AdminStatusStrip`, `AdminSignOut`,
`ViewSiteLink`, plus `ADMIN_SECTIONS`, `ADMIN_GROUPS`, `sectionForPathname`.

The topbar's right cluster is `ViewSiteLink` → `ThemeToggle` → `AdminSignOut`, all
mounted by `AdminShell`. A page never renders any of them.

---

## 5. Styling

Every class lives in `src/app/admin/admin.css`, imported once by
`src/app/admin/layout.tsx`. The scope element carries **both** `hor` and `adm`:
`.hor` is what makes the `--hor-*` tokens resolve (they are declared on
`.hor[data-theme]` in `@home/ui/tokens.css`), `.adm` is what `admin.css` scopes
itself to.

The admin borrows the site's palette and writes its own components — it does
**not** import `horizon.css`. Same tokens, deliberately flatter: no washes, no
glows, denser spacing, accent used only for "this is current" and "this is the
primary action".

Raw classes you will want without a component wrapper:

- `.adm-btn` + `data-variant="primary|ghost|danger"` + `data-size="sm"` — for a
  `<Link>` styled as a button, which `ActionButton` cannot be.
- `.adm-eyebrow`, `.adm-micro`, `.adm-mono`, `.adm-link`, `.adm-sr-only`
- `.adm-skeleton` — shimmer placeholder, set a `width`.
- `.adm-banner` + `data-tone` — full-bleed strip under the topbar. The shell owns
  this one; pages should use `AdminNotice`.

Owned by the components above, listed so you recognise them in the stylesheet
rather than so you use them: `.adm-page-head-row`, `.adm-page-title-row`,
`.adm-back`, `.adm-tip` / `.adm-tip-trigger` / `.adm-tip-panel`, `.adm-viewsite`
(+ `data-state="live|draft|planned"`), `.adm-viewsite-btn`, and the editor's
`.adm-rte-wrap` / `.adm-rte` (+ `data-disabled`, `data-invalid`, `--adm-rte-rows`)
/ `.adm-rte-bar` / `.adm-rte-group` / `.adm-rte-btn` (+ `data-active`) /
`.adm-rte-body` / `.adm-rte-mount` / `.adm-rte-content` / `.adm-rte-ph`.

`.adm-rte-content` is the ProseMirror element itself, so the whole body type
scale hangs off it. Two rules there are load-bearing rather than decorative: the
padding is on that element and not on its wrapper, so a click in the empty space
below the last paragraph still lands inside the editable and places a caret; and
the focus ring is on `.adm-rte:focus-within` with the editable's own
`:focus-visible` outline switched off, because a toolbar and a writing area that
are one control should show one ring.

### Vertical rhythm

Three custom properties on the `.adm` scope, and the pass that introduced them also
tightened them — the admin had been laid out on public-site spacing, which is
generous because the site is *read*, where an editing surface is *scanned*.

| Property | Value | Use for |
| --- | --- | --- |
| `--adm-flow` | `1.15rem` | Between the big blocks of a page: header → content, panel → panel, notice → the thing it warns about. |
| `--adm-stack` | `0.85rem` | Between the parts of one block: the fields of a form. |
| `--adm-snug` | `0.35rem` | Between a label and its control, an icon and its text. |

Use these rather than a fresh `margin-top`. They are already wired into
`.adm-form`, `.adm-row`, `.adm-field`, `.adm-panel + .adm-panel`, `.adm-notice + *`
and the page header, so composing the existing components gets the rhythm for free
and a one-off value is now visibly out of step rather than invisibly close.

`.adm-page-head` has **no bottom rule**. It was removed deliberately: the largest
type on the page, at the top of the page, does not need a line under it to read as
a heading, and the rule plus its padding cost ~45px on every screen. Do not add
one back per-section.

If you need a colour, `color-mix()` an existing `--hor-*` token. There are no
colour literals in `admin.css` and there should stay none. Note that only
`--hor-panel` is opaque in both themes — `--hor-chip` and `--hor-panel-top` are
translucent overlays, so anything floating above arbitrary content (as
`.adm-tip-panel` does) has to use `--hor-panel`.

---

## 6. Things the kit will not do, and why

- **No modal dialog.** `DeleteButton` arms in place instead. A dialog needs focus
  trapping, an escape handler, a scroll lock and a portal to be accessible; what
  it protects is one click in a table row.
- **No drag-and-drop reordering.** `MediaListEditor` uses up/down buttons, and
  so should `setSortOrder` screens. The keyboard implementation of drag-and-drop
  *is* a pair of move buttons.
- **No client-side validation.** See §3. A second copy of the backend's rules
  drifts from the real ones and gets trusted more.
- **No optimistic updates.** Convex subscriptions push the new value within a
  round trip, and an optimistic write that then fails the ADR-009 gate would show
  a published case study that is not published.
- **No custom `<select>`.** The native one has keyboard, screen-reader, mobile
  and type-ahead behaviour for free, and every option set here is short and
  closed.

- **No tooltip or popover dependency.** `InfoTip` is ~40 lines of state over one
  CSS rule, and the alternatives (Radix, Floating UI) are 15–30 KB to solve a
  positioning problem that here is two `getBoundingClientRect()` comparisons —
  against the same client-graph budget that got `ConvexClientProvider` moved out
  of the root layout. Note the asymmetry with **No modal dialog** above: a dialog
  is refused because focus trapping, scroll locking and a portal are genuinely
  hard to get right, and a tooltip needs none of them. If a future need does want
  real anchor positioning, `position-area` + `position-try-fallbacks` is the
  CSS-native replacement for the placement code, not a library.

## 7. Backend contract notes worth knowing before you build

- `create` **never** takes `published`. Everything is inserted as a draft;
  `publish`/`unpublish` are separate mutations. There is no publish *field* to
  write, on any table.
- `setSortOrder({ projectIds })` / `({ labIds })` requires **every** id in the
  table, in display order. A subset returns `precondition-failed`. Both `list`
  queries are unpaginated, so you always have them.
- `ingestTokens.issue` returns the plaintext token **once**. It is stored nowhere
  and `list` never returns it. Show it, and say that it will not be shown again.
- `projects.publish` and `projects.update` both enforce ADR 009 — `update` too,
  because otherwise "publish clean, then edit dirty media in" bypasses the gate.
  Expect a `precondition-failed` from `update` on a published row.
- `resume` and `siteSettings` are singletons: `get` returns one document or
  `null`, and the write is `upsert`, not `create`/`update`.
