import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveOffClockDashboard } from "@/lib/derive";
import type { HealthStats, Lab } from "@/lib/snapshot";

const computedAt = "2026-08-05T02:07:00.000Z";

function lab({
  slug,
  commits,
  pushedAt = "2026-08-05T01:00:00.000Z",
  syncedAt = "2026-08-05T01:30:00.000Z",
}: {
  slug: string;
  commits: number;
  pushedAt?: string;
  syncedAt?: string;
}): Lab {
  return {
    slug,
    title: slug === "home" ? "coreybaines.com" : slug,
    summary: `${slug} summary`,
    repoFullName: `coreybain/${slug}`,
    language: "TypeScript",
    liveStats: {
      stars: 0,
      forks: 0,
      commitsYear: commits,
      lastPushDaysAgo: 0,
      lastPushedAt: pushedAt,
      syncedAt,
    },
    featured: true,
  };
}

const healthStats: HealthStats = {
  latestDay: {
    date: "2026-08-05",
    steps: 0,
    distanceKm: 0,
    activities: [],
  },
  sevenDayAverageSteps: 3_042,
  recentDays: [
    { date: "2026-07-30", steps: 3_100, distanceKm: 2.4, activities: [] },
    { date: "2026-08-02", steps: 2_900, distanceKm: 1.9, activities: [] },
    {
      date: "2026-08-04",
      steps: 4_800,
      distanceKm: 4.07,
      activities: [
        {
          id: "walk-1",
          kind: "walking",
          title: "Walking",
          startedAt: "2026-08-04T04:08:00.000Z",
          durationMinutes: 57,
          distanceKm: 4.07,
        },
      ],
    },
    { date: "2026-08-05", steps: 0, distanceKm: 0, activities: [] },
  ],
  syncedAt: "2026-08-05T01:55:00.000Z",
};

describe("deriveOffClockDashboard", () => {
  it("shows the explicit favorite and uses the freshest distinct Lab when it is busiest", () => {
    const dashboard = deriveOffClockDashboard({
      labs: [
        lab({ slug: "partybooth", commits: 68 }),
        lab({
          slug: "home",
          commits: 36,
          pushedAt: "2026-08-05T01:30:00.000Z",
        }),
        lab({
          slug: "older",
          commits: 50,
          pushedAt: "2026-08-04T12:00:00.000Z",
        }),
      ],
      favoriteLabSlug: "partybooth",
      healthStats: null,
      computedAt,
    });

    assert.equal(dashboard.favorite?.lab.slug, "partybooth");
    assert.equal(dashboard.favorite?.statsFresh, true);
    assert.equal(dashboard.ranked?.lab.slug, "home");
    assert.equal(dashboard.ranked?.label, "Fresh pulse");
  });

  it("keeps a stale favorite but suppresses its stats and ranks fresh Labs only", () => {
    const dashboard = deriveOffClockDashboard({
      labs: [
        lab({
          slug: "partybooth",
          commits: 500,
          syncedAt: "2026-08-01T01:00:00.000Z",
        }),
        lab({ slug: "home", commits: 36 }),
      ],
      favoriteLabSlug: "partybooth",
      healthStats: null,
      computedAt,
    });

    assert.equal(dashboard.favorite?.lab.slug, "partybooth");
    assert.equal(dashboard.favorite?.statsFresh, false);
    assert.equal(dashboard.ranked?.lab.slug, "home");
    assert.equal(dashboard.ranked?.label, "Most commits");
  });

  it("omits the ranked role when no distinct Lab has fresh public stats", () => {
    const dashboard = deriveOffClockDashboard({
      labs: [lab({ slug: "partybooth", commits: 68 })],
      favoriteLabSlug: "partybooth",
      healthStats: null,
      computedAt,
    });

    assert.equal(dashboard.favorite?.lab.slug, "partybooth");
    assert.equal(dashboard.ranked, null);
  });

  it("builds seven Sydney-day slots and distinguishes missing days from zero", () => {
    const dashboard = deriveOffClockDashboard({
      labs: [],
      favoriteLabSlug: null,
      healthStats,
      computedAt,
    });
    const movement = dashboard.movement!;

    assert.deepEqual(
      movement.days.map((day) => day.date),
      [
        "2026-07-30",
        "2026-07-31",
        "2026-08-01",
        "2026-08-02",
        "2026-08-03",
        "2026-08-04",
        "2026-08-05",
      ],
    );
    assert.equal(movement.days[1]?.steps, null);
    assert.equal(movement.days[6]?.steps, 0);
    assert.equal(movement.days[6]?.isToday, true);
    assert.equal(movement.peakDay.date, "2026-08-04");
    assert.equal(movement.totalSteps, 10_800);
    assert.equal(movement.totalDistanceKm, 8.4);
    assert.equal(movement.totalWorkouts, 1);
  });

  it("omits movement when HealthKit has no usable day in the window", () => {
    const dashboard = deriveOffClockDashboard({
      labs: [],
      favoriteLabSlug: null,
      healthStats: {
        ...healthStats,
        recentDays: [
          { date: "2026-07-01", steps: 100, distanceKm: 0.1, activities: [] },
        ],
      },
      computedAt,
    });

    assert.equal(dashboard.movement, null);
  });
});
