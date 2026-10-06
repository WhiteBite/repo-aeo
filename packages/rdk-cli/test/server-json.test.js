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
