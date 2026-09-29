import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../src/cli.js';

/** Runs the CLI in-process and captures everything it writes. */
async function run(argv) {
  const chunks = [];
  const code = await main(argv, { log: (text) => chunks.push(text) });
  return { code, output: chunks.join('') };
}

test('help prints the usage and exits 0', async () => {
  const { code, output } = await run(['--help']);
  assert.equal(code, 0);
  assert.match(output, /repo-aeo-mcp serve/);
  assert.match(output, /github-sync/);
  assert.match(output, /--ack/);
});

test('tools lists exactly the eight MCP tool names', async () => {
  const { code, output } = await run(['tools']);
  assert.equal(code, 0);
  const names = output.trim().split('\n');
  assert.equal(names.length, 8);
  assert.ok(names.includes('github_sync_metadata'));
  assert.ok(names.every((name) => /^[a-z]+(_[a-z]+){2,}$/.test(name)));
});

test('score prints the grade and the checks line', async () => {
  const { code, output } = await run(['score']);
  assert.equal(code, 0);
  assert.match(output, /Discoverability score: \d+\/100 \(grade [A-F]\)/);
  assert.match(output, /checks passed: \d+\/\d+/);
});

test('score --json emits a parseable payload with the same numbers', async () => {
  const { output } = await run(['score', '--json']);
  const payload = JSON.parse(output);
  assert.equal(typeof payload.score, 'number');
  assert.match(payload.grade, /^[A-F]$/);
  assert.match(payload.checks, /^\d+\/\d+$/);
});

test('github-sync refuses without the acknowledgement and exits non-zero', async () => {
  const { code, output } = await run(['github-sync']);
  assert.equal(code, 1, 'a refused write must fail the command');
  assert.match(output, /refusing to write/);
});

test('github-sync previews with an acknowledgement and exits 0', async () => {
  const { code, output } = await run(['github-sync', '--ack', 'I_ACK_RDK_GITHUB_WRITE', '--reason', 'cli smoke test']);
  assert.equal(code, 0, `expected 0, got ${code}: ${output.slice(0, 200)}`);
  assert.match(output, /Dry run: \d+ mutation\(s\)/);
  assert.match(output, /--apply/);
});

test('history reports the recorded metrics', async () => {
  await run(['score']);
  const { code, output } = await run(['history']);
  assert.equal(code, 0);
  assert.match(output, /discoverability_score/);
});
