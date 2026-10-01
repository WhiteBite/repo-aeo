import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TOOLS, callTool, toolDescriptors, firstHeadingOf, parseCurlStatus } from '../src/tools.js';
import { record, series, trend, listMetrics, historyPath } from '../src/history.js';

const HISTORY_MODULE_URL = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'history.js')).href;

/** A disposable directory so history never leaks between tests. */
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'repo-aeo-mcp-test-'));
  return {
    dir,
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** A minimal repo that still triggers real audit findings. */
function bareRepo() {
  const box = sandbox();
  writeFileSync(join(box.dir, 'README.md'), '# demo\n\nNothing to see here.\n');
  return box;
}

test('the tool registry exposes 8 read-mostly tools with stable names', () => {
  assert.equal(TOOLS.length, 8, `expected 8 tools, got ${TOOLS.length}`);
  for (const tool of TOOLS) {
    assert.match(tool.name, /^[a-z]+(_[a-z]+){2,}$/, `tool name ${tool.name} must be snake_case service_action_object`);
    assert.ok(tool.name.split('_').length >= 3, `${tool.name} must have at least three segments`);
    assert.ok(tool.description.length > 20, `${tool.name} needs a 1-2 sentence description`);
    assert.equal(tool.inputSchema.type, 'object');
    // `required` is optional in JSON Schema, but every entry must exist.
    for (const name of tool.inputSchema.required || []) {
      assert.ok(tool.inputSchema.properties[name], `${tool.name} requires unknown property ${name}`);
    }
  }
  const names = TOOLS.map((tool) => tool.name);
  assert.equal(new Set(names).size, names.length, 'tool names must be unique');
  assert.deepEqual(names, [
    'npm_get_search_score',
    'github_audit_visibility_signals',
    'llms_txt_check_freshness',
    'site_check_llms_txt',
    'repo_get_discoverability_score',
    'repo_list_findings',
    'competitor_scan_list_articles',
    'github_sync_metadata',
  ]);
  // Exactly one tool may write, and it must be annotated as such.
  for (const tool of TOOLS) {
    assert.equal(typeof tool.annotations, 'object', `${tool.name} must declare annotations`);
    assert.equal(typeof tool.annotations.readOnlyHint, 'boolean', `${tool.name} must declare readOnlyHint`);
  }
  const writers = TOOLS.filter((tool) => tool.annotations && tool.annotations.readOnlyHint === false);
  assert.equal(writers.length, 1);
  assert.equal(writers[0].name, 'github_sync_metadata');
});

test('every tool definition is JSON-serialisable and the write tool declares its guard', () => {
  for (const tool of TOOLS) {
    // What goes over the wire is the descriptor, never the implementation.
    const serialized = JSON.parse(JSON.stringify(toolDescriptors().find((entry) => entry.name === tool.name)));
    assert.deepEqual(serialized, {
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
    });
    assert.equal(serialized.inputSchema.type, 'object');
    assert.ok(serialized.annotations && typeof serialized.annotations.readOnlyHint === 'boolean', `${tool.name} must expose annotations`);
    if (serialized.name === 'github_sync_metadata') {
      assert.ok(serialized.inputSchema.properties.ack, 'the write tool must declare ack');
      assert.ok(serialized.inputSchema.properties.reason, 'the write tool must declare reason');
      assert.ok(serialized.inputSchema.required.includes('ack'));
      assert.ok(serialized.inputSchema.required.includes('reason'));
    }
  }
});

test('github_sync_metadata refuses to write without the acknowledgement and reason', async () => {
  const box = sandbox();
  try {
    const missing = await callTool('github_sync_metadata', { cwd: box.dir });
    assert.equal(missing.ok, false);
    assert.match(missing.error, /ack/i);

    const wrong = await callTool('github_sync_metadata', { cwd: box.dir, ack: 'PLEASE', reason: 'because' });
    assert.equal(wrong.ok, false);
    assert.match(wrong.error, /ack/i);

    const noReason = await callTool('github_sync_metadata', { cwd: box.dir, ack: 'I_ACK_RDK_GITHUB_WRITE' });
    assert.equal(noReason.ok, false);
    assert.match(noReason.error, /reason/i);

    // A dry run is the only non-mutating path: it must explain itself instead
    // of writing anything, and it must never be blocked by the guard again.
    const preview = await callTool('github_sync_metadata', {
      cwd: box.dir,
      ack: 'I_ACK_RDK_GITHUB_WRITE',
      reason: 'unit test',
      apply: false,
    });
    assert.equal(preview.applied, false, 'a dry run must never report an applied write');
    assert.equal(preview.dry_run, true, 'the tool must report that it previewed');
    assert.equal(preview.applied, false);
    assert.equal(preview.mutation_count, 0, 'a dry run must not apply any mutation');
    assert.ok(preview.output && preview.output.length > 0, 'a dry run still prints the plan');
    // Whether the preview could be produced depends on `gh`, which CI does not
    // guarantee; a refusal, if any, must always carry an actionable reason.
    if (!preview.ok) {
      assert.ok(
        typeof preview.error === 'string' && preview.error.trim().length > 0,
        `expected a refusal reason, got ${JSON.stringify(preview.error)}`,
      );
    }
  } finally {
    box.cleanup();
  }
});

test('refusals and the tool schema never leak the acknowledgement constant', async () => {
  const box = sandbox();
  try {
    const missing = await callTool('github_sync_metadata', { cwd: box.dir });
    assert.equal(missing.ok, false);
    assert.ok(!missing.error.includes('I_ACK_RDK_GITHUB_WRITE'), 'the refusal must not teach the ack in one round trip');

    const wrong = await callTool('github_sync_metadata', { cwd: box.dir, ack: 'PLEASE', reason: 'because' });
    assert.ok(!String(wrong.error).includes('I_ACK_RDK_GITHUB_WRITE'));

    const descriptor = toolDescriptors().find((entry) => entry.name === 'github_sync_metadata');
    assert.ok(!JSON.stringify(descriptor).includes('I_ACK_RDK_GITHUB_WRITE'), 'the inputSchema must not carry the ack literal');
    assert.match(descriptor.inputSchema.properties.ack.description, /configured/i);
  } finally {
    box.cleanup();
  }
});

test('github_sync_metadata refuses apply without a plan digest and relays the preview contract', async () => {
  const box = sandbox();
  try {
    const refused = await callTool('github_sync_metadata', {
      cwd: box.dir,
      ack: 'I_ACK_RDK_GITHUB_WRITE',
      reason: 'unit test',
      apply: true,
    });
    assert.equal(refused.ok, false);
    assert.equal(refused.code, 'plan_digest_required');
    assert.match(refused.error, /plan_digest/);

    const preview = await callTool('github_sync_metadata', {
      cwd: box.dir,
      ack: 'I_ACK_RDK_GITHUB_WRITE',
      reason: 'unit test',
      apply: false,
    });
    assert.ok(Array.isArray(preview.plan), 'the preview response carries the structured plan');
    assert.ok(
      preview.plan_digest === null || /^[0-9a-f]{64}$/.test(preview.plan_digest),
      `plan_digest must be a sha256 hex or null, got ${JSON.stringify(preview.plan_digest)}`,
    );
  } finally {
    box.cleanup();
  }
});

test('read-only mode hides the write tool from descriptors and calls', async () => {
  const visible = toolDescriptors().map((entry) => entry.name);
  assert.ok(visible.includes('github_sync_metadata'));

  const restricted = toolDescriptors({ readOnly: true }).map((entry) => entry.name);
  assert.equal(restricted.length, visible.length - 1);
  assert.ok(!restricted.includes('github_sync_metadata'));

  const box = sandbox();
  try {
    const payload = await callTool(
      'github_sync_metadata',
      { cwd: box.dir, ack: 'I_ACK_RDK_GITHUB_WRITE', reason: 'unit test' },
      { readOnly: true },
    );
    assert.equal(payload.ok, false);
    assert.match(payload.error, /unknown tool: github_sync_metadata/);
  } finally {
    box.cleanup();
  }
});

test('first heading extraction survives a served BOM', () => {
  const bom = String.fromCharCode(0xfeff);
  assert.equal(firstHeadingOf(`${bom}# Project docs\n\n- [Docs](https://example.com)\n`), 'Project docs');
  assert.equal(firstHeadingOf('# No BOM\n'), 'No BOM');
  assert.equal(firstHeadingOf('no heading at all'), null);
});

test('repo_get_discoverability_score audits offline and records a trend', async () => {
  const box = bareRepo();
  try {
    const payload = await callTool('repo_get_discoverability_score', { cwd: box.dir });
    assert.equal(payload.ok, true);
    assert.equal(payload.environment.offline, true);
    assert.ok(payload.score.total >= 0 && payload.score.total <= 100);
    assert.match(payload.score.grade, /^[A-F]$/);
    assert.equal(payload.schema, 'rdk-audit/1');
    assert.ok(payload.summary.checks >= 20, 'a bare repo must still run most checks');
    assert.ok(Array.isArray(payload.next_actions));
    assert.equal(payload.history_points, 1, 'the first call seeds one history point');
    assert.equal(existsSync(historyPath(box.dir)), true);

    // A second call records a second point and reports the trend.
    const again = await callTool('repo_get_discoverability_score', { cwd: box.dir });
    assert.equal(again.history_points, 2);
    assert.equal(again.trend.points, 2);
    assert.equal(again.trend.direction, 'flat');
  } finally {
    box.cleanup();
  }
});

test('repo_list_findings filters by severity and limit', async () => {
  const box = bareRepo();
  try {
    const payload = await callTool('repo_list_findings', { cwd: box.dir, severity: 'error', limit: 3 });
    assert.equal(payload.ok, true);
    assert.ok(payload.findings.length <= 3, 'limit must be honoured');
    for (const finding of payload.findings) {
      assert.equal(finding.severity, 'error');
      assert.ok(finding.fix, 'every finding carries a fix');
    }
    assert.equal(payload.returned, payload.findings.length);

    const all = await callTool('repo_list_findings', { cwd: box.dir, limit: 100 });
    assert.ok(all.total >= all.findings.length);
    assert.ok(all.score >= 0 && all.score <= 100);
  } finally {
    box.cleanup();
  }
});

test('llms_txt_check_freshness detects a stale llms.txt', async () => {
  const box = sandbox();
  try {
    writeFileSync(join(box.dir, 'llms.txt'), '# project\n');
    // Backdate llms.txt by five days and write a newer source next to it.
    const stale = new Date(Date.now() - 5 * 86400000);
    utimesSync(join(box.dir, 'llms.txt'), stale, stale);
    writeFileSync(join(box.dir, 'README.md'), '# project\n');

    const payload = await callTool('llms_txt_check_freshness', { cwd: box.dir });
    assert.equal(payload.ok, true, 'the check itself must succeed');
    assert.equal(payload.fresh, false, 'a stale llms.txt must be reported');
    assert.ok(payload.newer_sources.length > 0, 'README.md must be detected as newer');
    assert.ok(payload.drift_hours >= 100, `expected ~120h drift, got ${payload.drift_hours}`);
    assert.match(payload.recommendation, /regenerate/);
  } finally {
    box.cleanup();
  }
});

test('llms_txt_check_freshness reports a missing llms.txt instead of throwing', async () => {
  const box = sandbox();
  try {
    const payload = await callTool('llms_txt_check_freshness', { cwd: box.dir });
    assert.equal(payload.ok, false);
    assert.match(payload.error, /llms\.txt not found/);
  } finally {
    box.cleanup();
  }
});

test('site_check_llms_txt fails gracefully on an unreachable site', async () => {
  const payload = await callTool('site_check_llms_txt', { site: 'https://invalid.invalid/llms.txt' });
  assert.equal(payload.ok, false);
  assert.ok(payload.error.length > 0);
  assert.ok(Array.isArray(payload.findings));
});

test('competitor_scan_list_articles requires a search endpoint', async () => {
  const previous = process.env.RDK_SEARCH_ENDPOINT;
  delete process.env.RDK_SEARCH_ENDPOINT;
  try {
    const payload = await callTool('competitor_scan_list_articles', { query: 'discoverability' });
    assert.equal(payload.ok, false);
    assert.match(payload.error, /RDK_SEARCH_ENDPOINT/);
  } finally {
    if (previous !== undefined) process.env.RDK_SEARCH_ENDPOINT = previous;
  }
});

test('an unknown tool name is reported, not thrown', async () => {
  const payload = await callTool('nope_does_not_exist', {});
  assert.equal(payload.ok, false);
  assert.match(payload.error, /unknown tool/);
});

test('history records metrics, series and trends in a disposable directory', () => {
  const box = sandbox();
  try {
    const key = 'discoverability_score';
    assert.equal(series(key, 10, box.dir).length, 0);
    assert.equal(trend(key, box.dir).points, 0);

    record(key, 60, box.dir);
    record(key, 80, box.dir);
    const points = series(key, 10, box.dir);
    assert.equal(points.length, 2);
    assert.equal(points[0].value, 60);
    assert.equal(points[1].value, 80);

    const rising = trend(key, box.dir);
    assert.equal(rising.points, 2);
    assert.equal(rising.direction, 'up');
    assert.equal(rising.delta, 20);

    record(key, 40, box.dir);
    assert.equal(trend(key, box.dir).direction, 'down');

    // The window caps the series length and metrics never leak across projects.
    assert.equal(series(key, 2, box.dir).length, 2);
    assert.equal(listMetrics(box.dir).length, 1);
    assert.equal(listMetrics(join(box.dir, 'other')).length, 0);
  } finally {
    box.cleanup();
  }
});

test('every tool descriptor carries a human-readable title', () => {
  for (const descriptor of toolDescriptors()) {
    assert.ok(typeof descriptor.title === 'string' && descriptor.title.length > 3, `${descriptor.name} must declare a title`);
  }
});

test('github_sync_metadata confirms apply through elicitation when the client supports it', async () => {
  const box = sandbox();
  try {
    const asked = [];
    const accepting = {
      cwd: box.dir,
      clientCapabilities: { elicitation: {} },
      request: async (method) => {
        asked.push(method);
        return { action: 'accept', content: { approve: true } };
      },
    };
    const accepted = await callTool('github_sync_metadata', { ack: 'I_ACK_RDK_GITHUB_WRITE', reason: 'elicited write', apply: true }, accepting);
    assert.deepEqual(asked, ['elicitation/create']);
    assert.notEqual(accepted.code, 'elicitation_declined', 'an accepted elicitation must pass the confirmation gate');

    const declining = { ...accepting, request: async () => ({ action: 'decline' }) };
    const declined = await callTool('github_sync_metadata', { ack: 'I_ACK_RDK_GITHUB_WRITE', reason: 'elicited write', apply: true }, declining);
    assert.equal(declined.code, 'elicitation_declined');
    assert.equal(declined.ok, false);
  } finally {
    box.cleanup();
  }
});

test('the skill MCP manifest dogfood numbers match the live tool registry', () => {
  const manifestPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'skills', 'repo-discoverability', 'references', 'mcp-manifest.md');
  const text = readFileSync(manifestPath, 'utf8');
  const readOnly = TOOLS.filter((tool) => tool.annotations.readOnlyHint === true).length;
  const named = /snake_case \| (\d+) tools, e.g\./.exec(text);
  const annotated = /(\d+) tools annotated `readOnlyHint: true`/.exec(text);
  const exact = /exactly (\d+)/.exec(text);
  assert.ok(named && annotated && exact, 'manifest dogfood rows missing');
  assert.equal(Number(named[1]), TOOLS.length, 'manifest tool count drifted from the registry');
  assert.equal(Number(annotated[1]), readOnly, 'manifest readOnly count drifted from the registry');
  assert.equal(Number(exact[1]), TOOLS.length, 'manifest exact-count row drifted from the registry');
});

