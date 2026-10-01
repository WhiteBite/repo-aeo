import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixCommand } from '../src/commands/fix.js';

function copyCrlfFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'rdk-crlf-'));
  cpSync(join(process.cwd(), 'fixtures', 'demo-repo-crlf'), dir, { recursive: true });
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
