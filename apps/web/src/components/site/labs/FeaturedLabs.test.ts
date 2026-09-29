import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FeaturedLabs } from './FeaturedLabs';

it('does not render a featured Pathway plate when no Labs are published', () => {
  assert.equal(renderToStaticMarkup(createElement(FeaturedLabs, { labs: [] })), '');
});

it('renders a website-only Lab with its website link and no repository or telemetry', () => {
  const html = renderToStaticMarkup(
    createElement(FeaturedLabs, {
      labs: [],
      websiteLabs: [
        {
          slug: 'uploadfile',
          title: 'Uploadfile',
          summary: 'A private-source product.',
          language: 'TypeScript',
          links: { live: 'https://www.uploadfile.dev/' },
          featured: true,
        },
      ],
    }),
  );
  assert.match(html, /Uploadfile/);
  assert.match(html, /href="https:\/\/www\.uploadfile\.dev\/"/);
  assert.match(html, /Visit the website/);
  assert.doesNotMatch(html, /github\.com/);
  assert.doesNotMatch(html, /View the repository|Last push|Cadence/);
});
