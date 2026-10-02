import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { loadConfig, buildSeedConfig } from '../src/config.js';
import { planPatches, applyPatches, PATCHES } from '../src/fix/patches.js';
import { fixCommand } from '../src/commands/fix.js';
import { initCommand } from '../src/commands/init.js';
import { audit } from '../src/audit/index.js';
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

test('citation.stub refreshes a stale version without touching other fields', () => {
  const citation = [
    'cff-version: 1.2.0',
    'message: "CITATION.cff — generated by rdk."',
    'title: "vtest"',
    'version: "0.1.0"',
    'type: software',
    'authors:',
    '  - name: "Jane Maintainer"',
    'repository-code: "https://github.com/jane/vtest"',
    '',
  ].join('\n');
  const dir = makeRepo({
    'package.json': JSON.stringify({ name: 'vtest', version: '2.5.0' }),
    'CITATION.cff': citation,
  });
  try {
    const planned = planPatches(contextFor(dir), { only: ['citation.stub'] });
    assert.equal(planned.length, 1);
    applyPatches(planned);
    const after = readFileSync(join(dir, 'CITATION.cff'), 'utf8');
    assert.match(after, /^version: "2\.5\.0"$/m);
    assert.match(after, /- name: "Jane Maintainer"/);
    assert.match(after, /^title: "vtest"$/m);
    assert.match(after, /^message: "CITATION\.cff — generated by rdk\."$/m);
    assert.deepEqual(planPatches(contextFor(dir), { only: ['citation.stub'] }), []);
  } finally {
    removeRepo(dir);
  }
});

test('citation.stub leaves a CITATION.cff without a version key alone', () => {
  const dir = makeRepo({
    'package.json': JSON.stringify({ name: 'nov', version: '1.0.0' }),
    'CITATION.cff': 'cff-version: 1.2.0\n',
  });
  try {
    assert.deepEqual(planPatches(contextFor(dir), { only: ['citation.stub'] }), []);
  } finally {
    removeRepo(dir);
  }
});

test('jsonld.snippet refreshes a stale softwareVersion and preserves everything else', () => {
  const snippet = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareSourceCode',
    name: 'jdemo',
    softwareVersion: '1.0.0',
    'x-hand-edited': true,
  };
  const dir = makeRepo({
    'package.json': JSON.stringify({ name: 'jdemo', version: '2.0.0', homepage: 'https://jdemo.example' }),
    'docs/jsonld.jsonld': `${JSON.stringify(snippet, null, 2)}\n`,
  });
  try {
    const planned = planPatches(contextFor(dir), { only: ['jsonld.snippet'] });
    assert.equal(planned.length, 1);
    applyPatches(planned);
    const after = JSON.parse(readFileSync(join(dir, 'docs', 'jsonld.jsonld'), 'utf8'));
    assert.equal(after.softwareVersion, '2.0.0');
    assert.equal(after['x-hand-edited'], true);
    assert.deepEqual(Object.keys(after), Object.keys(snippet));
    assert.deepEqual(planPatches(contextFor(dir), { only: ['jsonld.snippet'] }), []);
  } finally {
    removeRepo(dir);
  }
});

test('jsonld.snippet never adds softwareVersion to a snippet that has none', () => {
  const dir = makeRepo({
    'package.json': JSON.stringify({ name: 'plain', version: '1.0.0', homepage: 'https://plain.example' }),
    'docs/jsonld.jsonld': '{"@context":"https://schema.org","@type":"SoftwareSourceCode","name":"plain"}\n',
  });
  try {
    assert.deepEqual(planPatches(contextFor(dir), { only: ['jsonld.snippet'] }), []);
  } finally {
    removeRepo(dir);
  }
});

