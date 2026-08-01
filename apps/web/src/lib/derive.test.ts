import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveFun } from "@/lib/derive";
import type { FunLogEntry, HealthStats } from "@/lib/snapshot";

const computedAt = "2026-08-01T00:00:00.000Z";

const healthStats: HealthStats = {
  latestDay: {
    date: "2026-08-01",
    steps: 2_000,
    distanceKm: 1.25,
    activities: [
      {
        id: "gym-1",
        kind: "gym",
        title: "Strength training",
        startedAt: "2026-08-01T08:00:00.000Z",
        durationMinutes: 45,
      },
    ],
  },
  sevenDayAverageSteps: 1_500,
  recentDays: [
    {
      date: "2026-07-31",
      steps: 1_000,
      distanceKm: 2.5,
      activities: [
        {
          id: "walk-activity-1",
          kind: "walking",
          title: "Walking",
          startedAt: "2026-07-31T09:00:00.000Z",
          durationMinutes: 30,
          distanceKm: 2.5,
        },
      ],
    },
    {
      date: "2026-08-01",
      steps: 2_000,
      distanceKm: 1.25,
      activities: [
        {
          id: "gym-1",
          kind: "gym",
          title: "Strength training",
          startedAt: "2026-08-01T08:00:00.000Z",
          durationMinutes: 45,
        },
      ],
    },
  ],
  syncedAt: "2026-08-01T00:05:00.000Z",
};

const loggedWalk: FunLogEntry = {
  id: "walk-1",
  type: "walk",
  title: "Evening walk",
  steps: 99_999,
  km: 99,
  daysAgo: 0,
};

describe("deriveFun HealthKit totals", () => {
  it("uses only iPhone health days for the public movement totals", () => {
    const { tally } = deriveFun([loggedWalk], computedAt, healthStats);

    assert.equal(tally.steps, 3_000);
    assert.equal(tally.km, 3.8);
    assert.equal(tally.healthDays, 2);
    assert.equal(tally.healthActivities, 2);
    assert.equal(tally.activityCounts.walking, 1);
    assert.equal(tally.activityCounts.gym, 1);
    assert.equal(tally.longestKm, 99);
  });

  it("does not turn manually logged walks into a HealthKit fallback", () => {
    const { tally } = deriveFun([loggedWalk], computedAt, null);

    assert.equal(tally.steps, 0);
    assert.equal(tally.km, 0);
    assert.equal(tally.healthDays, 0);
    assert.equal(tally.healthActivities, 0);
    assert.equal(tally.activityCounts.walking, 0);
  });

  it("returns HealthKit activities newest first without counting a manual walk", () => {
    const { healthActivities, tally } = deriveFun([loggedWalk], computedAt, healthStats);

    assert.deepEqual(
      healthActivities.map((activity) => activity.id),
      ["gym-1", "walk-activity-1"],
    );
    assert.equal(tally.activityCounts.walking, 1);
    assert.equal(tally.counts.walk, 1);
  });
});
