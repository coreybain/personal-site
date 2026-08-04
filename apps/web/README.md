# apps/web

The coreybaines.com site. Next.js 16 (App Router, Turbopack), React 19, TypeScript,
Tailwind CSS v4 (CSS-first), `motion` for animation.

```bash
bun run dev        # http://localhost:3000
bun run build
bun run typecheck  # tsc --noEmit
bun run lint
```

## Structure

```
src/
├── app/
│   ├── (site)/          # public pages and the Horizon design system
│   ├── admin/           # authenticated content administration
│   └── globals.css      # Tailwind and the neutral root surface
├── components/site/     # public-site components
└── lib/                 # live data projection, derivations and utilities
```

## Data

Public content is read from Convex and projected through `src/lib/data.ts` into
the stable site contract in `src/lib/snapshot.ts`. The deterministic snapshot is
kept as seed and test fixture data; public routes do not silently substitute it
when live configuration is missing.

## /admin

The browser CRUD surface for every Convex entity. Documented in
`src/components/admin/README.md`, which is the file to read before adding a screen.

Two rules that are easy to break and hard to notice:

- **`ConvexClientProvider` mounts in `src/app/admin/layout.tsx` and nowhere else.**
  `@clerk/nextjs` + `convex/react-clerk` are ~76 KB gzip in whatever route's client
  graph they land in, against a < 100 KB homepage budget. Nothing under
  `src/app/(site)` may import `src/components/auth` or `src/components/admin`. See
  the docblock in `src/app/layout.tsx`.
- **Admin pages go inside the `(shell)` route group** —
  `src/app/admin/(shell)/<segment>/page.tsx`. The group is where the `auth()` gate
  and the sidebar live; a page outside it resolves to the same URL with neither.

Everything degrades with no environment variables set: `/admin` renders its shell
and its nine section cards with a banner explaining that auth is off,
`/api/uploadthing` and `/api/native/upload` answer 503, and the public site is
byte-identical to a build without the admin at all (verified per page). The
native route accepts one authenticated multipart `file` image up to 4 MiB and
returns `{ file: { url, storageKey, name, size, contentType } }`.

All administrative surfaces require the signed-in Clerk subject to match the
server-only `ADMIN_CLERK_USER_ID`. Set it in the web deployment and set the same
subject in each matching Convex deployment; missing values fail closed.