test('audit reports a stale CITATION.cff version as autofixable', async () => {
  const dir = makeRepo({
    'package.json': JSON.stringify({ name: 'aud', version: '3.0.0' }),
    'CITATION.cff': 'cff-version: 1.2.0\nversion: "0.1.0"\n',
  });
  try {
    const report = await audit(dir, { online: false });
    const stale = report.findings.find((f) => f.id === 'hygiene.citation');
    assert.ok(stale, 'expected a hygiene.citation finding for the stale version');
    assert.match(stale.title, /stale/i);
    assert.equal(stale.autoFixable, true);
    assert.equal(stale.patchId, 'citation.stub');
  } finally {
    removeRepo(dir);
  }
});

test('dependabot.stub writes weekly updates for the detected ecosystems', () => {
  const dir = makeRepo({
    'package.json': JSON.stringify({ name: 'dep-demo', version: '1.0.0' }),
    '.github/workflows/ci.yml': 'name: ci\non: push\njobs: {}\n',
  });
  try {
    const planned = planPatches(contextFor(dir), { only: ['dependabot.stub'] });
    assert.equal(planned.length, 1);
    applyPatches(planned);
    const yml = readFileSync(join(dir, '.github', 'dependabot.yml'), 'utf8');
    assert.match(yml, /^version: 2/);
    assert.match(yml, /package-ecosystem: npm/);
    assert.match(yml, /package-ecosystem: github-actions/);
    assert.doesNotMatch(yml, /package-ecosystem: pip/);
    assert.match(yml, /interval: weekly/);
    assert.deepEqual(planPatches(contextFor(dir), { only: ['dependabot.stub'] }), []);
  } finally {
    removeRepo(dir);
  }
});

test('dependabot.stub detects pip for a Python repo without package.json', () => {
  const dir = makeRepo({
    'requirements.txt': 'psutil\n',
    'pyproject.toml': '[project]\nname = "py-demo"\n',
  });
  try {
    applyPatches(planPatches(contextFor(dir), { only: ['dependabot.stub'] }));
    const yml = readFileSync(join(dir, '.github', 'dependabot.yml'), 'utf8');
    assert.match(yml, /package-ecosystem: pip/);
    assert.doesNotMatch(yml, /package-ecosystem: npm/);
    assert.doesNotMatch(yml, /package-ecosystem: github-actions/);
  } finally {
    removeRepo(dir);
  }
});

test('dependabot.stub stands down when the file already exists', () => {
  const dir = makeRepo({
    'package.json': JSON.stringify({ name: 'has-dep' }),
    '.github/dependabot.yml': 'version: 2\nupdates: []\n',
  });
  try {
    assert.deepEqual(planPatches(contextFor(dir), { only: ['dependabot.stub'] }), []);
  } finally {
    removeRepo(dir);
  }
});

test('audit reports a missing dependabot.yml as autofixable', async () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ name: 'dep-audit', version: '1.0.0' }) });
  try {
    const report = await audit(dir, { online: false });
    const dep = report.findings.find((f) => f.id === 'hygiene.dependabot');
    assert.ok(dep, 'expected a hygiene.dependabot finding');
    assert.equal(dep.severity, 'info');
    assert.equal(dep.autoFixable, true);
    assert.equal(dep.patchId, 'dependabot.stub');
  } finally {
    removeRepo(dir);
  }
});

test('coc.stub creates a Contributor Covenant CODE_OF_CONDUCT.md', () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ name: 'coc-demo' }) });
  try {
    const planned = planPatches(contextFor(dir), { only: ['coc.stub'] });
    assert.equal(planned.length, 1);
    applyPatches(planned);
    const coc = readFileSync(join(dir, 'CODE_OF_CONDUCT.md'), 'utf8');
    assert.match(coc, /Contributor Covenant Code of Conduct/);
    assert.match(coc, /version 2\.1/);
    assert.ok(!coc.includes('[INSERT CONTACT METHOD]'), 'the contact line must not keep the raw placeholder');
    assert.deepEqual(planPatches(contextFor(dir), { only: ['coc.stub'] }), []);
  } finally {
    removeRepo(dir);
  }
});

