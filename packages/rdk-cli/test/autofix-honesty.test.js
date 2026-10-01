import test from 'node:test';
import assert from 'node:assert/strict';
import { audit } from '../src/audit/index.js';
import { fixCommand } from '../src/commands/fix.js';
import { makeRepo, removeRepo } from './helpers.js';

const FULL_PKG = {
  name: 'honesty-demo',
  version: '1.0.0',
  description: 'A demo package with complete metadata for the autofix honesty test.',
  keywords: ['demo', 'honesty', 'audit', 'discoverability', 'rdk'],
  repository: { url: 'git+https://github.com/example/honesty-demo.git' },
  homepage: 'https://example.com/honesty-demo',
  bugs: { url: 'https://example.com/honesty-demo/issues' },
  exports: { '.': { import: './index.js', require: './index.cjs', types: './index.d.ts' } },
  types: './index.d.ts',
  sideEffects: false,
  files: ['index.js', 'index.cjs', 'index.d.ts', 'llms.txt', 'llms-full.txt', 'AGENTS.md'],
  engines: { node: '>=18' },
  scripts: { test: 'node --test' },
};

const README = [
  '# honesty-demo',
  '',
  'A demo package proving the audit only promises autofixes that actually run.',
  '',
  '## Quickstart',
  '',
  '```bash',
  'npm install honesty-demo',
  'node index.js',
  '```',
  '',
  '## Who is it for',
  '',
  '- Maintainers who distrust autofix counters.',
  '',
  '## Use cases',
  '',
  '- Verifying audit honesty in tests.',
  '',
  '## Examples',
  '',
  '```bash',
  'node index.js',
  '```',
  '',
  '```js',
  "import { x } from 'honesty-demo';",
  '```',
  '',
  '## Why choose this',
  '',
  '- The report never promises what the fixer will not do.',
  '',
  '## Status',
  '',
  'Actively maintained.',
  '',
].join('\n');

function makeCompleteRepo() {
  return makeRepo({
    'package.json': JSON.stringify(FULL_PKG, null, 2),
    'README.md': README,
    'AGENTS.md': '# Agents\n\nBe careful with this repository.\n',
    '.discoverability/project.yml': 'project:\n  name: honesty-demo\n',
    'llms.txt': '# honesty-demo\n\n> A hand-written llms.txt without rdk markers so the generator leaves it alone.\n\n- [README](README.md)\n',
    'llms-full.txt': '# honesty-demo — full documentation\n\nHand-written full documentation without rdk markers.\n',
    'docs/jsonld.jsonld': '{"@context":"https://schema.org","@type":"SoftwareSourceCode","name":"honesty-demo"}\n',
    'LICENSE': 'MIT License\n\nCopyright (c) 2026 the authors\n',
    'SECURITY.md': '# Security policy\n\nReport issues privately.\n',
    'CONTRIBUTING.md': '# Contributing\n\nRun the tests before pushing.\n',
    'CITATION.cff': 'cff-version: 1.2.0\n',
    '.gitignore': 'node_modules/\ndist/\nbuild/\n*.log\n.DS_Store\n.env\n',
    '.gitattributes': '* text=auto eol=lf\n',
    '.github/ISSUE_TEMPLATE/bug_report.md': '---\nname: Bug report\n---\n\n## What happened\n',
  });
}

test('a complete repo with a thin AGENTS.md agrees with fix: zero autofixable, no autofixes', async () => {
  const dir = makeCompleteRepo();
  try {
    const report = await audit(dir, { online: false });
    const liars = report.findings.filter((f) => f.autoFixable).map((f) => `${f.id} -> ${f.patchId}`);
    assert.deepEqual(liars, [], `findings claimed autofixable: ${liars.join(', ')}`);
    assert.equal(report.summary.autofixable, 0);

    const fix = fixCommand({ cwd: dir, options: {} });
    assert.match(fix.output, /No safe autofixes to apply/);
    assert.deepEqual(fix.planned, []);
  } finally {
    removeRepo(dir);
  }
});

test('agents.commands does not demand lint/build mentions when package.json has no scripts', async () => {
  const dir = makeRepo({
    'package.json': JSON.stringify({ name: 'no-scripts', version: '1.0.0', description: 'A package with no scripts at all.' }),
    'AGENTS.md': '# Agents\n\nProse only, no command words in this file.\n',
  });
  try {
    const report = await audit(dir, { online: false });
    assert.equal(report.findings.find((f) => f.id === 'agents.commands'), undefined);
  } finally {
    removeRepo(dir);
  }
});

test('a missing AGENTS.md keeps the agents.commands error autofixable (the stub patch applies)', async () => {
  const dir = makeRepo({
    'package.json': JSON.stringify({
      name: 'missing-agents',
      version: '1.0.0',
      description: 'A package whose AGENTS.md is absent.',
      scripts: { test: 'node --test' },
    }),
  });
  try {
    const report = await audit(dir, { online: false });
    const commands = report.findings.find((f) => f.id === 'agents.commands');
    assert.ok(commands, 'expected an agents.commands finding when AGENTS.md is missing');
    assert.equal(commands.severity, 'error');
    assert.equal(commands.autoFixable, true);
    assert.equal(commands.patchId, 'agents.stub');
  } finally {
    removeRepo(dir);
  }
});
