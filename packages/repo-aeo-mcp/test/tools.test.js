import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TOOLS, callTool, toolDescriptors } from '../src/tools.js';
import { record, series, trend, listMetrics, historyPath } from '../src/history.js';

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
    assert.ok(
      preview.ok || /repository/i.test(String(preview.error || preview.output || '')),
      `dry run must plan or explain, got ${JSON.stringify(preview).slice(0, 200)}`,
    );
    assert.equal(preview.dry_run, true, 'the tool must report that it previewed');
    assert.equal(preview.applied, false);
    assert.equal(preview.mutation_count, 0, 'a dry run must not apply any mutation');
    assert.ok(preview.output && preview.output.length > 0, 'a dry run still prints the plan');
  } finally {
    box.cleanup();
  }
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
