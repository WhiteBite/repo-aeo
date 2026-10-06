import test from 'node:test';
import assert from 'node:assert/strict';

import { renderClaudeMarketplace, renderCodexMarketplace } from '../src/distribution/artifacts/marketplaceJson.js';

test('renderClaudeMarketplace with copyright holder', () => {
  const config = { project: { name: 'Repo AEO Kit', copyright_holder: 'WhiteBite' }, links: {} };
  const doc = renderClaudeMarketplace(config, { name: 'repo-aeo' });
  assert.deepEqual(doc, {
    name: 'repo-aeo-kit',
    owner: 'WhiteBite',
    plugins: [{ name: 'repo-aeo-kit', source: './' }],
  });
});

test('renderClaudeMarketplace is deterministic', () => {
  const config = { project: { name: 'Repo AEO Kit', copyright_holder: 'WhiteBite' }, links: {} };
  assert.deepEqual(renderClaudeMarketplace(config, {}), renderClaudeMarketplace(config, {}));
});

test('owner derived from links.issues github URL', () => {
  const config = {
    project: { name: 'thing' },
    links: { issues: 'https://github.com/acme-org/thing/issues' },
  };
  const doc = renderClaudeMarketplace(config, {});
  assert.equal(doc.owner, 'acme-org');
});

test('owner omitted when no holder and no github link', () => {
  const config = { project: { name: 'thing' }, links: { homepage: 'https://example.com' } };
  const doc = renderClaudeMarketplace(config, {});
  assert.ok(!('owner' in doc));
});

test('slug: spaced name and missing name fallback', () => {
  const spaced = renderClaudeMarketplace({ project: { name: 'My Project' } }, {});
  assert.equal(spaced.name, 'my-project');
  const missing = renderClaudeMarketplace({}, {});
  assert.equal(missing.name, 'project');
});

test('renderCodexMarketplace entry carries manual policy', () => {
  const config = { project: { name: 'thing', copyright_holder: 'acme' }, links: {} };
  const doc = renderCodexMarketplace(config, {});
  assert.deepEqual(doc.plugins[0], { name: 'thing', source: './', policy: { installation: 'manual' } });
  assert.equal(doc.owner, 'acme');
});
