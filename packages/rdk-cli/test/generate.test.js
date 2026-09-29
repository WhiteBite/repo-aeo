import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import {
  GENERATED_START,
  GENERATED_END,
  mergeGenerated,
  renderCodeowners,
  renderProjectYml,
  renderReadme,
} from '../src/generate/index.js';
import { parse } from '../src/yaml.js';
import { makeRepo, removeRepo } from './helpers.js';
import { loadConfig } from '../src/config.js';
import { planPatches, applyPatches } from '../src/fix/patches.js';

const FULL_CONFIG = {
  project: { name: 'round-trip', one_liner: 'It round-trips', description: 'Longer text', category: 'tool' },
  audiences: ['devs'],
  use_cases: ['one', 'two'],
  keywords: { github_topics: ['cli', 'developer-tools'], npm_keywords: ['cli'] },
  links: { homepage: 'https://example.com', docs: null, demo: null, issues: 'https://github.com/o/r/issues' },
  quickstart: { prerequisites: ['Node.js >= 18'], install: 'npm i round-trip', run: 'npm start', test: 'npm test' },
  artifacts: { has_npm_package: true, has_docs_site: false },
  differentiators: ['because'],
  safety: { allow_autofix: false, require_ack_for_publish: true },
};

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

test('renderProjectYml output round-trips through the YAML parser', () => {
  const parsed = parse(renderProjectYml(FULL_CONFIG));
  assert.deepEqual(parsed, FULL_CONFIG);
});

test('renderProjectYml handles empty lists', () => {
  const parsed = parse(renderProjectYml({ project: { name: 'x' }, keywords: {} }));
  assert.deepEqual(parsed.audiences, []);
  assert.deepEqual(parsed.keywords.github_topics, []);
});

test('mergeGenerated wraps new files and preserves hand-written tails', () => {
  const first = mergeGenerated(null, 'GENERATED BODY');
  assert.ok(first.includes(GENERATED_START));
  assert.ok(first.includes(GENERATED_END));

  const handEdited = `${first}\nMy own paragraph that must survive.\n`;
  const merged = mergeGenerated(handEdited, 'NEW GENERATED BODY');
  assert.ok(merged.includes('NEW GENERATED BODY'));
  assert.ok(merged.includes('My own paragraph that must survive.'));

  // legacy files without markers are never silently overwritten
  assert.equal(mergeGenerated('some hand written file', 'GENERATED BODY'), null);
});

test('rdk fix does not clobber a hand-edited llms.txt', () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ name: 'keep-mine', description: 'Keep mine' }) });
  try {
    applyPatches(planPatches(contextFor(dir), { only: ['llms.generate'] }));
    const llmsPath = join(dir, 'llms.txt');
    writeFileSync(llmsPath, '# my own llms.txt\n\nhand written, no markers\n', 'utf8');
    applyPatches(planPatches(contextFor(dir), { only: ['llms.generate'] }));
    assert.equal(readFileSync(llmsPath, 'utf8'), '# my own llms.txt\n\nhand written, no markers\n');
  } finally {
    removeRepo(dir);
  }
});

test('generated README links only to URLs that exist in the config', () => {
  const readme = renderReadme({ project: { name: 'links-check', one_liner: 'Check the links' }, links: {} });
  const urls = [...readme.matchAll(/\]\((https?:\/\/[^)]+)\)/g)].map((m) => m[1]);
  assert.deepEqual(urls, []);
});

test('generated CODEOWNERS names the audited repository owner, not ours', () => {
  // Regression: renderCodeowners() used to hard-code `* @WhiteBite`, which
  // silently assigned a stranger's repository to us.
  const dir = makeRepo();
  try {
    execSync('git init -q . && git remote add origin git@github.com:someone-else/their-tool.git', { cwd: dir });
    const codeowners = renderCodeowners(dir);
    assert.match(codeowners, /\* @someone-else$/m);
    assert.ok(!codeowners.includes('WhiteBite'), 'a foreign repo must not inherit our owner');
  } finally {
    removeRepo(dir);
  }

  // Without a remote the documented fallback still applies.
  assert.match(renderCodeowners('/tmp'), /\* @WhiteBite$/m);
});

test('generated project.yml points at the tool documentation, not at the audited repo', () => {
  const yml = renderProjectYml({ project: { name: 'docs-link', one_liner: 'Check the docs link' } });
  const docsLine = yml.split('\n').find((line) => line.startsWith('# Docs:'));
  assert.ok(docsLine, 'the generated config must carry a docs link');
  assert.ok(docsLine.includes('/blob/main/docs/configuration.md'), docsLine);
  assert.ok(!docsLine.includes('someone-else'), 'the docs link belongs to the tool, not to the audited repo');
});
