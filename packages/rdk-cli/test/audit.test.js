import test from 'node:test';
import assert from 'node:assert/strict';
import { audit } from '../src/audit/index.js';
import { fixturePath } from './helpers.js';

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
