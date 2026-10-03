import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('tools lists exactly the nine MCP tool names', async () => {
  const { code, output } = await run(['tools']);
  assert.equal(code, 0);
  const names = output.trim().split('\n');
  assert.equal(names.length, 9);
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
  // sandbox repo: real-tree history is polluted by parallel edits
  const dir = mkdtempSync(join(tmpdir(), 'repo-aeo-mcp-cli-'));
  try {
    writeFileSync(join(dir, 'README.md'), '# demo\n\nNothing to see here.\n');
    const first = await run(['score', '--cwd', dir]);
    assert.equal(first.code, 0);
    const second = await run(['score', '--cwd', dir]);
    assert.equal(second.code, 0);
    // the point is that a number is reported at all, not which number it is
    assert.match(second.output, /trend: (\d+) -> \1 \(flat\)/, `expected a real trend, got: ${second.output}`);

    const history = await run(['history', '--cwd', dir]);
    assert.equal(history.code, 0);
    assert.match(history.output, /discoverability_score: \d+ point\(s\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('serve --read-only hides the write tool from tools/list', async () => {
  const chunks = [];
  const input = new PassThrough();
  const output = {
    write(chunk) {
      chunks.push(String(chunk));
      return true;
    },
  };
  const pending = main(['serve', '--read-only'], { log: () => {}, input, output });
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`);
  input.end();
  assert.equal(await pending, 0);

  const messages = chunks
    .join('')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
  const names = messages[0].result.tools.map((tool) => tool.name);
  assert.equal(names.length, 8);
  assert.ok(!names.includes('github_sync_metadata'));
});

test('RDK_READ_ONLY=1 has the same effect as --read-only', async () => {
  const previous = process.env.RDK_READ_ONLY;
  process.env.RDK_READ_ONLY = '1';
  try {
    const chunks = [];
    const input = new PassThrough();
    const output = {
      write(chunk) {
        chunks.push(String(chunk));
        return true;
      },
    };
    const pending = main(['serve'], { log: () => {}, input, output });
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'github_sync_metadata', arguments: {} } })}\n`);
    input.end();
    await pending;

    const messages = chunks
      .join('')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line));
    assert.equal(messages[0].result.isError, true);
    assert.match(JSON.parse(messages[0].result.content[0].text).error, /unknown tool: github_sync_metadata/);
  } finally {
    if (previous === undefined) delete process.env.RDK_READ_ONLY;
    else process.env.RDK_READ_ONLY = previous;
  }
});

test('github-sync --apply with a mismatched plan digest is refused before any write', async () => {
  const { code, output } = await run([
    'github-sync',
    '--ack',
    'I_ACK_RDK_GITHUB_WRITE',
    '--reason',
    'cli smoke test',
    '--apply',
    '--plan-digest',
    '0'.repeat(64),
  ]);
  assert.equal(code, 1);
  assert.match(output, /github-sync refused:/);
  assert.doesNotMatch(output, /updated/);
});
