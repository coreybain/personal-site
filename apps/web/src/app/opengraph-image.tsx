import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import { getSiteData } from "@/lib/data";

/**
 * The site's Open Graph card — the portrait, plus the three numbers, generated.
 *
 * ── Why generated rather than a flat JPEG ──────────────────────────────────
 *
 * A hand-made card would be a copy of the headline figures that no build step
 * can keep honest — and stale telemetry on the one image a link preview shows
 * is the failure this whole site was rebuilt to avoid. `next/og` is built into
 * Next (nothing to install), so the card is drawn from the same Snapshot the
 * homepage reads, in the same language: dark deck, one accent, uppercase
 * instrument labels, a horizon rule across the middle.
 *
 * The portrait is `src/assets/portrait.jpg` — the same file `<PersonalCard>`
 * renders, read off disk and inlined as a data URI. Inlined rather than linked
 * because satori resolves a remote `src` by *fetching* it, and at build time
 * there is no server running to fetch from. At 62 KB it is comfortably inside
 * `ImageResponse`'s 500 KB budget for the whole bundle.
 *
 * ── Placement: the root segment ────────────────────────────────────────────
 *
 * At `app/` rather than under `(site)`, so it is the default card for every
 * route in the app. Deeper segments still win: `/blog/[slug]` sets
 * `openGraph.images` to the post's cover, and a segment's `openGraph` replaces
 * the parent's wholesale rather than merging, so a post shares as its own cover
 * and everything else shares as this.
 *
 * No sibling `twitter-image`. `twitter: { card: "summary_large_image" }` in the
 * root layout with no `twitter:image` falls back to `og:image` at every consumer
 * that matters, and a second 1200×630 render per build to restate the same
 * bytes is not worth it.
 *
 * ── Fonts ──────────────────────────────────────────────────────────────────
 *
 * The card uses `ImageResponse`'s bundled default face. The site's real pair
 * (Inter and IBM Plex Mono) is loaded by `next/font/google` into `.next`, where
 * there is no stable path to hand satori, and fetching them over the network
 * during a build would make the build depend on Google being up. Weights are
 * therefore never specified — one face, sized and spaced to carry the
 * hierarchy — and letter-spacing does the work the mono face would otherwise do.
 *
 * ── Cost ───────────────────────────────────────────────────────────────────
 *
 * A Route Handler, cached, with the same 300s window as every page: the figures
 * cannot drift further from the site than any other surface. Rendering only
 * happens when the URL is actually requested, which for an OG card means once
 * per platform per revalidation, not once per visitor.
 */
export const revalidate = 300;

export const alt = "Corey Baines — Principal Engineer, Sydney";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/* Horizon's dark theme, from packages/ui/src/tokens.css. Written as literals
   because satori resolves no CSS custom properties — these are the only copies
   of these values outside the token file, and they are the dark theme's alone
   (a shared link has no `prefers-color-scheme` to consult). */
const BG = "#090a12";
const INK = "#eef0f7";
const INK_2 = "#a9aec2";
const INK_3 = "#868da4";
const ACCENT = "#ab89fa";
const LINE = "rgba(160, 172, 225, 0.22)";

/**
 * The portrait, as a data URI.
 *
 * `process.cwd()` is the Next project directory (`apps/web`), which is the path
 * shape Next's own OG-image documentation uses for reading a font off disk — so
 * it is the shape file tracing is built to follow into a serverless bundle when
 * this route regenerates at runtime.
 */
async function portraitDataUri(): Promise<string> {
  const bytes = await readFile(join(process.cwd(), "src/assets/portrait.jpg"));
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}

export default async function OpenGraphImage() {
  const [{ identity, gitStats, aiUsage, projects }, portrait] =
    await Promise.all([getSiteData(), portraitDataUri()]);

  const readouts: Array<[string, string]> = [
    ["Contributions · 12mo", gitStats.totalContributionsYear.toLocaleString("en-AU")],
    ["Platforms shipped", String(projects.length)],
    ["Agent sessions", aiUsage.totalSessions.toLocaleString("en-AU")],
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: BG,
          // The sky wash, top-left, exactly as the page opens.
          backgroundImage:
            "radial-gradient(900px 520px at 12% -18%, rgba(171,137,250,0.30), rgba(9,10,18,0) 62%)",
          padding: "72px 80px",
          color: INK,
        }}
      >
        {/* ── above the horizon ─────────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                fontSize: 22,
                letterSpacing: 6,
                textTransform: "uppercase",
                color: ACCENT,
              }}
            >
              coreybaines.com
            </div>

            <div
              style={{
                display: "flex",
                marginTop: 28,
                fontSize: 84,
                letterSpacing: -2,
                lineHeight: 1.04,
              }}
            >
              {identity.name}
            </div>

            <div
              style={{
                display: "flex",
                marginTop: 18,
                fontSize: 34,
                color: INK_2,
              }}
            >
              {identity.role} · {identity.location}
            </div>
          </div>

          {/* A raw <img>, necessarily: this tree is rendered by satori, not by
              React DOM, and `next/image` has no meaning inside an
              `ImageResponse`. `src` is the inlined data URI. */}
          <img
            src={portrait}
            alt=""
            width={248}
            height={248}
            style={{
              width: 248,
              height: 248,
              borderRadius: 24,
              border: `1px solid ${LINE}`,
              objectFit: "cover",
            }}
          />
        </div>

        {/* ── the horizon, and the deck below it ────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", height: 1, backgroundColor: LINE }} />

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 36,
            }}
          >
            {readouts.map(([label, value]) => (
              <div
                key={label}
                style={{ display: "flex", flexDirection: "column" }}
              >
                <div
                  style={{
                    display: "flex",
                    fontSize: 20,
                    letterSpacing: 3,
                    textTransform: "uppercase",
                    color: INK_3,
                  }}
                >
                  {label}
                </div>
                <div
                  style={{
                    display: "flex",
                    marginTop: 12,
                    fontSize: 56,
                    letterSpacing: -1,
                    color: INK,
                  }}
                >
                  {value}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
