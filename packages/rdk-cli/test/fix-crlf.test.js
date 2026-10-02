import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixCommand } from '../src/commands/fix.js';
import { audit } from '../src/audit/index.js';

function copyCrlfFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'rdk-crlf-'));
  cpSync(join(process.cwd(), 'fixtures', 'demo-repo-crlf'), dir, { recursive: true });
  // git EOL normalisation may hand us LF; the fixture's CRLF-ness is the test input
  for (const name of ['README.md', 'package.json']) {
    const path = join(dir, name);
    writeFileSync(path, readFileSync(path, 'utf8').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'));
  }
  return dir;
}

test('fix --apply on the CRLF fixture converges, is idempotent and keeps the README CRLF', () => {
  const dir = copyCrlfFixture();
  try {
    const first = fixCommand({ cwd: dir, options: { apply: true } });
    assert.equal(first.ok, true);
    assert.doesNotMatch(first.output, /in 3 passes/, 'must converge before the MAX_PASSES ceiling');

    const readme = readFileSync(join(dir, 'README.md'), 'utf8');
    const crlf = (readme.match(/\r\n/g) || []).length;
    const loneLf = (readme.match(/(?<!\r)\n/g) || []).length;
    assert.ok(crlf > 0, 'README must keep its CRLF line endings');
    assert.equal(loneLf, 0, `README must stay pure CRLF, found ${loneLf} lone LF line endings`);

    const second = fixCommand({ cwd: dir, options: { apply: true } });
    assert.match(second.output, /No safe autofixes/);
    assert.equal(second.written.length, 0, `second apply must write nothing, wrote: ${second.written.join(', ')}`);
    assert.equal(readFileSync(join(dir, 'README.md'), 'utf8'), readme);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('project.topics_normalize rewrites a CRLF project.yml: the autofixable promise resolves', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rdk-crlf-topics-'));
  try {
    mkdirSync(join(dir, '.discoverability'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'crlf-topics', version: '1.0.0' }), 'utf8');
    writeFileSync(
      join(dir, '.discoverability', 'project.yml'),
      'project:\r\n  name: crlf-topics\r\nkeywords:\r\n  github_topics:\r\n    - "Foo Bar"\r\n    - "ok-topic"\r\n',
      'utf8',
    );

    const before = await audit(dir, {});
    const finding = before.findings.find((f) => f.id === 'github.topics_format');
    assert.ok(finding, 'fixture must produce a topics_format finding');
    assert.equal(finding.autoFixable, true);

    const applied = fixCommand({ cwd: dir, options: { apply: true } });
    assert.ok(
      applied.written.some((p) => p.endsWith(join('.discoverability', 'project.yml'))),
      `fix must rewrite project.yml, wrote: ${applied.written.join(', ')}`,
    );

    const after = readFileSync(join(dir, '.discoverability', 'project.yml'), 'utf8');
    assert.ok(after.includes('foo-bar'), 'topics must be canonical after the fix');
    const loneLf = (after.match(/(?<!\r)\n/g) || []).length;
    assert.equal(loneLf, 0, `CRLF config must stay pure CRLF, found ${loneLf} lone LF endings`);

    const resolved = await audit(dir, {});
    assert.equal(resolved.findings.find((f) => f.id === 'github.topics_format'), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
