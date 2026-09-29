import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
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

test('warns when has_docs_site is false while links imply docs presence', () => {
  const dir = makeRepo({ [CONFIG_RELATIVE_PATH]: 'links:\n  homepage: https://example.com\nartifacts:\n  has_docs_site: false\n' });
  try {
    const loaded = loadConfig(dir);
    const warning = loaded.warnings.find((w) => w.code === 'config.docs_site_overridden');
    assert.ok(warning, `expected a docs_site_overridden warning, got: ${JSON.stringify(loaded.warnings)}`);
    assert.match(warning.message, /docs axis stays enabled/);
    assert.equal(loaded.config.artifacts.has_docs_site, false);
  } finally {
    removeRepo(dir);
  }
});

test('no docs_site warning when has_docs_site is true or no docs links exist', () => {
  const withSite = makeRepo({ [CONFIG_RELATIVE_PATH]: 'links:\n  homepage: https://example.com\nartifacts:\n  has_docs_site: true\n' });
  const withoutLinks = makeRepo({ [CONFIG_RELATIVE_PATH]: 'artifacts:\n  has_docs_site: false\n' });
  try {
    for (const dir of [withSite, withoutLinks]) {
      const loaded = loadConfig(dir);
      assert.equal(loaded.warnings.filter((w) => w.code === 'config.docs_site_overridden').length, 0);
    }
  } finally {
    removeRepo(withSite);
    removeRepo(withoutLinks);
  }
});

test('warns when the config carries a foreign schema_version', () => {
  const dir = makeRepo({ [CONFIG_RELATIVE_PATH]: 'schema_version: 2\n' });
  try {
    const loaded = loadConfig(dir);
    const warning = loaded.warnings.find((w) => w.code === 'config.schema_version');
    assert.ok(warning, `expected a schema_version warning, got: ${JSON.stringify(loaded.warnings)}`);
    assert.match(warning.message, /schema_version 2/);
  } finally {
    removeRepo(dir);
  }
});

test('schema_version defaults to 1 without a warning', () => {
  const dir = makeRepo({ [CONFIG_RELATIVE_PATH]: 'schema_version: 1\n' });
  try {
    const loaded = loadConfig(dir);
    assert.equal(loaded.config.schema_version, 1);
    assert.equal(loaded.warnings.filter((w) => w.code === 'config.schema_version').length, 0);
  } finally {
    removeRepo(dir);
  }
});

test('buildSeedConfig seeds copyright_holder from the git owner', () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ name: 'seed-holder', description: 'Seeded holder' }) });
  try {
    execSync('git init -q . && git remote add origin git@github.com:seed-owner/seed-holder.git', { cwd: dir });
    const seed = buildSeedConfig(dir);
    assert.equal(seed.project.copyright_holder, 'seed-owner');
  } finally {
    removeRepo(dir);
  }
});

test('buildSeedConfig keeps a configured copyright_holder over the git owner', () => {
  const dir = makeRepo({
    'package.json': JSON.stringify({ name: 'keep-holder' }),
    [CONFIG_RELATIVE_PATH]: 'project:\n  copyright_holder: "Ada Lovelace"\n',
  });
  try {
    execSync('git init -q . && git remote add origin git@github.com:seed-owner/keep-holder.git', { cwd: dir });
    const seed = buildSeedConfig(dir);
    assert.equal(seed.project.copyright_holder, 'Ada Lovelace');
  } finally {
    removeRepo(dir);
  }
});
