"use client";

import { api } from "@home/convex/api";
import type { Doc, Id } from "@home/convex/dataModel";
import type { MediaAsset } from "@home/types";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  ActionButton,
  AdminButtonRow,
  AdminForm,
  AdminNotice,
  AdminPanel,
  DeleteButton,
  SaveButton,
  StatusBadge,
  formatInstant,
  usePendingAction,
} from "@/components/admin";

import {
  PostFields,
  parseTags,
  postDraftFromRow,
  postDraftsEqual,
  type PostDraft,
} from "../PostFields";

/**
 * `/admin/posts/[slug]` — edit one post.
 *
 * ── Why the route is keyed on the slug rather than the id ────────────────────
 *
 * Because `convex/posts.ts` exports `getBySlug` and no `get`. That is not an
 * omission: its docblock says drafts resolve for an authenticated caller precisely
 * so "the admin editor and its preview can read a post through the same function
 * the public page uses", and reading through the public function is worth more than
 * an id-shaped URL. Every write still goes by `_id` — `posts.update`, `publish`,
 * `unpublish` and `remove` all take a `postId`, and the row supplies it.
 *
 * The cost is that renaming a slug makes this URL stale, which `onSaved` below
 * handles with a `router.replace`. The other, larger cost of renaming a slug is on
 * the public web and `SlugField` says so at the field.
 */

export function PostEditor({ slug }: { slug: string }) {
  /**
   * `undefined` while resolving, `null` for "no such post".
   *
   * The two must not be collapsed: `null` here means the slug in the URL does not
   * name a post, which is a dead link and a thing to say, while `undefined` is a
   * subscription that has not landed. `getBySlug` deliberately does not validate
   * the slug's format — an unknown URL is a 404, not a 500 — so a hand-typed
   * nonsense slug arrives here as `null` rather than as a thrown query.
   */
  const row = useQuery(api.posts.getBySlug, { slug });

  if (row === undefined) {
    return (
      <AdminPanel>
        <p className="adm-micro" role="status">
          Loading <code>{slug}</code>…
        </p>
      </AdminPanel>
    );
  }

  if (row === null) {
    /* No escape hatch in the panel: the page header above carries a `BackLink` to
       the list, which is the return path for every screen in this section and is
       already where the eye is. A second "All posts" button here would be the same
       destination said twice. */
    return (
      <AdminPanel title="No such post">
        <AdminNotice tone="warn">
          Nothing is stored at the slug <code>{slug}</code>. It may have been
          renamed or deleted — slugs are never reused, so an old URL stays dead.
        </AdminNotice>
      </AdminPanel>
    );
  }

  /**
   * `key={row._id}` remounts the form when the URL moves to a different post,
   * which is what discards the previous post's draft state.
   *
   * Without it, navigating from one editor to another reuses the component, and
   * `useState`'s initialiser — which only runs on mount — would leave the first
   * post's text in the fields while the second post's row drove the header. The
   * key is on `_id` rather than on the slug so that *renaming* a post does not
   * remount and throw away the edit that renamed it.
   */
  return <PostEditorForm key={row._id} row={row} />;
}

