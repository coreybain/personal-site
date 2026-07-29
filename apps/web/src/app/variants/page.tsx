import Link from "next/link";
import { snapshot } from "@/lib/snapshot";

type Variant = {
  href: string;
  name: string;
  blurb: string;
};

type Round = {
  id: string;
  title: string;
  note: string;
  variants: Variant[];
};

const rounds: Round[] = [
  {
    id: "round-1",
    title: "Round 1",
    note: "Four directions, one light mode each.",
    variants: [
      {
        href: "/v/editorial",
        name: "Editorial Ink",
        blurb: "Magazine typography, generous rules, ink on paper.",
      },
      {
        href: "/v/terminal",
        name: "Observatory",
        blurb: "Instrument panel. Monospace, dense data, live readouts.",
      },
      {
        href: "/v/swiss",
        name: "Swiss Poster",
        blurb: "Hard grid, flat color, type as structure.",
      },
      {
        href: "/v/aurora",
        name: "Soft Depth",
        blurb: "Layered gradients, gentle motion, quiet glass.",
      },
    ],
  },
  {
    id: "round-2",
    title: "Round 2 — Aurora × Observatory, light + dark",
    note: "Crossing the two front-runners. Every variant themes both ways.",
    variants: [
      {
        href: "/v/nocturne",
        name: "Nocturne",
        blurb: "Layered violet field, instrument-grade detail after dark.",
      },
      {
        href: "/v/console",
        name: "Console",
        blurb: "Panels and readouts, softened edges, both lights on.",
      },
      {
        href: "/",
        name: "Horizon — chosen",
        blurb: "One long gradient band, wide type, data on the skyline. Now the live homepage.",
      },
      {
        href: "/v/prism",
        name: "Prism",
        blurb: "Neutral field, spectral accents, color as the only ornament.",
      },
    ],
  },
];

export default function Home() {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-20">
      <main className="w-full max-w-xl">
        <header className="mb-12">
          <h1 className="text-2xl font-semibold tracking-tight text-balance">
            coreybaines.com — design exploration archive
          </h1>
          <p className="mt-3 text-sm leading-relaxed opacity-60">
            Eight directions for the same site, each reading from one shared
            snapshot. Horizon won and now lives at the root.
          </p>
        </header>

        <div className="flex flex-col gap-12">
          {rounds.map((round) => (
            <section key={round.id} aria-labelledby={round.id}>
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2
                  id={round.id}
                  className="font-mono text-xs tracking-wider uppercase opacity-70"
                >
                  {round.title}
                </h2>
                <p className="text-xs opacity-40">{round.note}</p>
              </div>

              <nav>
                <ul className="divide-y divide-black/10 border-y border-black/10 dark:divide-white/10 dark:border-white/10">
                  {round.variants.map((variant) => (
                    <li key={variant.href}>
                      <Link
                        href={variant.href}
                        className="group flex items-baseline justify-between gap-6 py-4 transition-opacity hover:opacity-100 sm:py-5"
                      >
                        <span className="min-w-0">
                          <span className="block text-base font-medium">
                            {variant.name}
                          </span>
                          <span className="mt-1 block text-sm opacity-55">
                            {variant.blurb}
                          </span>
                        </span>
                        <span className="shrink-0 font-mono text-xs opacity-40 transition-opacity group-hover:opacity-80">
                          {variant.href}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            </section>
          ))}
        </div>

        <footer className="mt-12 font-mono text-xs opacity-40">
          {snapshot.identity.name} · {snapshot.identity.location} · snapshot{" "}
          {snapshot.computedAt.slice(0, 10)}
        </footer>
      </main>
    </div>
  );
}
