"use client";

import { api } from "@home/convex/api";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  AdminButtonRow,
  AdminForm,
  AdminNotice,
  AdminPanel,
  SaveButton,
  usePendingAction,
} from "@/components/admin";

import {
  PostFields,
  emptyPostDraft,
  parseTags,
  type PostDraft,
} from "../PostFields";

/**
 * `/admin/posts/new` — write a draft.
 *
 * `posts.create` takes no `published` argument (Convex rejects arguments a
 * validator does not name), so there is nothing on this screen that could publish
 * anything. The post is created, the browser is sent to its editor, and publishing
 * happens there next to the date it will stamp. Two screens rather than one because
 * "create and publish in one click" is how an unproofread post reaches the web.
 */
export function NewPostForm() {
  const router = useRouter();
  const create = useMutation(api.posts.create);
  const save = usePendingAction();

  const [draft, setDraft] = useState<PostDraft>(emptyPostDraft);

  /**
   * The one thing checked in the browser, and it is not validation.
   *
   * `coverImage` is a **required** argument of `posts.create`, so with no image
   * there is no call to make: the mutation could not be invoked at all, and Convex
   * would refuse the arguments before the handler ran, producing a validator
   * message about a missing object rather than a sentence about a missing cover.
   * Everything else on the form — an empty title, a malformed slug, a slug that is
   * already taken, an over-long tag — is left entirely to the mutation, which is
   * the only authority on it. See `components/admin/README.md` §3.
   */
  const missingCover = draft.coverImage === null;

  return (
    /* No panel title. It said "New post", which is what the page header two lines
       above already says — a second heading for the only panel on the screen is a
       row of chrome that names nothing new. `AdminPanel` renders the body and the
       footer without one. */
    <AdminPanel
      footer={
        <AdminButtonRow>
          <SaveButton
            action={save}
            label="Create draft"
            disabled={missingCover}
            title={
              missingCover
                ? "A post needs a cover image before it can be created."
                : undefined
            }
            onAction={async () => {
              /* Narrowed inside the action rather than relied upon from the
                 disabled button: `disabled` is a UI state and this is the call.
                 The throw is caught by `usePendingAction` and shown on the
                 button, and it is unreachable in practice. */
              if (draft.coverImage === null) {
                throw new Error("A post needs a cover image.");
              }

              const created = await create({
                slug: draft.slug,
                title: draft.title,
                excerpt: draft.excerpt,
                body: draft.body,
                coverImage: draft.coverImage,
                tags: parseTags(draft.tagsInput),
              });

              /* `push`, not `replace`: back from the editor should land on this
                 form, which is where someone would go to write another one.

                 The route is keyed on the slug as *stored* — `create` returns it
                 for exactly this reason — so a slug the mutation normalised is
                 still the one navigated to. */
              router.push(`/admin/posts/${created.slug}`);

              return created;
            }}
          />
        </AdminButtonRow>
      }
    >
      <AdminForm>
        {missingCover ? (
          <AdminNotice tone="warn" title="A cover image is required">
            <code>posts.create</code> will not accept a post without one — the blog
            index renders it. Upload it below, describe it, and the button unlocks.
          </AdminNotice>
        ) : null}

        <PostFields
          draft={draft}
          onDraftChange={setDraft}
          failure={save.failure}
          disabled={save.pending}
        />
      </AdminForm>
    </AdminPanel>
  );
}
