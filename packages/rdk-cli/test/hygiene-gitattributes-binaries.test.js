import test from 'node:test';
import assert from 'node:assert/strict';
import { audit } from '../src/audit/index.js';
import { hygieneChecks } from '../src/audit/checks/hygiene.js';
import { makeRepo, removeRepo } from './helpers.js';

const PKG = { name: 'gitattributes-binaries', version: '1.0.0', description: 'gitattributes binary gate package' };
const CHECK_ID = 'hygiene.gitattributes_binaries';

async function findingFor(files) {
  const dir = makeRepo({ 'package.json': JSON.stringify(PKG), ...files });
  try {
    const report = await audit(dir, { online: false });
    return report.findings.find((f) => f.id === CHECK_ID) || null;
  } finally {
    removeRepo(dir);
  }
}

test('a catch-all text rule with a shipped png fires the check', async () => {
  const finding = await findingFor({ '.gitattributes': '* text eol=lf\n', 'assets/demo.png': 'PNG' });
  assert.ok(finding, 'expected a hygiene.gitattributes_binaries finding');
  assert.equal(finding.severity, 'warn');
  assert.equal(finding.autoFixable, false);
  assert.equal(finding.patchId, null);
  assert.match(finding.fix, /\*\.png binary/);
});

test('a later *.png binary exception clears the finding', async () => {
  const finding = await findingFor({ '.gitattributes': '* text eol=lf\n*.png binary\n', 'assets/demo.png': 'PNG' });
  assert.equal(finding, null);
});

test('no .gitattributes passes', async () => {
  const finding = await findingFor({ 'assets/demo.png': 'PNG' });
  assert.equal(finding, null);
});

test('a catch-all text rule with no shipped binary asset passes', async () => {
  const finding = await findingFor({ '.gitattributes': '* text eol=lf\n' });
  assert.equal(finding, null);
});

test('text=auto does not force text on binaries', async () => {
  const finding = await findingFor({ '.gitattributes': '* text=auto\n', 'assets/demo.png': 'PNG' });
  assert.equal(finding, null);
});

test('an empty repository does not crash the check', () => {
  const dir = makeRepo({});
  try {
    const check = hygieneChecks.find((c) => c.id === CHECK_ID);
    assert.equal(check.run({ cwd: dir }), null);
  } finally {
    removeRepo(dir);
  }
});
