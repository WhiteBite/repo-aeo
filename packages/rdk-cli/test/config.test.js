import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, buildSeedConfig, suggestTopics, CONFIG_RELATIVE_PATH } from '../src/config.js';
import { makeRepo, removeRepo } from './helpers.js';

const PROJECT_YML = `project:
  name: demo
  one_liner: A demo project
  category: tool
audiences:
  - developers
use_cases:
  - one
  - two
keywords:
  github_topics:
    - CLI
    - "developer tools"
  npm_keywords:
    - demo
links:
  homepage: https://example.com
quickstart:
  install: npm install demo
  run: npm start
artifacts:
  has_npm_package: true
  has_docs_site: true
`;

test('loads a project.yml and reports its path', () => {
  const dir = makeRepo({ [CONFIG_RELATIVE_PATH]: PROJECT_YML, 'package.json': '{"name":"demo","description":"A demo project"}' });
  try {
    const loaded = loadConfig(dir);
    assert.equal(loaded.exists, true);
    assert.equal(loaded.config.project.name, 'demo');
    assert.equal(loaded.config.links.homepage, 'https://example.com');
    assert.equal(loaded.config.artifacts.has_npm_package, true);
    assert.equal(loaded.config.safety.allow_autofix, false);
  } finally {
    removeRepo(dir);
  }
});

test('reports a parse error as a warning instead of crashing', () => {
  const dir = makeRepo({ [CONFIG_RELATIVE_PATH]: 'project:\n\tname: broken\n' });
  try {
    const loaded = loadConfig(dir);
    assert.equal(loaded.warnings.length, 1);
    assert.match(loaded.warnings[0].message, /tabs/);
  } finally {
    removeRepo(dir);
  }
});

test('falls back to package.json facts when the config is absent', () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ name: 'from-pkg', description: 'From package.json', homepage: 'https://pkg.example', keywords: ['a', 'b'] }) });
  try {
    const loaded = loadConfig(dir);
    assert.equal(loaded.exists, false);
    assert.equal(loaded.config.project.name, 'from-pkg');
    assert.equal(loaded.config.project.description, 'From package.json');
    assert.equal(loaded.config.links.homepage, 'https://pkg.example');
    assert.equal(loaded.config.artifacts.has_npm_package, true);
  } finally {
    removeRepo(dir);
  }
});

test('buildSeedConfig derives quickstart commands from package.json scripts', () => {
  const dir = makeRepo({
    'package.json': JSON.stringify({ name: 'seeded', description: 'Seeded project', scripts: { start: 'node .', test: 'node --test' } }),
  });
  try {
    const seed = buildSeedConfig(dir);
    assert.equal(seed.project.name, 'seeded');
    assert.equal(seed.quickstart.install, 'npm install seeded');
    assert.equal(seed.quickstart.run, 'npm run start');
    assert.equal(seed.quickstart.test, 'npm run test');
    assert.deepEqual(seed.quickstart.prerequisites, ['Node.js >= 18']);
    assert.ok(seed.keywords.github_topics.length >= 4);
  } finally {
    removeRepo(dir);
  }
});

test('suggestTopics produces canonical lowercase topics', () => {
  const topics = suggestTopics({ name: 'Demo Widget', category: 'library' }, { name: '@scope/demo-widget', keywords: ['LLMs', 'Agent Tools'] });
  assert.ok(topics.every((topic) => /^[a-z0-9-]+$/.test(topic)), `non-canonical topics: ${topics.join(', ')}`);
  assert.ok(topics.includes('library'));
  assert.ok(topics.includes('demo'));
  assert.ok(topics.includes('widget'));
});