test('coc.stub stands down when a code of conduct already exists', () => {
  const dir = makeRepo({
    'package.json': JSON.stringify({ name: 'has-coc' }),
    '.github/CODE_OF_CONDUCT.md': '# Our own conduct rules\n',
  });
  try {
    assert.deepEqual(planPatches(contextFor(dir), { only: ['coc.stub'] }), []);
  } finally {
    removeRepo(dir);
  }
});

test('audit reports a missing CODE_OF_CONDUCT.md without scoring impact', async () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ name: 'coc-audit', version: '1.0.0' }) });
  try {
    const report = await audit(dir, { online: false });
    const coc = report.findings.find((f) => f.id === 'hygiene.code_of_conduct');
    assert.ok(coc, 'expected a hygiene.code_of_conduct finding');
    assert.equal(coc.severity, 'info');
    assert.equal(coc.autoFixable, true);
    assert.equal(coc.patchId, 'coc.stub');
  } finally {
    removeRepo(dir);
  }
});

test('readme stubs are appended exactly once when an unbalanced fence hides the tail from the parser', () => {
  const intro = 'A hand-written introduction long enough to keep readme.generate away from this file, because the regression under test is stub sections and example blocks re-appended on every pass when a stray code fence swallows the tail of the README.';
  const readme = `# fenced-readme\n\n${intro}\n\n## Harness matrix\n\nText.\n\n\`\`\`text\nblock\n\`\`\`\n\n\`\`\`\n\nTrailing note the parser treats as code.\n`;
  const dir = makeRepo({
    'package.json': JSON.stringify({ name: 'fenced-readme', scripts: { start: 'node index.js' } }),
    'README.md': readme,
  });
  try {
    fixCommand({ cwd: dir, options: { apply: true } });
    const after = readFileSync(join(dir, 'README.md'), 'utf8');
    assert.equal((after.match(/^## Who is it for\s*$/gm) || []).length, 1);
    assert.equal((after.match(/^## Use cases\s*$/gm) || []).length, 1);
    assert.equal((after.match(/^## Why choose this\s*$/gm) || []).length, 1);
    assert.equal((after.match(/^### Example \(replace with a real one\)$/gm) || []).length, 1);
    const second = fixCommand({ cwd: dir, options: { apply: true } });
    assert.equal(second.written.length, 0, `second apply must write nothing, wrote: ${second.written.join(', ')}`);
    assert.equal(readFileSync(join(dir, 'README.md'), 'utf8'), after);
  } finally {
    removeRepo(dir);
  }
});

test('dry-run preview composes same-file patches within a pass exactly like apply does', () => {
  const intro = 'A hand-written introduction long enough to keep readme.generate away, because the regression under test is same-file patch composition inside one simulated pass of the dry-run preview.';
  const dir = makeRepo({
    'package.json': JSON.stringify({ name: 'compose-demo', version: '1.0.0', scripts: { start: 'node index.js' } }),
    '.discoverability/project.yml': 'project:\n  name: compose-demo\nquickstart:\n  install: "npm i compose-demo"\n  run: "npm start"\n',
    'README.md': `# compose-demo\n\n${intro}\n\n## Usage\n\nWords, no code blocks.\n`,
  });
  try {
    const preview = fixCommand({ cwd: dir, options: {} });
    assert.equal((preview.output.match(/readme\.sections_stub/g) || []).length, 1, 'sections_stub must compose within one pass, not repeat across passes');
    assert.equal((preview.output.match(/readme\.quickstart_stub/g) || []).length, 1, 'quickstart_stub must compose within one pass, not repeat across passes');

    fixCommand({ cwd: dir, options: { apply: true } });
    const readme = readFileSync(join(dir, 'README.md'), 'utf8');
    assert.equal((readme.match(/^## Use cases\s*$/gm) || []).length, 1);
    assert.equal((readme.match(/^## Quickstart\s*$/gm) || []).length, 1);
    const second = fixCommand({ cwd: dir, options: {} });
    assert.match(second.output, /No safe autofixes/);
  } finally {
    removeRepo(dir);
  }
});