test('history survives a corrupt cache file', () => {
  const box = sandbox();
  try {
    mkdirSync(join(box.dir, '.discoverability', 'cache'), { recursive: true });
    writeFileSync(historyPath(box.dir), '{ not json');
    assert.equal(series('discoverability_score', 10, box.dir).length, 0);
    record('discoverability_score', 71, box.dir);
    assert.equal(trend('discoverability_score', box.dir).last, 71);
  } finally {
    box.cleanup();
  }
});

test('record never throws when the cache location is unwritable', () => {
  const box = sandbox();
  try {
    writeFileSync(join(box.dir, '.discoverability'), 'not a directory');
    const point = record('discoverability_score', 50, box.dir);
    assert.equal(point.value, 50);
    assert.equal(series('discoverability_score', 10, box.dir).length, 0);
  } finally {
    box.cleanup();
  }
});

test('history writes are atomic and leave no temp files behind', () => {
  const box = sandbox();
  try {
    record('discoverability_score', 60, box.dir);
    record('discoverability_score', 61, box.dir);
    const cacheDir = join(box.dir, '.discoverability', 'cache');
    assert.ok(existsSync(join(cacheDir, 'metrics.json')));
    assert.deepEqual(
      readdirSync(cacheDir).filter((name) => name !== 'metrics.json'),
      [],
    );
    assert.equal(series('discoverability_score', 10, box.dir).length, 2);
  } finally {
    box.cleanup();
  }
});

