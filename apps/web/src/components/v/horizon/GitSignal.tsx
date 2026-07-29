import type { CSSProperties } from "react";

import { snapshot } from "@/lib/snapshot";

import { Heatmap, HeatmapLegend, RAMP_VARS } from "./Heatmap";
import { DeckHead, Meter, Panel } from "./Panel";
import { longDate, num, pct, stamp } from "./format";

const { gitStats } = snapshot;
const { calendar, languages } = gitStats;

const days = calendar.flat();
const firstDay = calendar[0][0].date;
const lastDay = calendar[calendar.length - 1][6].date;

const busiest = days.reduce((a, b) => (b.count > a.count ? b : a));
const activeDays = days.filter((d) => d.count > 0).length;
const privatePct = pct(gitStats.privateContributions, gitStats.totalContributionsYear);
const publicContributions =
  gitStats.totalContributionsYear - gitStats.privateContributions;
const perActiveDay = (gitStats.totalContributionsYear / activeDays).toFixed(1);
const perWeek = Math.round(gitStats.totalContributionsYear / calendar.length);

/** How many of every 100 contributions land in a private repository. */
const privateSquares = Math.round(
  (gitStats.privateContributions / gitStats.totalContributionsYear) * 100,
);

const SUBSTATS = [
  {
    label: "Active days",
    value: num(activeDays),
    sub: `of ${num(days.length)} · ${pct(activeDays, days.length)}% coverage`,
  },
  {
    label: "Per active day",
    value: perActiveDay,
    sub: `≈ ${num(perWeek)} a week, sustained`,
  },
  {
    label: "Current streak",
    value: `${gitStats.currentStreakDays} d`,
    sub: "unbroken, through today",
  },
  {
    label: "Busiest day",
    value: num(busiest.count),
    sub: longDate(busiest.date),
  },
];

/** Ramp positions reused for the language legend, darkest share first. */
const LANG_FILL = [
  RAMP_VARS[4],
  RAMP_VARS[3],
  RAMP_VARS[2],
  RAMP_VARS[1],
  RAMP_VARS[0],
] as const;

export function GitSignal() {
  return (
    <section id="signal" className="scroll-mt-20">
      <DeckHead
        index="01"
        title="Git signal"
        meta={`${stamp(firstDay)} — ${stamp(lastDay)} · Sun → Sat`}
      />

      <Panel
        label="Contribution matrix"
        meta={
          <>
            <span className="hor-hot">{num(gitStats.totalContributionsYear)}</span>{" "}
            total · peak {num(busiest.count)}/day
          </>
        }
        padded={false}
        delay={40}
      >
        <div className="hor-panel-body">
          <div className="hor-heat-scroll">
            <div className="hor-heat-floor">
              <Heatmap weeks={calendar} peak={busiest.date} />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
            <span className="hor-label">
              {stamp(firstDay)} — {stamp(lastDay)} · 52 × 7
            </span>
            <HeatmapLegend />
          </div>
        </div>

        <div className="hor-substats">
          {SUBSTATS.map((s) => (
            <div key={s.label} className="hor-substat">
              <span className="hor-label">{s.label}</span>
              <div className="hor-readout-sm mt-2.5">{s.value}</div>
              <p className="hor-micro mt-1.5 truncate">{s.sub}</p>
            </div>
          ))}
        </div>
      </Panel>

      <div className="mt-3 grid gap-3 lg:grid-cols-12">
        <Panel
          label="Where the work lands"
          meta="Per 100 contributions"
          className="lg:col-span-5"
          delay={100}
        >
          <div className="flex flex-wrap items-start gap-x-6 gap-y-5">
            <div className="hor-matrix" aria-hidden="true">
              {Array.from({ length: 100 }, (_, i) => (
                <i key={i} data-k={i >= privateSquares ? "pub" : "priv"} />
              ))}
            </div>

            <div className="min-w-[160px] flex-1">
              <p className="hor-micro">
                {privatePct}% of the year happens inside private repositories —
                client platforms, not portfolio pieces. The public trace is the
                remainder.
              </p>
              <div className="mt-3">
                <div className="hor-row">
                  <span className="hor-label flex items-center gap-2">
                    <span
                      className="hor-swatch"
                      style={{ background: "var(--hor-l2)" }}
                      aria-hidden="true"
                    />
                    Private
                  </span>
                  <span className="hor-mono hor-micro" style={{ color: "var(--hor-ink)" }}>
                    {num(gitStats.privateContributions)}
                  </span>
                </div>
                <div className="hor-row">
                  <span className="hor-label flex items-center gap-2">
                    <span
                      className="hor-swatch"
                      style={{ background: "var(--hor-l4)" }}
                      aria-hidden="true"
                    />
                    Public
                  </span>
                  <span className="hor-mono hor-micro" style={{ color: "var(--hor-ink)" }}>
                    {num(publicContributions)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </Panel>

        <Panel
          label="Language distribution"
          meta="Share of tracked code"
          className="lg:col-span-4"
          delay={150}
        >
          <div className="grid gap-3.5">
            {languages.map((lang, i) => (
              <Meter
                key={lang.name}
                name={lang.name}
                value={`${lang.pct}%`}
                share={lang.pct}
                hot={i === 0}
                delay={300 + i * 70}
              />
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-x-3.5 gap-y-1.5 border-t border-[var(--hor-line-soft)] pt-3.5">
            {languages.map((lang, i) => (
              <span key={lang.name} className="hor-micro flex items-center gap-1.5">
                <span
                  className="hor-swatch"
                  style={{ background: LANG_FILL[i], width: 7, height: 7 }}
                  aria-hidden="true"
                />
                {lang.name}
              </span>
            ))}
          </div>
        </Panel>

        <Panel
          label="Public surface"
          meta="Open repositories"
          className="lg:col-span-3"
          delay={200}
        >
          <div className="hor-readout">{num(gitStats.publicCommits)}</div>
          <p className="hor-micro mt-2.5">
            public commits across {gitStats.publicRepoCount} repositories
          </p>

          <div className="mt-5 border-t border-[var(--hor-line-soft)] pt-1">
            <div className="hor-row">
              <span className="hor-label">Private share</span>
              <span className="hor-mono hor-micro" style={{ color: "var(--hor-ink)" }}>
                {privatePct}%
              </span>
            </div>
            <div className="hor-row">
              <span className="hor-label">Repositories</span>
              <span className="hor-mono hor-micro" style={{ color: "var(--hor-ink)" }}>
                {gitStats.publicRepoCount}
              </span>
            </div>
            <div className="hor-row">
              <span className="hor-label">Weeks tracked</span>
              <span className="hor-mono hor-micro" style={{ color: "var(--hor-ink)" }}>
                {calendar.length}
              </span>
            </div>
          </div>

          <div className="hor-track mt-5">
            <span
              className="hor-fill"
              data-hot="1"
              style={{ width: `${privatePct}%`, "--hor-delay": "420ms" } as CSSProperties}
            />
          </div>
          <p className="hor-micro mt-2.5">
            {num(gitStats.privateContributions)} private · {num(publicContributions)}{" "}
            public
          </p>
        </Panel>
      </div>
    </section>
  );
}
