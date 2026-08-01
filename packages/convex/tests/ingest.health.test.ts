import { describe, expect, test } from 'bun:test';

import { parseHealthBody } from '../convex/ingest';

const envelope = {
  source: 'healthkit',
  postedAt: '2026-08-01T02:00:00.000Z',
};

describe('HealthKit ingest activities', () => {
  test('accepts privacy-bounded walking and gym workouts', () => {
    const parsed = parseHealthBody({
      ...envelope,
      days: [
        {
          day: '2026-08-01',
          steps: 4_200,
          distanceKm: 3.1,
          activities: [
            {
              id: 'workout-walk',
              kind: 'walking',
              title: 'Walking',
              startedAt: '2026-08-01T00:00:00.000Z',
              durationMinutes: 32.5,
              distanceKm: 2.7,
            },
            {
              id: 'workout-gym',
              kind: 'gym',
              title: 'Strength training',
              startedAt: '2026-08-01T01:00:00.000Z',
              durationMinutes: 45,
            },
          ],
        },
      ],
    });

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.days[0]?.activities).toHaveLength(2);
      expect(parsed.value.days[0]?.activities[1]?.distanceKm).toBeUndefined();
    }
  });

  test('normalises a steps-only phone payload during rollout', () => {
    const parsed = parseHealthBody({
      ...envelope,
      days: [{ day: '2026-08-01', steps: 10, distanceKm: 0.01 }],
    });

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.days[0]?.activities).toEqual([]);
  });

  test('rejects duplicate workout ids across the same replacement push', () => {
    const parsed = parseHealthBody({
      ...envelope,
      days: [
        {
          day: '2026-08-01',
          steps: 10,
          distanceKm: 0.01,
          activities: [
            {
              id: 'duplicate',
              kind: 'walking',
              title: 'Walking',
              startedAt: '2026-08-01T00:00:00.000Z',
              durationMinutes: 10,
            },
            {
              id: 'duplicate',
              kind: 'gym',
              title: 'Gym',
              startedAt: '2026-08-01T01:00:00.000Z',
              durationMinutes: 10,
            },
          ],
        },
      ],
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.problem.field).toBe('days[0].activities[1].id');
  });
});
