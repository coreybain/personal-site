import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { cacheLife } from "next/cache";
import { ImageResponse } from "next/og";

import { getSiteData } from "@/lib/data";

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

/**
 * The card is rendered inside a cached function and served as bytes.
 *
 * Under Cache Components, reading the portrait off disk and rasterising the
 * card are slow work that would otherwise make this route render on every
 * request. `'use cache'` with the site's five-minute profile keeps it what it
 * was under ISR: generated once, refreshed at most every five minutes. The
 * `ImageResponse` itself is not serialisable, so the cached value is its PNG
 * bytes and the route wraps them in a fresh `Response`.
 */
export default async function OpenGraphImage(): Promise<Response> {
  const png = await renderCard();
  return new Response(png, {
    headers: { "content-type": contentType, "content-length": String(png.byteLength) },
  });
}

async function renderCard(): Promise<Uint8Array<ArrayBuffer>> {
  "use cache";
  cacheLife("site");

  const [{ identity, gitStats, aiUsage, projects }, portrait] =
    await Promise.all([getSiteData(), portraitDataUri()]);

  const readouts: Array<[string, string]> = [
    ["Contributions · 12mo", gitStats.totalContributionsYear.toLocaleString("en-AU")],
    ["Platforms shipped", String(projects.length)],
    ["Agent sessions", aiUsage.totalSessions.toLocaleString("en-AU")],
  ];

  const image = new ImageResponse(
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

  return new Uint8Array(await image.arrayBuffer());
}
