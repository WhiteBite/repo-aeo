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

test('github-sync gets past the guard with an acknowledgement', async () => {
  // Hermetic by design: whether the preview succeeds depends on `gh` being
  // installed and authenticated, which CI does not guarantee. What must hold
  // everywhere is that a valid ack is not rejected and that any failure carries
  // a message a human or an agent can act on.
  const { code, output } = await run(['github-sync', '--ack', 'I_ACK_RDK_GITHUB_WRITE', '--reason', 'cli smoke test']);
  assert.ok(!/refusing to write: ack/i.test(output), `the ack guard must not reject a valid ack: ${output.slice(0, 200)}`);
  assert.ok(!/undefined/.test(output), `a failure must never print an empty reason: ${output.slice(0, 200)}`);
  if (code === 0) {
    assert.match(output, /Dry run: \d+ mutation\(s\)/);
    assert.match(output, /--apply/);
  } else {
    assert.match(output, /github-sync refused: \S/, 'the refusal must quote a reason');
  }
});

test('score records history, so its own trend line is not always empty', async () => {
  // Regression: the CLI used to call audit() directly and never recorded the
  // metric, which made `trend` a permanent "no history yet" and made the CLI
  // disagree with the MCP server.
  const first = await run(['score']);
  assert.equal(first.code, 0);
  const second = await run(['score']);
  assert.equal(second.code, 0);
  // Two consecutive audits of an unchanged repository must agree; the point is
  // that a number is reported at all, not which number it is.
  assert.match(second.output, /trend: (\d+) -> \1 \(flat\)/, `expected a real trend, got: ${second.output}`);

  const history = await run(['history']);
  assert.equal(history.code, 0);
  assert.match(history.output, /discoverability_score: \d+ point\(s\)/);
});
