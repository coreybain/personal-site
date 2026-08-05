import type { CSSProperties } from "react";

import { SkyHead } from "@/components/site/Panel";
import { num, relativeDays } from "@/components/site/format";
import {
  deriveOffClockDashboard,
  type OffClockLabCard,
  type OffClockMovementCard,
} from "@/lib/derive";
import type { HealthStats, Lab } from "@/lib/snapshot";

function ArrowRight() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path
        d="M2.5 6.5h8M7.5 3.5l3 3-3 3"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function fallbackHue(slug: string): number {
  return [...slug].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 360;
}

function LabArtwork({ lab }: { lab: Lab }) {
  if (lab.coverImage) {
    return (
      <div className="offclock-cover">
        {/* The Lab CMS accepts arbitrary image hosts. Keeping this as a native,
            lazy image avoids a brittle allow-list and adds no client runtime. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={lab.coverImage.url} alt={lab.coverImage.alt} loading="lazy" />
      </div>
    );
  }

  return (
    <div
      className="offclock-cover offclock-cover-fallback"
      style={{ "--offclock-hue": fallbackHue(lab.slug) } as CSSProperties}
      aria-hidden="true"
    >
      <span>{lab.title.slice(0, 2)}</span>
    </div>
  );
}

function staleSyncMessage(card: OffClockLabCard, computedAt: string): string {
  const syncedAt = card.lab.liveStats.syncedAt;
  if (!syncedAt) return "Live figures are waiting for their first public sync.";

  const age = Math.max(0, Date.parse(computedAt) - Date.parse(syncedAt));
  const days = Math.floor(age / 86_400_000);
  if (days === 0) return "Last public sync was more than 48 hours ago.";
  return `Last public sync was ${relativeDays(days).toLowerCase()}.`;
}

function ProjectCard({
  card,
  computedAt,
  index,
}: {
  card: OffClockLabCard;
  computedAt: string;
  index: number;
}) {
  const { lab } = card;

  return (
    <a
      className="hor-card hor-rise offclock-card offclock-project"
      href={`/labs#lab-${lab.slug}`}
      style={{ "--hor-delay": `${80 + index * 70}ms` } as CSSProperties}
    >
      <LabArtwork lab={lab} />

      <div className="offclock-card-body">
        <div className="flex items-center justify-between gap-3">
          <span className="hor-eyebrow">{card.label}</span>
          <span className="offclock-badge">{card.role === "favorite" ? "Picked" : "Live"}</span>
        </div>
        <h3 className="offclock-title">{lab.title}</h3>
        <p className="hor-body offclock-summary">{lab.summary}</p>
      </div>

      {card.statsFresh ? (
        <dl className="offclock-project-stats">
          <div>
            <dt>Language</dt>
            <dd>{lab.language}</dd>
          </div>
          <div>
            <dt>Commits · 12 mo</dt>
            <dd>{num(lab.liveStats.commitsYear)}</dd>
          </div>
          <div>
            <dt>Last push</dt>
            <dd>{relativeDays(lab.liveStats.lastPushDaysAgo)}</dd>
          </div>
        </dl>
      ) : (
        <div className="offclock-stale">
          <span className="hor-label">{lab.language}</span>
          <p>{staleSyncMessage(card, computedAt)}</p>
        </div>
      )}

      <span className="offclock-link">
        View in Labs
        <ArrowRight />
      </span>
    </a>
  );
}

function MovementCard({ movement, index }: { movement: OffClockMovementCard; index: number }) {
  return (
    <article
      className="hor-card hor-rise offclock-card offclock-movement"
      style={{ "--hor-delay": `${80 + index * 70}ms` } as CSSProperties}
    >
      <div className="offclock-card-body">
        <div className="flex items-center justify-between gap-3">
          <span className="hor-eyebrow">Seven-day movement</span>
          <span className="offclock-badge">HealthKit</span>
        </div>
        <h3 className="offclock-title">A week on foot</h3>
        <p className="hor-body offclock-summary">
          Peak day: {movement.peakDay.label}, with {num(movement.peakDay.steps ?? 0)} steps.
          Today&apos;s bar is still in motion.
        </p>
      </div>

      <div className="offclock-chart" aria-label="Steps over the last seven Sydney days">
        {movement.days.map((day) => {
          const state = day.steps === null ? "missing" : day.steps === 0 ? "zero" : "measured";
          const label =
            day.steps === null
              ? `${day.label}: no HealthKit sync`
              : `${day.label}: ${num(day.steps)} steps${day.isToday ? ", today so far" : ""}`;

          return (
            <div className="offclock-day" key={day.date}>
              <div className="offclock-bar-track">
                <span
                  className="offclock-bar"
                  data-state={state}
                  data-peak={day.isPeak ? "true" : "false"}
                  style={{ "--offclock-share": day.share } as CSSProperties}
                  role="img"
                  aria-label={label}
                />
              </div>
              <span className="offclock-day-label" data-today={day.isToday ? "true" : "false"}>
                {day.label.slice(0, 1)}
              </span>
            </div>
          );
        })}
      </div>

      <dl className="offclock-movement-stats">
        <div>
          <dt>Steps</dt>
          <dd>{num(movement.totalSteps)}</dd>
        </div>
        <div>
          <dt>Kilometres</dt>
          <dd>{movement.totalDistanceKm.toFixed(1)}</dd>
        </div>
        <div>
          <dt>Workouts</dt>
          <dd>{movement.totalWorkouts}</dd>
        </div>
      </dl>
    </article>
  );
}

/**
 * The homepage's personal dashboard. Its three roles are server-derived from
 * the same live snapshot as the rest of the page, so the section adds no
 * browser data client and no hydration boundary.
 */
export function LifeStrip({
  labs,
  favoriteLabSlug,
  healthStats,
  computedAt,
  location,
}: {
  labs: readonly Lab[];
  favoriteLabSlug: string | null;
  healthStats: HealthStats | null;
  computedAt: string;
  location: string;
}) {
  const dashboard = deriveOffClockDashboard({
    labs,
    favoriteLabSlug,
    healthStats,
    computedAt,
  });
  const projectCards = [dashboard.favorite, dashboard.ranked].filter(
    (card): card is OffClockLabCard => card !== null,
  );
  const cardCount = projectCards.length + (dashboard.movement ? 1 : 0);

  if (cardCount === 0) return null;

  return (
    <section id="off-the-clock" className="offclock-section">
      <SkyHead
        index="04"
        eyebrow="Off the clock"
        lede="One favourite, one live pulse from the side-project pile, and seven days of movement straight from the phone."
        aside={<span className="hor-micro">{location} · live</span>}
      />

      <div className="offclock-grid" data-count={cardCount}>
        {projectCards.map((card, index) => (
          <ProjectCard
            key={`${card.role}-${card.lab.slug}`}
            card={card}
            computedAt={computedAt}
            index={index}
          />
        ))}
        {dashboard.movement ? (
          <MovementCard movement={dashboard.movement} index={projectCards.length} />
        ) : null}
      </div>
    </section>
  );
}
