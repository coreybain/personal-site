# ADR 0020 — Uploadfile for file storage

- **Date:** 2026-09-29
- **Status:** Accepted
- **Supersedes:** ADR 0010

## Context

ADR 0010 put every stored file on UploadThing. Two things changed. The browser
admin, whose upload button was UploadThing's main client, was removed in favour
of the MCP server. And Corey now runs Uploadfile, his own file upload and
hosting service with an UploadThing-shaped server API, so the site can depend on
a service he controls instead of a third party.

## Decision

Use **Uploadfile** (`@uploadfile/core`, 0.2.0 or later) for all file storage:
post images uploaded from scripts or the MCP workflow, contact-form attachments,
and images the iOS app sends through `/api/native/upload`. The server SDK is
`UFApi`; the one credential is `UPLOADFILE_TOKEN`, which also selects the
service address. Version 0.1.0 cannot do that and fails with a configuration
error, which is why the minimum is 0.2.0.

UploadThing is removed: the `uploadthing` package, `UPLOADTHING_TOKEN` and the
`/api/uploadthing` route are gone.

## Migration

On 2026-09-29 the UploadThing app held eight files, all images for the three
published posts and all referenced from the `posts` table (cover images and
Markdown bodies). Each was downloaded, uploaded to Uploadfile with its name and
custom ID, and checked byte-for-byte against the original. The posts were then
updated through `posts.update` (revision 2 → 3), so the rewrite went through the
normal validation, revisioning and knowledge re-indexing. A full export after
the rewrite contained no `ufs.sh` URL.

## Consequences

- Stored URLs have the form `https://www.uploadfile.dev/f/<app>/<key>`, and
  `storageKey` is the Uploadfile file key. Nothing validates URL hosts, so no
  allowlist changed.
- The Uploadfile application rejects `text/plain`, `text/html` and
  `application/json` uploads ("Failed to authorize upload") while accepting
  images, PDF, Word, RTF, Markdown and CSV. The contact form accepts `.txt`
  attachments, so those fail until the application allows text files.
- Deleting a row still orphans its stored file; that loose end (see
  `projects.remove`) is unchanged.