function PostEditorForm({ row }: { row: Doc<"posts"> }) {
  const router = useRouter();

  const update = useMutation(api.posts.update);
  const publish = useMutation(api.posts.publish);
  const unpublish = useMutation(api.posts.unpublish);
  const remove = useMutation(api.posts.remove);

  /**
   * Two pending states rather than one, and they disable each other.
   *
   * The kit's guidance is to share one `PendingAction` between sibling buttons so
   * either one running disables both — two writes to the same document in flight
   * at once is a race whichever way it resolves. That is honoured below by each
   * button carrying the other's `pending` in its `disabled`. They are kept
   * *separate* only so the success affordances do not lie: `SaveButton` renders
   * "Saved" from `succeeded`, and a shared state would make it say "Saved" after a
   * publish, which is a different fact.
   */
  const save = usePendingAction();
  const write = usePendingAction();
  const busy = save.pending || write.pending;

  /**
   * The form's own copy of the six editable values, seeded once.
   *
   * Seeded from the row on mount and **not** synchronised to it afterwards: the
   * Convex subscription pushes a new `row` on every change to this document,
   * including the ones this form just made, and an effect that copied it back into
   * state would overwrite whatever was being typed at the moment a save landed.
   *
   * The consequence to know: a change made in another tab, or by the iOS app, is
   * not reflected in these fields until the page is reloaded. `published` and
   * `publishedAt` are read from `row` directly — they are not form state, so they
   * *are* live.
   */
  const [draft, setDraft] = useState<PostDraft>(() => postDraftFromRow(row));
  const initial = postDraftFromRow(row);
  const dirty = !postDraftsEqual(draft, initial);

  /* Same reasoning as the create form: `coverImage` cannot be cleared to nothing
     and still be a post, so the save is held rather than sent to fail. */
  const missingCover = draft.coverImage === null;

  return (
    <>
      <AdminPanel
        title="Publishing"
        /* The tip carries the paragraph that used to sit under the dates. How
           `publishedAt` behaves is chrome by the test in README §2a — it is worth
           knowing once and it is not something to act on before pressing a button
           — while the "unsaved edits" notice below *is* judgement and stays inline.
           `.adm-toolbar-end` is a flex row, so both land in the panel header. */
        info={
          <>
            {row.publishedAt === null ? (
              <>
                Never published. The first publish stamps <code>publishedAt</code>{" "}
                from the server clock, and that instant is both the post&rsquo;s
                date and the key the blog sorts on.
              </>
            ) : (
              <>
                <code>publishedAt</code> is stamped once. Unpublishing keeps it
                and re-publishing does not move it, so pulling a post to fix a
                typo never re-dates it or sends it back to the top of the blog.
              </>
            )}
          </>
        }
        infoLabel="About publishing a post"
        headerEnd={<StatusBadge published={row.published} />}
        footer={
          <AdminButtonRow>
            {row.published ? (
              <ActionButton
                action={write}
                disabled={save.pending}
                onAction={() => unpublish({ postId: row._id })}
                pendingLabel="Hiding…"
                title="Hide from the public site. The publication date is kept."
              >
                Unpublish
              </ActionButton>
            ) : (
              <ActionButton
                action={write}
                variant="primary"
                disabled={save.pending}
                onAction={() => publish({ postId: row._id })}
                pendingLabel="Publishing…"
              >
                Publish
              </ActionButton>
            )}

            <DeleteButton
              action={write}
              size="md"
              name={row.title}
              disabled={save.pending}
              onAction={async () => {
                const result = await remove({ postId: row._id });
                /* `replace`, not `push`: the URL just stopped resolving, and
                   leaving it in the history means Back lands on a dead editor. */
                router.replace("/admin/posts");
                return result;
              }}
            />
          </AdminButtonRow>
        }
      >
        <p className="adm-micro">
          Published{" "}
          <span className="adm-mono">{formatInstant(row.publishedAt)}</span>
          {" · "}Created{" "}
          <span className="adm-mono">
            {/* `_creationTime` is epoch milliseconds — the one numeric timestamp
                in Convex — so it is converted to the RFC-3339 string every other
                date in this admin is, rather than formatted a second way. */}
            {formatInstant(new Date(row._creationTime).toISOString())}
          </span>
        </p>

        {dirty ? (
          <AdminNotice tone="warn" title="Unsaved edits below">
            Publish and unpublish act on the <em>stored</em> post, not on the fields
            below — and publishing re-validates what is stored. Save first if the
            edits are meant to go live.
          </AdminNotice>
        ) : null}
      </AdminPanel>

      <AdminPanel
        title="Content"
        footer={
          <AdminButtonRow>
            <SaveButton
              action={save}
              dirty={dirty}
              disabled={write.pending || missingCover}
              title={
                missingCover
                  ? "A post cannot be saved without a cover image."
                  : undefined
              }
              onAction={async () => {
                /**
                 * Only what changed.
                 *
                 * `posts.update` is patch semantics — an absent argument leaves
                 * the field alone — and sending only the differences means the
                 * body is not round-tripped to change a tag, a slug rename runs
                 * its uniqueness check only when the slug actually moved, and the
                 * `changed` flag it returns means something.
                 */
                const patch: {
                  postId: Id<"posts">;
                  slug?: string;
                  title?: string;
                  excerpt?: string;
                  body?: string;
                  coverImage?: MediaAsset;
                  tags?: string[];
                } = { postId: row._id };

                if (draft.slug !== initial.slug) patch.slug = draft.slug;
                if (draft.title !== initial.title) patch.title = draft.title;
                if (draft.excerpt !== initial.excerpt) {
                  patch.excerpt = draft.excerpt;
                }
                if (draft.body !== initial.body) patch.body = draft.body;
                if (draft.tagsInput !== initial.tagsInput) {
                  patch.tags = parseTags(draft.tagsInput);
                }
                if (
                  draft.coverImage !== null &&
                  JSON.stringify(draft.coverImage) !==
                    JSON.stringify(initial.coverImage)
                ) {
                  patch.coverImage = draft.coverImage;
                }

                const result = await update(patch);

                /* The URL is keyed on the slug, so a rename has just invalidated
                   it. `replace` rather than `push` — the old slug no longer
                   resolves, so it does not belong in the history — and only when
                   the value actually moved, because a navigation resets scroll. */
                if (result.slug !== row.slug) {
                  router.replace(`/admin/posts/${result.slug}`);
                }

                return result;
              }}
            />
          </AdminButtonRow>
        }
      >
        <AdminForm>
          {missingCover ? (
            <AdminNotice tone="warn" title="A cover image is required">
              The post cannot be saved without one. Upload a replacement below.
            </AdminNotice>
          ) : null}

          <PostFields
            draft={draft}
            onDraftChange={setDraft}
            published={row.published}
            failure={save.failure ?? write.failure}
            disabled={busy}
          />
        </AdminForm>
      </AdminPanel>
    </>
  );
}
