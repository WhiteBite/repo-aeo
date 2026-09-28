import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { loadConfig, buildSeedConfig } from '../src/config.js';
import { planPatches, applyPatches, PATCHES } from '../src/fix/patches.js';
import { makeRepo, removeRepo } from './helpers.js';

function contextFor(dir) {
  const loaded = loadConfig(dir);
  return {
    cwd: dir,
    options: {},
    config: loaded.config,
    configExists: loaded.exists,
    pkg: loaded.pkg,
    git: loaded.git,
  };
}

test('every patch is declared with a unique id and a risk level', () => {
  const ids = PATCHES.map((patch) => patch.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const patch of PATCHES) {
    assert.equal(typeof patch.applies, 'function');
    assert.equal(typeof patch.mutations, 'function');
    assert.ok(['safe', 'needs-review'].includes(patch.risk), `${patch.id} has risk ${patch.risk}`);
  }
});

test('init on an empty repo writes the config, README, AGENTS.md and llms.txt', () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ name: 'fresh', description: 'A fresh project', scripts: { test: 'node --test' } }) });
  try {
    const seed = buildSeedConfig(dir);
    const ctx = { cwd: dir, options: {}, config: seed, configExists: false, pkg: loadConfig(dir).pkg, git: loadConfig(dir).git };
    const planned = planPatches(ctx, { only: ['project.create', 'readme.generate', 'agents.stub', 'llms.generate', 'citation.stub', 'gitignore.entries', 'github.templates'] });
    const ids = planned.map((patch) => patch.id);
    assert.ok(ids.includes('project.create'));
    assert.ok(ids.includes('readme.generate'));
    assert.ok(ids.includes('agents.stub'));
    assert.ok(ids.includes('llms.generate'));

    const written = applyPatches(planned);
    assert.ok(existsSync(join(dir, '.discoverability', 'project.yml')));
    assert.ok(existsSync(join(dir, 'README.md')));
    assert.ok(existsSync(join(dir, 'AGENTS.md')));
    assert.ok(existsSync(join(dir, 'llms.txt')));
    assert.ok(existsSync(join(dir, 'CITATION.cff')));
    assert.ok(existsSync(join(dir, '.github', 'ISSUE_TEMPLATE', 'bug_report.md')));
    assert.ok(written.length >= 6);

    const readme = readFileSync(join(dir, 'README.md'), 'utf8');
    assert.match(readme, /## Quickstart/);
    assert.match(readme, /npm install fresh/);
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    assert.match(agents, /npm run test/);
    assert.match(agents, /Do \/ Don't|Do \/ Don/);
  } finally {
    removeRepo(dir);
  }
});

test('patches are idempotent: a second plan is empty', () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ name: 'idem', description: 'Idempotent', scripts: {} }) });
  try {
    const seed = buildSeedConfig(dir);
    const ctx = { cwd: dir, options: {}, config: seed, configExists: false, pkg: loadConfig(dir).pkg, git: loadConfig(dir).git };
    const first = planPatches(ctx, { only: ['project.create', 'readme.generate', 'agents.stub', 'llms.generate', 'gitignore.entries', 'gitattributes.stub', 'github.templates'] });
    applyPatches(first);

    const loaded = loadConfig(dir);
    const ctx2 = { cwd: dir, options: {}, config: loaded.config, configExists: loaded.exists, pkg: loaded.pkg, git: loaded.git };
    const second = planPatches(ctx2, { only: ['project.create', 'readme.generate', 'agents.stub', 'llms.generate', 'gitignore.entries', 'gitattributes.stub', 'github.templates'] });
    assert.deepEqual(second, [], `expected no further changes, got: ${second.map((p) => p.id).join(', ')}`);
  } finally {
    removeRepo(dir);
  }
});

test('topics normalisation rewrites non-canonical topics', () => {
  const dir = makeRepo({
    '.discoverability/project.yml': `keywords:\n  github_topics:\n    - CLI\n    - "Developer Tools"\n    - cli\n`,
  });
  try {
    const planned = planPatches(contextFor(dir), { only: ['project.topics_normalize'] });
    assert.equal(planned.length, 1);
    applyPatches(planned);
    const text = readFileSync(join(dir, '.discoverability', 'project.yml'), 'utf8');
    assert.match(text, /- "cli"/);
    assert.match(text, /- "developer-tools"/);
    assert.doesNotMatch(text, /- CLI/);
  } finally {
    removeRepo(dir);
  }
});

test('package metadata patch never overwrites existing values', () => {
  const dir = makeRepo({
    '.discoverability/project.yml': `project:\n  one_liner: Configured one-liner\nlinks:\n  homepage: https://configured.example\n  issues: https://github.com/o/r/issues\nkeywords:\n  npm_keywords:\n    - from-config\n`,
    'package.json': JSON.stringify({ name: 'keep', description: 'Existing description', keywords: ['existing'] }, null, 2),
  });
  try {
    const planned = planPatches(contextFor(dir), { only: ['package.metadata', 'package.keywords'] });
    applyPatches(planned);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    assert.equal(pkg.description, 'Existing description');
    assert.equal(pkg.homepage, 'https://configured.example');
    assert.deepEqual(pkg.bugs, { url: 'https://github.com/o/r/issues' });
    assert.deepEqual(pkg.keywords.sort(), ['existing', 'from-config']);
  } finally {
    removeRepo(dir);
  }
});
