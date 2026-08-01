import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  labStatsMateriallyEqual,
  projectAiStatsUpdates,
} from '../convex/snapshotBuild';

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

describe('project AI stats reconciliation', () => {
  it('clears a stored value when the project is absent from the live fold', () => {
    const project = {
      slug: 'travel-docs',
      aiBuildStats: { sessions: 308, hours: 202 },
    };

    assert.deepEqual(projectAiStatsUpdates([project], new Map()), [
      { project, next: undefined },
    ]);
  });

  it('rounds and updates current folded totals without rewriting equal rows', () => {
    const stale = {
      slug: 'quotecloud',
      aiBuildStats: { sessions: 412, hours: 270 },
    };
    const current = {
      slug: 'zerorisk',
      aiBuildStats: { sessions: 3, hours: 13 },
    };
    const fold = new Map([
      ['quotecloud', { sessions: 39, hours: 23.4 }],
      ['zerorisk', { sessions: 3, hours: 13 }],
    ]);

    assert.deepEqual(projectAiStatsUpdates([stale, current], fold), [
      { project: stale, next: { sessions: 39, hours: 23 } },
    ]);
  });
});
