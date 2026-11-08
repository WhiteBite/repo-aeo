import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, removeRepo } from './helpers.js';
import { loadConfig } from '../src/config.js';
import { planPatches, applyPatches } from '../src/fix/patches.js';
import { renderFundingYml, packageFunding, fundingLinks, FUNDING_MARKER } from '../src/generate/index.js';
import { hygieneChecks } from '../src/audit/checks/hygiene.js';

const ENABLED = { enabled: true, github: ['WhiteBite'], custom: ['https://boosty.to/whitebite', 'https://cloudtips.ru/whitebite'] };

function contextFor(dir) {
  const loaded = loadConfig(dir);
  return {
    cwd: dir,
    options: {},
    config: loaded.config,
    configExists: loaded.exists,
    pkg: loaded.publishable.pkg,
    publishable: loaded.publishable,
    git: loaded.git,
  };
}

function repoWithFunding(files = {}) {
  return makeRepo({
    'package.json': JSON.stringify({ name: 'funded', version: '1.0.0', description: 'Funded', scripts: { test: 'node --test' } }),
    '.discoverability/project.yml': [
      'project:',
      '  name: funded',
      '  one_liner: A funded project',
      'funding:',
      '  enabled: true',
      '  github:',
      '    - WhiteBite',
      '  custom:',
      '    - "https://boosty.to/whitebite"',
      '',
    ].join('\n'),
    ...files,
  });
}

const fundingCheck = hygieneChecks.find((definition) => definition.id === 'hygiene.funding');

test('renderFundingYml returns null unless funding is enabled with a target', () => {
  assert.equal(renderFundingYml({}), null);
  assert.equal(renderFundingYml({ funding: { enabled: false, github: ['x'] } }), null);
  assert.equal(renderFundingYml({ funding: { enabled: true } }), null);
});

test('renderFundingYml emits the marker, native keys and custom urls', () => {
  const yml = renderFundingYml({ funding: ENABLED });
  assert.ok(yml.startsWith(`${FUNDING_MARKER}\n`));
  assert.match(yml, /^github:\n  - "WhiteBite"$/m);
  assert.match(yml, /^custom:\n  - "https:\/\/boosty\.to\/whitebite"$/m);
});

test('renderFundingYml caps custom at four urls, the GitHub limit', () => {
  const funding = { enabled: true, custom: ['https://a', 'https://b', 'https://c', 'https://d', 'https://e'] };
  const yml = renderFundingYml({ funding });
  assert.equal((yml.match(/^  - /gm) || []).length, 4);
});

test('fundingLinks maps native profiles and custom hosts', () => {
  assert.deepEqual(fundingLinks({ funding: ENABLED }), [
    { label: 'GitHub Sponsors', url: 'https://github.com/sponsors/WhiteBite' },
    { label: 'boosty.to', url: 'https://boosty.to/whitebite' },
    { label: 'cloudtips.ru', url: 'https://cloudtips.ru/whitebite' },
  ]);
  assert.deepEqual(fundingLinks({ funding: { enabled: false } }), []);
});

test('packageFunding returns null, a single object or an array', () => {
  assert.equal(packageFunding({ funding: { enabled: false } }), null);
  assert.deepEqual(packageFunding({ funding: { enabled: true, github: ['alice'] } }), { type: 'individual', url: 'https://github.com/sponsors/alice' });
  assert.equal(Array.isArray(packageFunding({ funding: ENABLED })), true);
});

test('funding.github creates FUNDING.yml and is idempotent', () => {
  const dir = repoWithFunding();
  try {
    applyPatches(planPatches(contextFor(dir), { only: ['funding.github'] }));
    const path = join(dir, '.github', 'FUNDING.yml');
    const first = readFileSync(path, 'utf8');
    assert.ok(first.startsWith(FUNDING_MARKER));
    applyPatches(planPatches(contextFor(dir), { only: ['funding.github'] }));
    assert.equal(readFileSync(path, 'utf8'), first);
  } finally {
    removeRepo(dir);
  }
});

test('funding.github never clobbers a hand-written FUNDING.yml', () => {
  const dir = repoWithFunding({ '.github/FUNDING.yml': 'github: someone-else\n' });
  try {
    applyPatches(planPatches(contextFor(dir), { only: ['funding.github'] }));
    assert.equal(readFileSync(join(dir, '.github', 'FUNDING.yml'), 'utf8'), 'github: someone-else\n');
  } finally {
    removeRepo(dir);
  }
});

test('funding.package adds the npm funding field once', () => {
  const dir = repoWithFunding();
  try {
    applyPatches(planPatches(contextFor(dir), { only: ['funding.package'] }));
    const json = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    assert.deepEqual(json.funding, [
      { type: 'individual', url: 'https://github.com/sponsors/WhiteBite' },
      { type: 'individual', url: 'https://boosty.to/whitebite' },
    ]);
    applyPatches(planPatches(contextFor(dir), { only: ['funding.package'] }));
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).funding, json.funding);
  } finally {
    removeRepo(dir);
  }
});

test('funding.package never overwrites an existing funding field', () => {
  const dir = repoWithFunding({ 'package.json': JSON.stringify({ name: 'funded', funding: 'https://example.com/donate' }) });
  try {
    applyPatches(planPatches(contextFor(dir), { only: ['funding.package'] }));
    assert.equal(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).funding, 'https://example.com/donate');
  } finally {
    removeRepo(dir);
  }
});

test('readme.support appends a Support section once', () => {
  const readme = '# funded\n\nA funded project with enough prose to clear two hundred characters so the readme.generate patch leaves it alone in the same run, keeping this fixture stable.\n';
  const dir = repoWithFunding({ 'README.md': readme });
  try {
    applyPatches(planPatches(contextFor(dir), { only: ['readme.support'] }));
    const first = readFileSync(join(dir, 'README.md'), 'utf8');
    assert.match(first, /## Support/);
    assert.ok(first.includes('https://boosty.to/whitebite'));
    applyPatches(planPatches(contextFor(dir), { only: ['readme.support'] }));
    assert.equal(readFileSync(join(dir, 'README.md'), 'utf8'), first);
  } finally {
    removeRepo(dir);
  }
});

test('hygiene.funding passes when funding is disabled or has no target', () => {
  assert.equal(fundingCheck.run({ cwd: '.', config: { funding: { enabled: false } } }), null);
  assert.equal(fundingCheck.run({ cwd: '.', config: { funding: { enabled: true } } }), null);
});

test('hygiene.funding is info-level and names the patch when the file is missing', () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ name: 'x' }) });
  try {
    const result = fundingCheck.run({ cwd: dir, config: { funding: ENABLED } });
    assert.equal(result.severity, 'info');
    assert.equal(result.patchId, 'funding.github');
  } finally {
    removeRepo(dir);
  }
});

test('hygiene.funding passes once the generated file is present and current', () => {
  const dir = repoWithFunding();
  try {
    applyPatches(planPatches(contextFor(dir), { only: ['funding.github'] }));
    const loaded = loadConfig(dir);
    assert.equal(fundingCheck.run({ cwd: dir, config: loaded.config }), null);
  } finally {
    removeRepo(dir);
  }
});

test('hygiene.funding flags drift after the config changes', () => {
  const dir = repoWithFunding();
  try {
    applyPatches(planPatches(contextFor(dir), { only: ['funding.github'] }));
    const loaded = loadConfig(dir);
    const result = fundingCheck.run({ cwd: dir, config: { ...loaded.config, funding: { ...loaded.config.funding, github: ['someone-new'] } } });
    assert.equal(result.severity, 'info');
  } finally {
    removeRepo(dir);
  }
});
