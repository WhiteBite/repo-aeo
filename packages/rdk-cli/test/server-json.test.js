import test from 'node:test';
import assert from 'node:assert/strict';
import { renderServerJson, mcpOwnershipMarker } from '../src/distribution/artifacts/serverJson.js';

const config = {
  project: { name: 'Repo AEO', one_liner: 'Findable repos', description: 'long desc' },
  links: { repository: 'https://github.com/WhiteBite/repo-aeo', homepage: 'https://example.com' },
};
const pkg = { name: 'repo-aeo', version: '1.2.3', description: 'pkg desc' };

test('renders a minimal valid doc', () => {
  assert.deepStrictEqual(renderServerJson(config, pkg), {
    name: 'Repo AEO',
    description: 'Findable repos',
    version: '1.2.3',
    packages: [{ registry_type: 'npm', identifier: 'repo-aeo', version: '1.2.3' }],
    repository: { url: 'https://github.com/WhiteBite/repo-aeo' },
  });
});

test('deterministic across calls', () => {
  assert.deepStrictEqual(renderServerJson(config, pkg), renderServerJson(config, pkg));
});

test('no repository key when no url is derivable', () => {
  const doc = renderServerJson({ project: { name: 'x' } }, {});
  assert.equal('repository' in doc, false);
});

test('description falls back one_liner -> description -> pkg.description', () => {
  assert.equal(renderServerJson({ project: { one_liner: 'a', description: 'b' } }, pkg).description, 'a');
  assert.equal(renderServerJson({ project: { description: 'b' } }, pkg).description, 'b');
  assert.equal(renderServerJson({}, pkg).description, 'pkg desc');
});

test('name falls back project.name -> pkg.name', () => {
  assert.equal(renderServerJson({ project: { name: 'p' } }, pkg).name, 'p');
  assert.equal(renderServerJson({}, pkg).name, 'repo-aeo');
});

test('signature identifier uses pkg.name even when project.name differs', () => {
  const doc = renderServerJson({ project: { name: 'Pretty Name' } }, pkg);
  assert.equal(doc.name, 'Pretty Name');
  assert.equal(doc.packages[0].identifier, 'repo-aeo');
});

test('mcpOwnershipMarker returns the name as a string', () => {
  assert.equal(mcpOwnershipMarker('repo-aeo'), 'repo-aeo');
  assert.equal(typeof mcpOwnershipMarker(42), 'string');
});

test('mcpOwnershipMarker builds the reverse-DNS marker when the owner is known', () => {
  assert.equal(mcpOwnershipMarker('repo-aeo', 'WhiteBite'), 'io.github.WhiteBite/repo-aeo');
});

test('mcpOwnershipMarker returns the bare name when no owner is known', () => {
  assert.equal(mcpOwnershipMarker('repo-aeo', null), 'repo-aeo');
  assert.equal(mcpOwnershipMarker('repo-aeo', ''), 'repo-aeo');
});

test('renderServerJson uses pkg.mcpName when present', () => {
  const doc = renderServerJson(config, { ...pkg, mcpName: 'io.github.WhiteBite/repo-aeo' });
  assert.equal(doc.name, 'io.github.WhiteBite/repo-aeo');
});

test('renderServerJson derives the marker from a github.com link when mcpName is absent', () => {
  const cfg = { project: { name: 'demo' }, links: { homepage: 'https://github.com/acme/demo#readme' } };
  assert.equal(renderServerJson(cfg, { name: 'demo', version: '1.0.0' }).name, 'io.github.acme/demo');
});

test('renderServerJson falls back to copyright_holder when no github link yields an owner', () => {
  const cfg = { project: { name: 'demo', copyright_holder: 'acme' }, links: { homepage: 'https://example.com' } };
  assert.equal(renderServerJson(cfg, { name: 'demo', version: '1.0.0' }).name, 'io.github.acme/demo');
});
