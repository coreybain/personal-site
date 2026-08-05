import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveFavoriteLabSlug } from '../convex/siteSettings';

describe('site settings favorite Lab write contract', () => {
  it('preserves a selection when an older whole-record writer omits the field', () => {
    assert.equal(resolveFavoriteLabSlug('partybooth', undefined), 'partybooth');
  });

  it('stores a selection supplied by a current editor', () => {
    assert.equal(
      resolveFavoriteLabSlug(undefined, 'coreybaines-com'),
      'coreybaines-com',
    );
  });

  it('clears a selection only when a current editor explicitly sends null', () => {
    assert.equal(resolveFavoriteLabSlug('partybooth', null), undefined);
  });
});
