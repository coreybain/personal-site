import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FeaturedLabs } from './FeaturedLabs';

it('does not render a featured Pathway plate when no Labs are published', () => {
  assert.equal(renderToStaticMarkup(createElement(FeaturedLabs, { labs: [] })), '');
});
