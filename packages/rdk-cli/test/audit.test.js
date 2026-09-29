import test from 'node:test';
import assert from 'node:assert/strict';
import { utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { audit } from '../src/audit/index.js';
import { fixCommand } from '../src/commands/fix.js';
import { fixturePath, makeRepo, removeRepo } from './helpers.js';

test('audit reports the expected findings on the bare demo fixture', async () => {
  const report = await audit(fixturePath(), {});
  const ids = report.findings.map((f) => f.id);

  for (const id of [
    'github.topics_count',
    'readme.exists',
    'readme.first_success_path',
    'readme.audience_sections',
    'agents.exists',
    'docs.llms_txt',
    'npm.metadata',
    'hygiene.license',
  ]) {
    assert.ok(ids.includes(id), `expected finding ${id}, got: ${ids.join(', ')}`);
  }

  assert.equal(report.environment.offline, true);
  assert.equal(report.score.total < 50, true, 'a bare repo must score low');
  assert.equal(report.summary.errors > 0, true);
  assert.equal(report.score.axes.npm.applicable, true);
  assert.equal(report.score.axes.docs.applicable, true);
});

test('audit never crashes on a check and always returns a score 0-100', async () => {
  const report = await audit(fixturePath(), {});
  const crashed = report.findings.filter((f) => f.title.startsWith('Check crashed'));
  assert.deepEqual(crashed, []);
  assert.ok(report.score.total >= 0 && report.score.total <= 100);
  for (const axis of Object.values(report.score.axes)) {
    assert.ok(axis.score >= 0 && axis.score <= 100);
  }
});

test('audit skips the npm axis when there is no package', async () => {
  const report = await audit(fixturePath('..'), {});
  // fixtures/demo-repo/.. is fixtures/, which has no package.json
  assert.equal(report.score.axes.npm.applicable, false);
  assert.equal(report.environment.has_npm_package, false);
});

test('docs.readme_sync fires when llms.txt is older than README.md', async () => {
  const dir = makeRepo({
    'package.json': JSON.stringify({ name: 'readme-sync', description: 'Readme sync check', homepage: 'https://example.com' }),
    'README.md': '# readme-sync\n\nThe README.\n',
    'llms.txt': '# readme-sync\n\n> summary\n\n## Docs\n\n- [README.md](./README.md)\n',
  });
  try {
    const stale = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(join(dir, 'llms.txt'), stale, stale);
    const report = await audit(dir, {});
    const finding = report.findings.find((f) => f.id === 'docs.readme_sync');
    assert.ok(finding, 'expected docs.readme_sync to fire when README.md is newer than llms.txt');
    assert.equal(finding.autoFixable, true);
    assert.equal(finding.patchId, 'llms.generate');

    const fresh = new Date();
    utimesSync(join(dir, 'llms.txt'), fresh, fresh);
    const regenerated = await audit(dir, {});
    assert.equal(regenerated.findings.find((f) => f.id === 'docs.readme_sync'), undefined);
  } finally {
    removeRepo(dir);
  }
});

test('docs.readme_sync fires on managed content drift and clears after a fix', async () => {
  const dir = makeRepo({
    'package.json': JSON.stringify({ name: 'managed-drift', description: 'Managed drift', homepage: 'https://example.com' }),
    'README.md': '# managed-drift\n\nBody.\n',
  });
  try {
    fixCommand({ cwd: dir, options: { apply: true } });
    assert.equal((await audit(dir, {})).findings.find((f) => f.id === 'docs.readme_sync'), undefined);
    writeFileSync(join(dir, 'README.md'), '# managed-drift\n\nBody.\n\n## More\n\nNew section.\n');
    const drifted = await audit(dir, {});
    assert.ok(drifted.findings.find((f) => f.id === 'docs.readme_sync'), 'expected drift after a README edit');
    fixCommand({ cwd: dir, options: { apply: true } });
    assert.equal((await audit(dir, {})).findings.find((f) => f.id === 'docs.readme_sync'), undefined);
  } finally {
    removeRepo(dir);
  }
});

test('trust-file findings are autofixable and point at their patch', async () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ name: 'trust-files', description: 'Trust files' }) });
  try {
    const report = await audit(dir, {});
    const byId = new Map(report.findings.map((f) => [f.id, f]));
    for (const [id, patchId] of [
      ['hygiene.license', 'license.stub'],
      ['hygiene.security_policy', 'security.stub'],
      ['hygiene.contributing', 'contributing.stub'],
      ['hygiene.codeowners', 'github.templates'],
    ]) {
      const finding = byId.get(id);
      assert.ok(finding, `expected finding ${id}`);
      assert.equal(finding.autoFixable, true, `${id} must be autofixable`);
      assert.equal(finding.patchId, patchId, `${id} must point at ${patchId}`);
      assert.match(finding.fix, /rdk fix/, `${id} fix text must mention rdk fix`);
    }
  } finally {
    removeRepo(dir);
  }
});

test('license and security checks accept .github/ and docs/ locations', async () => {
  const pkg = JSON.stringify({ name: 'locations', description: 'Community profile locations' });
  const layouts = [
    { 'package.json': pkg, '.github/LICENSE': 'MIT\n', 'SECURITY.md': '# Security\n' },
    { 'package.json': pkg, 'docs/LICENSE.md': 'MIT\n', 'docs/SECURITY.md': '# Security\n' },
  ];
  for (const files of layouts) {
    const dir = makeRepo(files);
    try {
      const report = await audit(dir, {});
      const ids = report.findings.map((f) => f.id);
      assert.ok(!ids.includes('hygiene.license'), `license must be accepted for ${Object.keys(files).slice(1).join(', ')}`);
      assert.ok(!ids.includes('hygiene.security_policy'), `security policy must be accepted for ${Object.keys(files).slice(1).join(', ')}`);
    } finally {
      removeRepo(dir);
    }
  }
});
