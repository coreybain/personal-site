import { snapshot } from "@/lib/snapshot";
import { ContributionHeatmap } from "./ContributionHeatmap";
import { SectionHeader } from "./SectionHeader";
import { countWord, monthYear, num } from "./format";

const { gitStats } = snapshot;

const privatePct = Math.round(
  (gitStats.privateContributions / gitStats.totalContributionsYear) * 100,
);
/** `90%` → `"nine"` (in ten), derived so the thesis can't drift from the data. */
const privateTenths = countWord(Math.round(privatePct / 10));
const weeks = gitStats.calendar.length;
const perWeek = Math.round(gitStats.totalContributionsYear / weeks);
const activeDays = gitStats.calendar.flat().filter((d) => d.count > 0).length;

/** The observed floor of the top bucket, so the legend never lies about it. */
const peakCounts = gitStats.calendar
  .flat()
  .filter((d) => d.level === 4)
  .map((d) => d.count);
const peakFloor = peakCounts.length ? Math.min(...peakCounts) : null;

const rangeStart = gitStats.calendar[0][0].date;
/** The grid runs to the end of the current week; the *data* stops at today. */
const rangeEnd = snapshot.computedAt.slice(0, 10);

/** Leading language takes the accent; the rest step down the ink ramp. */
const LANG_INK = [
  "var(--ed-accent)",
  "rgba(20,18,15,0.78)",
  "rgba(20,18,15,0.54)",
  "rgba(20,18,15,0.32)",
  "rgba(20,18,15,0.15)",
];

const figures = [
  {
    value: num(gitStats.totalContributionsYear),
    label: "Contributions",
    note: `${num(perWeek)} a week, sustained across ${weeks} weeks.`,
  },
  {
    value: `${privatePct}%`,
    label: "Behind a private door",
    note: `${num(gitStats.privateContributions)} contributions to closed repositories — the enterprise work, receipted.`,
  },
  {
    value: num(gitStats.publicCommits),
    label: "Public commits",
    note: `Across ${gitStats.publicRepoCount} open repositories.`,
  },
  {
    value: num(gitStats.currentStreakDays),
    label: "Day streak",
    note: `${num(activeDays)} of ${num(weeks * 7)} days on the board.`,
  },
];

export function GitSignal() {
  return (
    <section className="ed-wrap ed-band" id="ledger">
      <SectionHeader
        index="01"
        label="The Ledger"
        meta={`${monthYear(rangeStart)} — ${monthYear(rangeEnd)}`}
        thesis={
          <>
            <em className="ed-hl ed-num">
              {num(gitStats.totalContributionsYear)}
            </em>{" "}
            contributions in twelve months &mdash; and{" "}
            <em className="ed-hl">{privateTenths} in ten</em> of them behind a
            private door.
          </>
        }
      />

      <div className="ed-figs ed-rise">
        {figures.map((fig) => (
          <div className="ed-fig" key={fig.label}>
            <p className="ed-fig-val ed-num">{fig.value}</p>
            <p className="ed-caps ed-fig-label">{fig.label}</p>
            <p className="ed-fig-note">{fig.note}</p>
          </div>
        ))}
      </div>

      <figure className="ed-panel ed-rise" style={{ margin: "clamp(1.75rem,3.5vw,2.5rem) 0 0" }}>
        <figcaption className="ed-panel-head ed-caps">
          <span style={{ color: "var(--ed-ink)" }}>Contribution calendar</span>
          <span>
            {weeks} weeks &middot; {monthYear(rangeStart)} &ndash;{" "}
            {monthYear(rangeEnd)}
            <span className="ed-heat-hint"> &middot; scroll &rarr;</span>
          </span>
        </figcaption>

        <div className="ed-heat-scroll">
          <ContributionHeatmap />
        </div>

        <div className="ed-heat-foot ed-caps">
          {peakFloor !== null ? (
            <span className="ed-legend">
              <i style={{ background: "var(--ed-accent)" }} aria-hidden="true" />
              Peak days &mdash; {num(peakFloor)}+ contributions
            </span>
          ) : null}
          <span className="ed-legend">
            Less
            <i style={{ background: "var(--ed-l0)" }} aria-hidden="true" />
            <i style={{ background: "var(--ed-l1)" }} aria-hidden="true" />
            <i style={{ background: "var(--ed-l2)" }} aria-hidden="true" />
            <i style={{ background: "var(--ed-l3)" }} aria-hidden="true" />
            <i style={{ background: "var(--ed-l4)" }} aria-hidden="true" />
            More
          </span>
        </div>
      </figure>

      <div className="ed-langs ed-rise">
        <p className="ed-caps" style={{ color: "var(--ed-ink-45)", marginBottom: "0.75rem" }}>
          Composition of tracked code
        </p>
        <div
          className="ed-measure"
          role="img"
          aria-label={gitStats.languages
            .map((l) => `${l.name} ${l.pct}%`)
            .join(", ")}
        >
          {gitStats.languages.map((lang, i) => (
            <span
              key={lang.name}
              style={{ width: `${lang.pct}%`, background: LANG_INK[i] }}
            />
          ))}
        </div>
        <ul className="ed-lang-list ed-caps">
          {gitStats.languages.map((lang, i) => (
            <li key={lang.name}>
              <span
                className="ed-lang-swatch"
                style={{ background: LANG_INK[i] }}
                aria-hidden="true"
              />
              <span className="ed-lang-name">{lang.name}</span>
              <span className="ed-lang-pct">{lang.pct}%</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export default GitSignal;
