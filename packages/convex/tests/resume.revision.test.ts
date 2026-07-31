import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { MutationCtx } from '../convex/_generated/server';
import { rebuildResumeExperience } from '../convex/resume';

const projectedRole = {
  company: 'Example Co',
  title: 'Principal Engineer',
  start: '2024',
  end: 'Present',
  summary: 'Built the important things.',
  highlights: ['Shipped safely'],
  skills: ['TypeScript'],
};

const experienceEntry = {
  _id: 'experience-entry-1',
  _creationTime: 1,
  revision: 1,
  company: projectedRole.company,
  title: projectedRole.title,
  startDate: '2024-01-01',
  endDate: null,
  summary: projectedRole.summary,
  highlights: projectedRole.highlights,
  skills: projectedRole.skills,
  sortOrder: 0,
};

function contextFor(document: Record<string, unknown> | null) {
  const patches: Array<{ id: unknown; value: unknown }> = [];
  const ctx = {
    db: {
      query: (table: string) => {
        if (table === 'experienceEntries') {
          return {
            withIndex: () => ({
              order: () => ({ collect: async () => [experienceEntry] }),
            }),
          };
        }

        return {
          order: () => ({ first: async () => document }),
        };
      },
      patch: async (id: unknown, value: unknown) => {
        patches.push({ id, value });
      },
    },
  } as unknown as MutationCtx;

  return { ctx, patches };
}

describe('rebuildResumeExperience revision contract', () => {
  it('reports an absent singleton without inventing a revision', async () => {
    const { ctx, patches } = contextFor(null);

    const result = await rebuildResumeExperience(ctx);

    assert.deepEqual(result, {
      documentId: null,
      roles: 1,
      synced: false,
      changed: false,
      revision: null,
    });
    assert.deepEqual(patches, []);
  });

  it('keeps the current revision when the projection is already equal', async () => {
    const { ctx, patches } = contextFor({
      _id: 'resume-1',
      revision: 7,
      experience: [projectedRole],
    });

    const result = await rebuildResumeExperience(ctx);

    assert.equal(result.changed, false);
    assert.equal(result.revision, 7);
    assert.deepEqual(patches, []);
  });

  it('bumps and returns the revision when it writes a new projection', async () => {
    const { ctx, patches } = contextFor({
      _id: 'resume-1',
      revision: 7,
      experience: [],
    });

    const result = await rebuildResumeExperience(ctx);

    assert.equal(result.changed, true);
    assert.equal(result.revision, 8);
    assert.deepEqual(patches, [
      {
        id: 'resume-1',
        value: { experience: [projectedRole], revision: 8 },
      },
    ]);
  });
});
