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
│   ├── page.tsx          # switchboard linking to the four variants
│   ├── globals.css       # minimal + neutral; variants bring their own styling
│   └── v/<slug>/page.tsx # editorial | terminal | swiss | aurora
├── components/v/<slug>/  # per-variant components, no cross-variant imports
└── lib/snapshot.ts       # the shared data contract (mock; Convex later)
```

## snapshot.ts

Every variant reads from `src/lib/snapshot.ts` and nothing else. It is mock data
shaped exactly like the Convex `snapshot` row that will replace it, and it is fully
deterministic — the contribution calendar comes from a seeded PRNG, never
`Math.random`, so server render and client hydration always agree.

Changing the snapshot's *shape* is a change to the contract. Changing its values is
free.

## Variants

Each `/v/*` route owns its own type, color and motion. Keep variant styling scoped to
the route — `globals.css` stays neutral so the four can be compared fairly.

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
`/api/uploadthing` answers 503, and the public site is byte-identical to a build
without the admin at all (verified per page).
