import type { HealthActivity } from "@/lib/snapshot";

const dateFormatter = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Sydney",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

function duration(minutes: number): string {
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return remainder === 0 ? `${hours} h` : `${hours} h ${remainder} min`;
}

/** Discrete workouts reported by Apple Health, kept separate from editorial Fun entries. */
export function HealthActivityFeed({ activities }: { activities: HealthActivity[] }) {
  if (activities.length === 0) return null;

  return (
    <section className="fun-health hor-rise mt-10" aria-labelledby="health-activities-title">
      <div className="fun-band-head">
        <span className="hor-eyebrow" id="health-activities-title">
          Health activities
        </span>
        <span className="fun-band-rule" />
        <span className="hor-label">Apple Health · recent 7 days</span>
      </div>

      <div className="fun-health-grid">
        {activities.map((activity) => (
          <article key={activity.id} className="hor-card fun-health-card">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="hor-eyebrow">{activity.kind}</span>
                <h2 className="fun-title mt-2">{activity.title}</h2>
              </div>
              <span className="fun-health-mark" data-kind={activity.kind} aria-hidden="true" />
            </div>
            <dl className="fun-health-readout">
              <div>
                <dt>When</dt>
                <dd>{dateFormatter.format(new Date(activity.startedAt))}</dd>
              </div>
              <div>
                <dt>Duration</dt>
                <dd>{duration(activity.durationMinutes)}</dd>
              </div>
              {activity.distanceKm === undefined ? null : (
                <div>
                  <dt>Distance</dt>
                  <dd>{activity.distanceKm.toFixed(2)} km</dd>
                </div>
              )}
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}
