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
