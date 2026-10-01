import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNNER = join(fileURLToPath(import.meta.url), '..', '..', '..', '..', 'action', 'run-audit.mjs');

function runRunner(args) {
  return spawnSync(process.execPath, [RUNNER, ...args], { encoding: 'utf8', timeout: 60000 });
}

test('runner exits 0 and propagates stdout when the audit command exits 0', () => {
  const result = runRunner([process.execPath, '-e', "console.log('ok');process.exit(0)"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ok/);
});

test('runner exits 1, prints an annotation and the stderr tail when the audit command exits 1', () => {
  const result = runRunner([process.execPath, '-e', "console.error('boom');process.exit(1)"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /::error::/);
  assert.match(result.stderr, /boom/);
});

test('runner exits 2 and prints the min-score message when the audit command exits 2', () => {
  const result = runRunner([process.execPath, '-e', 'process.exit(2)', '--', '--min-score', '90']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Discoverability score is below 90/);
});

test('runner exits 1 when the audit command cannot be spawned', () => {
  const result = runRunner(['definitely-not-a-real-binary-xyz']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /::error::/);
});

test('runner passes an argument containing spaces intact to the child', () => {
  const code = 'console.log(JSON.stringify(process.argv.slice(1)));process.exit(0)';
  const result = runRunner([process.execPath, '-e', code, 'two words']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), ['two words']);
});
