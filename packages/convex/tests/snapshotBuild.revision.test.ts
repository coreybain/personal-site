import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { labStatsMateriallyEqual } from '../convex/snapshotBuild';

describe('snapshot cron revision boundary', () => {
  it('treats a syncedAt-only refresh as no material lab-stat change', () => {
    assert.equal(
      labStatsMateriallyEqual(
        {
          stars: 12,
          forks: 3,
          commitsYear: 44,
          lastPushDaysAgo: 2,
          lastPushedAt: '2026-07-29T00:00:00.000Z',
          syncedAt: '2026-07-31T00:00:00.000Z',
        },
        {
          stars: 12,
          forks: 3,
          commitsYear: 44,
          lastPushDaysAgo: 2,
          lastPushedAt: '2026-07-29T00:00:00.000Z',
          syncedAt: '2026-07-31T01:00:00.000Z',
        },
      ),
      true,
    );
  });

  it('detects a GitHub fact that actually changed', () => {
    assert.equal(
      labStatsMateriallyEqual(
        { stars: 12, forks: 3, commitsYear: 44, lastPushDaysAgo: 2 },
        { stars: 13, forks: 3, commitsYear: 44, lastPushDaysAgo: 2 },
      ),
      false,
    );
  });
});