test('parseCurlStatus splits the write-out status line off the body', () => {
  assert.deepEqual(parseCurlStatus('# docs\n\n- [Docs](https://example.com)\n200'), {
    text: '# docs\n\n- [Docs](https://example.com)',
    status: 200,
  });
  assert.deepEqual(parseCurlStatus('\n404'), { text: '', status: 404 });
  assert.deepEqual(parseCurlStatus('body with trailing newline\n\n500'), { text: 'body with trailing newline\n', status: 500 });
  assert.deepEqual(parseCurlStatus('no write-out at all'), { text: 'no write-out at all', status: null });
  assert.deepEqual(parseCurlStatus('body\n000'), { text: 'body\n000', status: null });
  assert.deepEqual(parseCurlStatus('body\nnot-a-status'), { text: 'body\nnot-a-status', status: null });
  assert.deepEqual(parseCurlStatus(''), { text: '', status: null });
});

test('a corrupt cache file is rotated aside before history restarts empty', () => {
  const box = sandbox();
  try {
    mkdirSync(join(box.dir, '.discoverability', 'cache'), { recursive: true });
    writeFileSync(historyPath(box.dir), '{ not json');
    record('discoverability_score', 71, box.dir);
    const cacheDir = join(box.dir, '.discoverability', 'cache');
    const rotated = readdirSync(cacheDir).filter((name) => /^metrics\.json\.corrupt-\d+$/.test(name));
    assert.equal(rotated.length, 1, `expected one rotated corrupt file, got ${readdirSync(cacheDir).join(', ')}`);
    assert.equal(readFileSync(join(cacheDir, rotated[0]), 'utf8'), '{ not json');
    assert.equal(trend('discoverability_score', box.dir).last, 71);
  } finally {
    box.cleanup();
  }
});

const RECORDER_SCRIPT = `
const { record } = await import(process.env.HISTORY_MODULE);
while (Date.now() < Number(process.env.START_AT)) {}
record('concurrency', Number(process.env.TEST_VALUE), process.env.TEST_CWD);
`;

function spawnRecorder(box, value, startAt) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', RECORDER_SCRIPT], {
      env: { ...process.env, HISTORY_MODULE: HISTORY_MODULE_URL, TEST_CWD: box.dir, TEST_VALUE: String(value), START_AT: String(startAt) },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`recorder exited ${code}: ${stderr}`))));
  });
}

test('concurrent record() calls from separate processes both land in the series', async () => {
  for (let round = 0; round < 3; round += 1) {
    const box = sandbox();
    try {
      const startAt = Date.now() + 400;
      await Promise.all([spawnRecorder(box, 11, startAt), spawnRecorder(box, 22, startAt)]);
      const values = series('concurrency', 10, box.dir).map((point) => point.value).sort((a, b) => a - b);
      assert.deepEqual(values, [11, 22], `round ${round}: expected both points, got ${JSON.stringify(values)}`);
    } finally {
      box.cleanup();
    }
  }
});
