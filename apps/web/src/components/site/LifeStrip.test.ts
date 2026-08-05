import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildLifeCards } from "@/components/site/LifeStrip";
import type { FunEntry, HealthStats } from "@/lib/snapshot";

const computedAt = "2026-08-05T02:07:00.000Z";

const healthStats: HealthStats = {
  latestDay: {
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
  sevenDayAverageSteps: 3_042,
  recentDays: [
    { date: "2026-08-02", steps: 3_100, distanceKm: 2.4, activities: [] },
    { date: "2026-08-03", steps: 2_900, distanceKm: 1.9, activities: [] },
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
  ],
  syncedAt: "2026-08-05T01:55:00.000Z",
};

describe("buildLifeCards", () => {
  it("fills the homepage strip from live HealthKit days", () => {
    const cards = buildLifeCards([], healthStats, computedAt);

    assert.equal(cards.length, 3);
    assert.deepEqual(
      cards.map((card) => card.title),
      ["Tuesday movement", "Monday movement", "Sunday movement"],
    );
    assert.equal(cards[0]?.kind, "HealthKit");
    assert.equal(cards[0]?.when, "Yesterday");
    assert.equal(cards[0]?.detail, "4,800 steps · 4.1 km · 1 workout");
  });

  it("merges editorial entries by recency and caps the strip at three cards", () => {
    const entry: FunEntry = {
      id: "coffee-1",
      type: "coffee",
      title: "Flat white — Single O",
      note: "Before stand-up",
      daysAgo: 0,
    };

    const cards = buildLifeCards([entry], healthStats, computedAt);

    assert.equal(cards.length, 3);
    assert.equal(cards[0]?.title, "Flat white — Single O");
    assert.equal(cards[1]?.title, "Tuesday movement");
    assert.equal(cards[2]?.title, "Monday movement");
  });

  it("returns no cards when neither source has data", () => {
    assert.deepEqual(buildLifeCards([], null, computedAt), []);
  });
});
