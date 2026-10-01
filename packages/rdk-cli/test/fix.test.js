import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { loadConfig, buildSeedConfig } from '../src/config.js';
import { planPatches, applyPatches, PATCHES } from '../src/fix/patches.js';
import { fixCommand } from '../src/commands/fix.js';
import { initCommand } from '../src/commands/init.js';
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

test('github.templates skips CODEOWNERS when the repository has no remote', () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ name: 'no-remote' }) });
  try {
    applyPatches(planPatches(contextFor(dir), { only: ['github.templates'] }));
    assert.ok(existsSync(join(dir, '.github', 'ISSUE_TEMPLATE', 'bug_report.md')));
    assert.equal(existsSync(join(dir, '.github', 'CODEOWNERS')), false, 'never guess an owner for CODEOWNERS');
  } finally {
    removeRepo(dir);
  }
});

test('github.templates writes CODEOWNERS when the remote owner is known', () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ name: 'with-remote' }) });
  try {
    execSync('git init -q . && git remote add origin git@github.com/someone-else/their-tool.git', { cwd: dir });
    applyPatches(planPatches(contextFor(dir), { only: ['github.templates'] }));
    const codeowners = readFileSync(join(dir, '.github', 'CODEOWNERS'), 'utf8');
    assert.match(codeowners, /\* @someone-else/);
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

test('readme.examples_stub inserts exactly one stub per fix run and stays idempotent', () => {
  const intro = 'A hand-written introduction that is deliberately long enough to keep readme.generate away from this file, because the regression under test is the example stub inserted into the Usage section, not the scaffold.';
  const dir = makeRepo({
    'package.json': JSON.stringify({ name: 'stub-once', scripts: { start: 'node index.js' } }),
    'README.md': `# stub-once\n\n${intro}\n\n## Usage\n\nWords, no code blocks.\n`,
  });
  try {
    fixCommand({ cwd: dir, options: { apply: true } });
    const readme = readFileSync(join(dir, 'README.md'), 'utf8');
    assert.equal((readme.match(/### Example \(replace with a real one\)/g) || []).length, 1);
    const second = fixCommand({ cwd: dir, options: { apply: true } });
    assert.equal(second.written.length, 0, `second apply must write nothing, wrote: ${second.written.join(', ')}`);
    assert.equal(readFileSync(join(dir, 'README.md'), 'utf8'), readme);
  } finally {
    removeRepo(dir);
  }
});

test('readme.generate preserves hand-written prose and appends the scaffold around it', () => {
  const dir = makeRepo({
    'package.json': JSON.stringify({ name: 'keep-prose', scripts: { start: 'node index.js' } }),
    'README.md': '# t\n\nHand-written intro.\n',
  });
  try {
    fixCommand({ cwd: dir, options: { apply: true } });
    const readme = readFileSync(join(dir, 'README.md'), 'utf8');
    assert.ok(readme.startsWith('# t\n\nHand-written intro.\n'), 'hand-written lines must survive verbatim at the top');
    assert.match(readme, /## Quickstart/);
    assert.match(readme, /## Who is it for/);
    assert.match(readme, /## Status/);
    const second = fixCommand({ cwd: dir, options: { apply: true } });
    assert.equal(second.written.length, 0, `second apply must write nothing, wrote: ${second.written.join(', ')}`);
  } finally {
    removeRepo(dir);
  }
});

test('fix invents no commands when package.json has no scripts', () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ name: 'no-scripts', description: 'No scripts here' }) });
  try {
    fixCommand({ cwd: dir, options: { apply: true } });
    const readme = readFileSync(join(dir, 'README.md'), 'utf8');
    assert.doesNotMatch(readme, /npm (start|test|start --help)/);
    assert.match(readme, /npm install no-scripts/);
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    assert.doesNotMatch(agents, /npm (start|test)/);
    assert.doesNotMatch(agents, /```bash/);
  } finally {
    removeRepo(dir);
  }
});

test('readme.sections_stub writes in the dominant EOL style of the file', () => {
  const dir = makeRepo({
    'package.json': JSON.stringify({ name: 'eol-check' }),
    'README.md': '# eol-check\r\n\r\nIntro.\r\n',
  });
  try {
    applyPatches(planPatches(contextFor(dir), { only: ['readme.sections_stub'] }));
    const readme = readFileSync(join(dir, 'README.md'), 'utf8');
    assert.equal((readme.match(/(?<!\r)\n/g) || []).length, 0, 'a CRLF README must stay pure CRLF');
    assert.match(readme, /## Who is it for/);
  } finally {
    removeRepo(dir);
  }
});

test('init inserts exactly one Quickstart when readme.generate and quickstart_stub both plan', () => {
  const dir = makeRepo({
    'package.json': JSON.stringify({ name: 'qs', version: '1.0.0', description: 'qs demo', scripts: { start: 'node index.js' } }),
    'README.md': '# qs\n\nA short hand-written intro under the two hundred character scaffold threshold, kept verbatim by the preserve mode.\n',
  });
  try {
    const result = initCommand({ cwd: dir, options: { apply: true } });
    assert.equal(result.ok, true);
    const readme = readFileSync(join(dir, 'README.md'), 'utf8');
    assert.equal((readme.match(/^## Quickstart/gm) || []).length, 1, 'readme.generate appends the scaffold Quickstart, so quickstart_stub must stand down at apply time');
    assert.match(readme, /A short hand-written intro/);
  } finally {
    removeRepo(dir);
  }
});
